/**
 * plugins/bizar/src/tools/memory-list.ts
 *
 * `bizar_memory_list` tool — list notes in the Bizar Memory vault.
 *
 * Calls GET /api/memory/notes?prefix=... on the dashboard server.
 * Returns an array of { path, title, updated, type } objects.
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { Logger } from "../logger.js";

export interface MemoryListDeps {
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

export function createMemoryListTool(deps: MemoryListDeps) {
  return tool({
    description:
      "List notes in the Bizar Memory vault, optionally filtered by path prefix. " +
      "Returns { notes: [{ path, title, updated, type }] }. " +
      "Available to all agents.",
    args: {
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
    },
    execute: async (rawArgs) => {
      const args = rawArgs as { prefix?: string; limit?: number };
      const { logger } = deps;

      const port = await resolveDashboardPort();
      if (!port) {
        return {
          output: JSON.stringify({
            error: "dashboard_not_running",
            message: "The Bizar dashboard is not running. Start it with `bizar dash start`.",
            notes: [],
          }),
        };
      }

      const params = new URLSearchParams();
      if (args.prefix) {
        params.set("prefix", args.prefix);
      }
      const limit = Math.min(args.limit ?? 50, 200);
      params.set("limit", String(limit));

      const url = `http://127.0.0.1:${port}/api/memory/notes?${params}`;

      try {
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          logger.warn(`bizar: memory-list HTTP ${res.status}: ${text.slice(0, 200)}`);
          return {
            output: JSON.stringify({
              error: "list_failed",
              message: `HTTP ${res.status}: ${text.slice(0, 200)}`,
              notes: [],
            }),
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
          output: JSON.stringify({
            notes,
            count: notes.length,
          }),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`bizar: memory-list failed: ${msg}`);
        return {
          output: JSON.stringify({
            error: "list_failed",
            message: msg,
            notes: [],
          }),
        };
      }
    },
  });
}
