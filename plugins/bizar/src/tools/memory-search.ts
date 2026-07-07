/**
 * plugins/bizar/src/tools/memory-search.ts
 *
 * `bizar_memory_search` tool — full-text search over the Bizar Memory vault.
 *
 * v6.0.0 — In-process (uses the vault's built-in full-text search).
 * The dashboard's semantic / lightrag search is the source of truth
 * for higher-quality results, but FTS works without it.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { Logger } from "../logger.js";
import { resolveVaultRoot, searchNotes } from "../memory-vault.js";

export const BIZAR_MEMORY_SEARCH_TOOL_NAME = "bizar_memory_search";

export interface MemorySearchDeps { worktree: string; logger: Logger; }

export type BizarMemorySearchInput = z.infer<typeof bizarMemorySearchSchema>;
export type BizarMemorySearchOutput =
  | { ok: true; query: string; results: Array<{ path: string; frontmatter: Record<string, unknown>; snippet: string }> }
  | { ok: false; error: string; message: string };

const bizarMemorySearchSchema = z.object({
  query: z.string().min(1).describe("Search query (substring match against note body + frontmatter)."),
  limit: z.number().int().positive().optional().describe("Max results (default 20)."),
  mode: z.enum(["semantic", "fts"]).optional().describe("Search mode (default 'fts'; 'semantic' falls back to fts without a dashboard)."),
});

export function createMemorySearchTool(deps: MemorySearchDeps): AgentTool<BizarMemorySearchInput, BizarMemorySearchOutput> {
  return createTool({
    name: BIZAR_MEMORY_SEARCH_TOOL_NAME,
    description: "Search the Bizar Memory vault. Returns matching notes with snippets. Available to all agents.",
    inputSchema: bizarMemorySearchSchema.shape,
    execute: async (input) => {
      const limit = input.limit ?? 20;
      const notes = searchNotes(resolveVaultRoot(), input.query, limit);
      return {
        ok: true as const,
        query: input.query,
        results: notes.map((n) => ({ path: n.relPath, frontmatter: n.frontmatter, snippet: n.body.slice(0, 300) })),
      };
    },
  });
}
