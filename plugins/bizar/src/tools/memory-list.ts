/**
 * plugins/bizar/src/tools/memory-list.ts
 *
 * `bizar_memory_list` tool — list notes in the Bizar Memory vault.
 *
 * v6.0.0 — In-process (reads vault directory directly).
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { Logger } from "../logger.js";
import { resolveVaultRoot, listNotes, type MemoryNote } from "../memory-vault.js";

export const BIZAR_MEMORY_LIST_TOOL_NAME = "bizar_memory_list";

export interface MemoryListDeps { worktree: string; logger: Logger; }

export type BizarMemoryListInput = z.infer<typeof bizarMemoryListSchema>;
export type BizarMemoryListOutput =
  | { ok: true; notes: Array<{ path: string; frontmatter: Record<string, unknown>; mtime: number; size: number }> }
  | { ok: false; error: string; message: string };

const bizarMemoryListSchema = z.object({
  limit: z.number().int().positive().optional().describe("Max number of notes to return (default 100)."),
  prefix: z.string().optional().describe("Only return notes whose path starts with this prefix."),
});

export function createMemoryListTool(deps: MemoryListDeps): AgentTool<BizarMemoryListInput, BizarMemoryListOutput> {
  return createTool({
    name: BIZAR_MEMORY_LIST_TOOL_NAME,
    description: "List notes in the Bizar Memory vault. Available to all agents.",
    inputSchema: bizarMemoryListSchema.shape,
    execute: async (input) => {
      const limit = input.limit ?? 100;
      const notes = listNotes(resolveVaultRoot(), input.prefix ?? "", limit);
      return {
        ok: true as const,
        notes: notes.map((n: MemoryNote) => ({ path: n.relPath, frontmatter: n.frontmatter, mtime: n.mtime, size: n.size })),
      };
    },
  });
}
