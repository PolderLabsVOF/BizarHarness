/**
 * plugins/bizar/src/tools/memory-read.ts
 *
 * `bizar_memory_read` tool — read a single note from the Bizar Memory vault.
 *
 * Calls GET /api/memory/notes/:path on the dashboard server.
 *
 * The `path` is relative to the vault root (e.g. "decisions/foo.md"
 * or "projects/myproj/sessions/2025-07-06.md").
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { Logger } from "../logger.js";

export interface MemoryReadDeps {
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

export function createMemoryReadTool(deps: MemoryReadDeps) {
  return tool({
    description:
      "Read a single note from the Bizar Memory vault. " +
      "The path is relative to the vault root (e.g. 'decisions/foo.md'). " +
      "Returns { path, content, frontmatter, mtime } or { error } on failure. " +
      "Available to all agents.",
    args: {
      path: z
        .string()
        .min(1)
        .describe("Vault-relative path of the note to read (e.g. 'decisions/foo.md')."),
    },
    execute: async (rawArgs) => {
      const args = rawArgs as { path: string };
      const { logger } = deps;

      // Basic path safety: no absolute paths, no traversal above vault root
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

      const port = await resolveDashboardPort();
      if (!port) {
        return {
          output: JSON.stringify({
            error: "dashboard_not_running",
            message: "The Bizar dashboard is not running. Start it with `bizar dash start`.",
            path: args.path,
          }),
        };
      }

      const url = `http://127.0.0.1:${port}/api/memory/notes/${encodeURIComponent(normalized)}`;

      try {
        const res = await fetch(url, { method: "GET" });

        if (res.status === 404) {
          return {
            output: JSON.stringify({
              error: "not_found",
              message: `Note not found at path: ${normalized}`,
              path: normalized,
            }),
          };
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          logger.warn(`bizar: memory-read(${normalized}) HTTP ${res.status}: ${text.slice(0, 200)}`);
          return {
            output: JSON.stringify({
              error: "read_failed",
              message: `HTTP ${res.status}: ${text.slice(0, 200)}`,
              path: normalized,
            }),
          };
        }

        const data = (await res.json()) as {
          relPath?: string;
          frontmatter?: Record<string, unknown>;
          body?: string;
          raw?: string;
          mtime?: number;
          size?: number;
        };

        return {
          output: JSON.stringify({
            path: data.relPath ?? normalized,
            content: data.body ?? "",
            frontmatter: data.frontmatter ?? {},
            mtime: data.mtime ?? null,
            size: data.size ?? null,
          }),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`bizar: memory-read(${normalized}) failed: ${msg}`);
        return {
          output: JSON.stringify({
            error: "read_failed",
            message: msg,
            path: normalized,
          }),
        };
      }
    },
  });
}
