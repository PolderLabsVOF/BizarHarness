/**
 * plugins/bizar/src/tools/memory-read.ts
 *
 * `bizar_memory_read` tool — read a single note from the Bizar Memory vault.
 *
 * v6.0.0 — Reads directly from the in-process memory vault (no dashboard
 * HTTP). Falls back to the legacy vault location if it exists.
 *
 * Cline SDK port (Phase 2):
 *   - Uses `createTool` from `@cline/sdk` directly.
 *   - Adds `name: BIZAR_MEMORY_READ_TOOL_NAME`.
 *   - `inputSchema` is `z.object(...).shape` over the same fields.
 *   - Returns structured `{ ok, path, content, frontmatter, mtime, size }`.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { Logger } from "../logger.js";
import { resolveVaultRoot, LEGACY_MEMORY_VAULT, readNote, type MemoryNote } from "../memory-vault.js";

export const BIZAR_MEMORY_READ_TOOL_NAME = "bizar_memory_read";

export interface MemoryReadDeps {
  worktree: string;
  logger: Logger;
}

export type BizarMemoryReadInput = z.infer<typeof bizarMemoryReadSchema>;
export type BizarMemoryReadOutput =
  | { ok: true; path: string; content: string; frontmatter: Record<string, unknown>; mtime: number; size: number }
  | { ok: false; error: string; message: string; path: string };

const bizarMemoryReadSchema = z.object({
  path: z.string().min(1).describe("Vault-relative path of the note to read (e.g. 'decisions/foo.md')."),
});

export function createMemoryReadTool(deps: MemoryReadDeps): AgentTool<BizarMemoryReadInput, BizarMemoryReadOutput> {
  return createTool({
    name: BIZAR_MEMORY_READ_TOOL_NAME,
    description:
      "Read a single note from the Bizar Memory vault. " +
      "The path is relative to the vault root (e.g. 'decisions/foo.md'). " +
      "Returns { path, content, frontmatter, mtime } or { error } on failure. " +
      "Available to all agents.",
    inputSchema: bizarMemoryReadSchema.shape,
    execute: async (input) => {
      const vaultRoot = resolveVaultRoot();
      const note = readFromVault(vaultRoot, input.path) ?? (vaultRoot !== LEGACY_MEMORY_VAULT ? readFromVault(LEGACY_MEMORY_VAULT, input.path) : null);
      if (!note) {
        return { ok: false as const, error: "not_found", message: `Note not found at path: ${input.path}`, path: input.path };
      }
      return {
        ok: true as const,
        path: note.relPath,
        content: note.body,
        frontmatter: note.frontmatter,
        mtime: note.mtime,
        size: note.size,
      };
    },
  });
}

function readFromVault(vaultRoot: string, relPath: string): MemoryNote | null {
  const safe = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (safe.includes("..") || safe.startsWith(".")) return null;
  return readNote(vaultRoot, safe);
}
