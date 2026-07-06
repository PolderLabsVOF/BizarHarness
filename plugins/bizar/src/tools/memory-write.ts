/**
 * plugins/bizar/src/tools/memory-write.ts
 *
 * `bizar_memory_write` tool — write a note to the Bizar Memory vault.
 *
 * Calls POST /api/memory/notes on the dashboard server, which:
 *   - validates frontmatter against memory-schema.mjs
 *   - scans for secrets
 *   - writes the .md file to disk
 *   - auto-commits to git (if configured)
 *   - triggers a LightRAG reindex of the written document (background)
 *
 * The note is placed at <vault-root>/<path>. The path is relative to
 * the project namespace (e.g. "decisions/foo.md" → vault/decisions/foo.md).
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { Logger } from "../logger.js";

export interface MemoryWriteDeps {
  worktree: string;
  logger: Logger;
}

async function resolveDashboardPort(): Promise<number | null> {
  const portFile = join(homedir(), ".config", "bizar", "dashboard.port");
  if (existsSync(portFile)) {
    try {
      const raw = readFileSync(portFile, "utf8").trim();
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0 && n <= 65535) return n;
    } catch {
      // fall through
    }
  }
  const envPort = process.env.BIZAR_DASHBOARD_PORT;
  if (envPort) {
    const n = parseInt(envPort, 10);
    if (Number.isFinite(n) && n > 0 && n <= 65535) return n;
  }
  return null;
}

export function createMemoryWriteTool(deps: MemoryWriteDeps) {
  return tool({
    description:
      "Write a note to the Bizar Memory vault. " +
      "Validates frontmatter, scans for secrets, writes the .md file, " +
      "auto-commits (if configured), and triggers LightRAG reindex (background). " +
      "Returns { ok, path } on success or { error, message } on failure. " +
      "Available to all agents.",
    args: {
      path: z
        .string()
        .min(1)
        .describe(
          "Vault-relative path for the note (e.g. 'decisions/foo.md'). " +
            "Must end in .md. No absolute paths or '..' traversal.",
        ),
      content: z
        .string()
        .describe("Markdown body content of the note."),
      frontmatter: z
        .record(z.string(), z.unknown())
        .optional()
        .default({})
        .describe("YAML frontmatter object (type, tags, title, etc.)."),
      type: z
        .string()
        .optional()
        .describe(
          "Shortcut for frontmatter.type. If provided, sets frontmatter.type " +
            "before writing. Example: 'session_summary', 'decision', 'pattern'.",
        ),
    },
    execute: async (rawArgs) => {
      const args = rawArgs as {
        path: string;
        content: string;
        frontmatter?: Record<string, unknown>;
        type?: string;
      };
      const { logger } = deps;

      // Normalize and validate path
      const normalized = args.path.replace(/\\/g, "/").replace(/^\/+/, "");
      if (normalized.includes("..") || normalized.startsWith(".")) {
        return {
          output: JSON.stringify({
            error: "invalid_path",
            message: "Path must be a simple relative vault path (no '..' or absolute paths).",
            path: args.path,
          }),
        };
      }
      if (!normalized.endsWith(".md")) {
        return {
          output: JSON.stringify({
            error: "invalid_path",
            message: "Path must end with .md",
            path: args.path,
          }),
        };
      }

      const port = await resolveDashboardPort();
      if (!port) {
        return {
          output: JSON.stringify({
            error: "dashboard_not_running",
            message: "The Bizar dashboard is not running. Start it with `bizar dash start`.",
            path: normalized,
          }),
        };
      }

      // Build frontmatter (merge type shortcut)
      const frontmatter: Record<string, unknown> = { ...(args.frontmatter ?? {}) };
      if (args.type) {
        frontmatter.type = args.type;
      }

      const body = {
        path: normalized,
        frontmatter,
        body: args.content,
      };

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/memory/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          let errorBody: { error?: string; message?: string; findings?: unknown } = {};
          try {
            errorBody = (await res.json()) as typeof errorBody;
          } catch {
            // ignore parse failure
          }
          const msg = errorBody.message ?? `HTTP ${res.status}`;
          const code = errorBody.error ?? "write_failed";
          logger.warn(`bizar: memory-write(${normalized}) failed: ${code} — ${msg}`);
          return {
            output: JSON.stringify({
              error: code,
              message: msg,
              path: normalized,
              ...(errorBody.findings ? { findings: errorBody.findings } : {}),
            }),
          };
        }

        const data = (await res.json()) as { relPath?: string; schemaValid?: boolean };

        return {
          output: JSON.stringify({
            ok: true,
            path: data.relPath ?? normalized,
            schemaValid: data.schemaValid ?? true,
          }),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`bizar: memory-write(${normalized}) failed: ${msg}`);
        return {
          output: JSON.stringify({
            error: "write_failed",
            message: msg,
            path: normalized,
          }),
        };
      }
    },
  });
}
