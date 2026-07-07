/**
 * plugins/bizar/src/tools/memory-write.ts
 *
 * `bizar_memory_write` tool — write a note to the Bizar Memory vault.
 *
 * v6.0.0 — In-process (writes to vault directory directly).
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { Logger } from "../logger.js";
import { resolveVaultRoot, writeNote } from "../memory-vault.js";

export const BIZAR_MEMORY_WRITE_TOOL_NAME = "bizar_memory_write";

export interface MemoryWriteDeps { worktree: string; logger: Logger; }

export type BizarMemoryWriteInput = z.infer<typeof bizarMemoryWriteSchema>;
export type BizarMemoryWriteOutput =
  | { ok: true; path: string; mtime: number; size: number }
  | { ok: false; error: string; message: string; path: string };

const bizarMemoryWriteSchema = z.object({
  path: z.string().min(1).describe("Vault-relative path of the note to write (e.g. 'decisions/foo.md')."),
  content: z.string().describe("Markdown body of the note (the part after the frontmatter)."),
  frontmatter: z.record(z.string(), z.unknown()).optional().describe("YAML frontmatter as a JSON object."),
  type: z.string().optional().describe("Optional note type tag."),
});

export function createMemoryWriteTool(deps: MemoryWriteDeps): AgentTool<BizarMemoryWriteInput, BizarMemoryWriteOutput> {
  return createTool({
    name: BIZAR_MEMORY_WRITE_TOOL_NAME,
    description: "Write a note to the Bizar Memory vault. Available to all agents.",
    inputSchema: bizarMemoryWriteSchema.shape,
    execute: async (input) => {
      const vaultRoot = resolveVaultRoot();
      const safe = input.path.replace(/\\/g, "/").replace(/^\/+/, "");
      if (safe.includes("..") || safe.startsWith(".")) {
        return { ok: false as const, error: "invalid_path", message: "Path must be a simple relative vault path (no '..' or absolute paths).", path: input.path };
      }
      const fm = { ...(input.frontmatter ?? {}) } as Record<string, unknown>;
      if (input.type && !fm.type) fm.type = input.type;
      try {
        const note = writeNote(vaultRoot, safe, fm, input.content);
        return { ok: true as const, path: note.relPath, mtime: note.mtime, size: note.size };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger.warn(`bizar: memory-write(${safe}) failed: ${msg}`);
        return { ok: false as const, error: "write_failed", message: msg, path: safe };
      }
    },
  });
}
