/**
 * plugins/bizar/src/tools/memory-list.ts
 *
 * `bizar_memory_list` tool — list notes in the Bizar Memory vault.
 *
 * Calls GET /api/memory/notes?prefix=... on the dashboard server.
 * Returns an array of { path, title, updated, type } objects.
 *
 * Cline SDK port (Phase 2):
 *   - Uses `createTool` from `@cline/sdk` directly.
 *   - Adds `name: BIZAR_MEMORY_LIST_TOOL_NAME`.
 *   - `inputSchema` is `z.object(...)` over the same fields as before.
 *   - Returns structured `{ ok, notes, count }` / `{ ok: false, error, message, notes }`
 *     instead of `{ output: JSON.stringify(...) }`.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { Logger } from "../logger.js";

export const BIZAR_MEMORY_LIST_TOOL_NAME = "bizar_memory_list";

export interface MemoryListDeps {
  worktree: string;
  logger: Logger;
}

export type BizarMemoryListInput = z.infer<typeof bizarMemoryListSchema>;
export type BizarMemoryListOutput =
  | {
      ok: true;
      notes: Array<{ path: string; title: string | null; updated: string | null; type: string | null }>;
      count: number;
    }
  | { ok: false; error: string; message?: string; notes: [] };

const bizarMemoryListSchema = z.object({
  prefix: z
    .string()
    .optional()
    .describe("Optional vault-relative path prefix to filter results " +
      "(e.g. 'decisions/' lists all notes under decisions/)."),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(50)
    .describe("Max notes to return (default 50)."),
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
 * Build the `bizar_memory_list` tool. The plugin wires the result into
 * `api.registerTool()` from `AgentExtensionApi`. The `deps` closure
 * carries the worktree and logger.
 */
export function createMemoryListTool(
  deps: MemoryListDeps,
): AgentTool<BizarMemoryListInput, BizarMemoryListOutput> {
  return createTool({
    name: BIZAR_MEMORY_LIST_TOOL_NAME,
    description:
      "List notes in the Bizar Memory vault, optionally filtered by path prefix. " +
      "Returns { notes: [{ path, title, updated, type }] }. " +
      "Available to all agents.",
    inputSchema: bizarMemoryListSchema.shape,
    execute: async (input) => {
      const { logger } = deps;

      const port = await resolveDashboardPort();
      if (!port) {
        return {
          ok: false as const,
          error: "dashboard_not_running",
          message: "The Bizar dashboard is not running. Start it with `bizar dash start`.",
          notes: [],
        };
      }

      const params = new URLSearchParams();
      if (input.prefix) {
        params.set("prefix", input.prefix);
      }
      const limit = Math.min(input.limit ?? 50, 200);
      params.set("limit", String(limit));

      const url = `http://127.0.0.1:${port}/api/memory/notes?${params}`;

      try {
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          logger.warn(`bizar: memory-list HTTP ${res.status}: ${text.slice(0, 200)}`);
          return {
            ok: false as const,
            error: "list_failed",
            message: `HTTP ${res.status}: ${text.slice(0, 200)}`,
            notes: [],
          };
        }

        const data = (await res.json()) as {
          notes?: Array<{
            relPath?: string;
            frontmatter?: { title?: string; type?: string };
            mtime?: number;
          }>;
          count?: number;
        };

        const notes = (data.notes ?? []).map((n) => ({
          path: n.relPath ?? "",
          title: n.frontmatter?.title ?? null,
          updated: n.mtime ? new Date(n.mtime).toISOString() : null,
          type: n.frontmatter?.type ?? null,
        }));

        return {
          ok: true as const,
          notes,
          count: notes.length,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`bizar: memory-list failed: ${msg}`);
        return {
          ok: false as const,
          error: "list_failed",
          message: msg,
          notes: [],
        };
      }
    },
  });
}
