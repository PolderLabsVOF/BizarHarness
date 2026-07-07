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
 *
 * Cline SDK port (Phase 2):
 *   - Uses `createTool` from `@cline/sdk` directly.
 *   - Adds `name: BIZAR_MEMORY_WRITE_TOOL_NAME`.
 *   - `inputSchema` is `z.object(...).shape` over the same fields as before.
 *   - Returns structured `{ ok, ... }` / `{ error, ... }` instead of
 *     `{ output: JSON.stringify(...) }`.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { Logger } from "../logger.js";

export const BIZAR_MEMORY_WRITE_TOOL_NAME = "bizar_memory_write";

export interface MemoryWriteDeps {
  worktree: string;
  logger: Logger;
}

export type BizarMemoryWriteInput = z.infer<typeof bizarMemoryWriteSchema>;
export type BizarMemoryWriteOutput =
  | { ok: true; path: string; schemaValid?: boolean }
  | { error: string; message: string; path: string; findings?: unknown };

const bizarMemoryWriteSchema = z.object({
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
});

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


export function createMemoryWriteTool(
  deps: MemoryWriteDeps,
): AgentTool<BizarMemoryWriteInput, BizarMemoryWriteOutput> {
  return createTool({
    name: BIZAR_MEMORY_WRITE_TOOL_NAME,
    description:
      "Write a note to the Bizar Memory vault. " +
      "Validates frontmatter, scans for secrets, writes the .md file, " +
      "auto-commits (if configured), and triggers LightRAG reindex (background). " +
      "Returns { ok, path } on success or { error, message } on failure. " +
      "Available to all agents.",
    inputSchema: bizarMemoryWriteSchema.shape,
    execute: async (input) => {
      const { logger } = deps;

      // Normalize and validate path
      const normalized = input.path.replace(/\\/g, "/").replace(/^\/+/, "");
      if (normalized.includes("..") || normalized.startsWith(".")) {
        return {
          error: "invalid_path",
          message: "Path must be a simple relative vault path (no '..' or absolute paths).",
          path: input.path,
        };
      }
      if (!normalized.endsWith(".md")) {
        return {
          error: "invalid_path",
          message: "Path must end with .md",
          path: input.path,
        };
      }

      const port = await resolveDashboardPort();
      if (!port) {
        return {
          error: "dashboard_not_running",
          message: "The Bizar dashboard is not running. Start it with `bizar dash start`.",
          path: normalized,
        };
      }

      // Build frontmatter (merge type shortcut)
      const frontmatter: Record<string, unknown> = { ...(input.frontmatter ?? {}) };
      if (input.type) {
        frontmatter.type = input.type;
      }

      const body = {
        path: normalized,
        frontmatter,
        body: input.content,
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
            error: code,
            message: msg,
            path: normalized,
            ...(errorBody.findings ? { findings: errorBody.findings } : {}),
          };
        }

        const data = (await res.json()) as { relPath?: string; schemaValid?: boolean };

        return {
          ok: true,
          path: data.relPath ?? normalized,
          schemaValid: data.schemaValid ?? true,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`bizar: memory-write(${normalized}) failed: ${msg}`);
        return {
          error: "write_failed",
          message: msg,
          path: normalized,
        };
      }
    },
  });
}

