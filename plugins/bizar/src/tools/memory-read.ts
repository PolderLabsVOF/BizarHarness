/**
 * plugins/bizar/src/tools/memory-read.ts
 *
 * `bizar_memory_read` tool — read a single note from the Bizar Memory vault.
 *
 * Calls GET /api/memory/notes/:path on the dashboard server.
 *
 * The `path` is relative to the vault root (e.g. "decisions/foo.md"
 * or "projects/myproj/sessions/2025-07-06.md").
 *
 * Cline SDK port (Phase 2):
 *   - Uses `createTool` from `@cline/sdk` directly.
 *   - Adds `name: BIZAR_MEMORY_READ_TOOL_NAME`.
 *   - `inputSchema` is `z.object(...)` over the same fields as before.
 *   - Returns structured `{ ok, path, content, frontmatter, mtime, size }`
 *     / `{ ok: false, error, message, path }` instead of
 *     `{ output: JSON.stringify(...) }`.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { Logger } from "../logger.js";

export const BIZAR_MEMORY_READ_TOOL_NAME = "bizar_memory_read";

export interface MemoryReadDeps {
  worktree: string;
  logger: Logger;
}

export type BizarMemoryReadInput = z.infer<typeof bizarMemoryReadSchema>;
export type BizarMemoryReadOutput =
  | {
      ok: true;
      path: string;
      content: string;
      frontmatter: Record<string, unknown>;
      mtime: number | null;
      size: number | null;
    }
  | { ok: false; error: string; message: string; path: string };

const bizarMemoryReadSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Vault-relative path of the note to read (e.g. 'decisions/foo.md')."),
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

/**
 * Build the `bizar_memory_read` tool. The plugin wires the result into
 * `api.registerTool()` from `AgentExtensionApi`. The `deps` closure
 * carries the worktree and logger.
 */
export function createMemoryReadTool(
  deps: MemoryReadDeps,
): AgentTool<BizarMemoryReadInput, BizarMemoryReadOutput> {
  return createTool({
    name: BIZAR_MEMORY_READ_TOOL_NAME,
    description:
      "Read a single note from the Bizar Memory vault. " +
      "The path is relative to the vault root (e.g. 'decisions/foo.md'). " +
      "Returns { path, content, frontmatter, mtime } or { error } on failure. " +
      "Available to all agents.",
    inputSchema: bizarMemoryReadSchema.shape,
    execute: async (input) => {
      const { logger } = deps;

      // Basic path safety: no absolute paths, no traversal above vault root
      const normalized = input.path.replace(/\\/g, "/").replace(/^\/+/, "");
      if (normalized.includes("..") || normalized.startsWith(".")) {
        return {
          ok: false as const,
          error: "invalid_path",
          message: "Path must be a simple relative vault path (no '..' or absolute paths).",
          path: input.path,
        };
      }

      const port = await resolveDashboardPort();
      if (!port) {
        return {
          ok: false as const,
          error: "dashboard_not_running",
          message: "The Bizar dashboard is not running. Start it with `bizar dash start`.",
          path: input.path,
        };
      }

      const url = `http://127.0.0.1:${port}/api/memory/notes/${encodeURIComponent(normalized)}`;

      try {
        const res = await fetch(url, { method: "GET" });

        if (res.status === 404) {
          return {
            ok: false as const,
            error: "not_found",
            message: `Note not found at path: ${normalized}`,
            path: normalized,
          };
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          logger.warn(`bizar: memory-read(${normalized}) HTTP ${res.status}: ${text.slice(0, 200)}`);
          return {
            ok: false as const,
            error: "read_failed",
            message: `HTTP ${res.status}: ${text.slice(0, 200)}`,
            path: normalized,
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
          ok: true as const,
          path: data.relPath ?? normalized,
          content: data.body ?? "",
          frontmatter: data.frontmatter ?? {},
          mtime: data.mtime ?? null,
          size: data.size ?? null,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`bizar: memory-read(${normalized}) failed: ${msg}`);
        return {
          ok: false as const,
          error: "read_failed",
          message: msg,
          path: normalized,
        };
      }
    },
  });
}
