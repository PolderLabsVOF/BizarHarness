/**
 * open-kb.ts
 *
 * v4.0.0 — `bizar_open_kb` tool.
 *
 * Resolves the project's Bizar Memory vault from `.bizar/memory.json`
 * and opens it in Obsidian. Falls back to printing the vault path if
 * Obsidian isn't installed or running headlessly.
 *
 * Behavior:
 *   - Reads .bizar/memory.json from worktree
 *   - Calls resolveVault() to determine vault path
 *   - Spawns `obsidian <vaultPath>` as a detached child
 *   - On ENOENT, tries `xdg-open "obsidian://open?path=<vaultPath>"`
 *   - On no display server, prints the path so the user can `cd` to it
 *
 * No args. Returns a structured object with { ok, vaultPath, opened, method }.
 *
 * Cline SDK port (Phase 2):
 *   - Uses `createTool` from `@cline/sdk` directly.
 *   - Adds `name: BIZAR_OPEN_KB_TOOL_NAME`.
 *   - `inputSchema` is the empty `z.object().shape` (no args).
 *   - Returns structured `{ ok, ... }` / `{ error, ... }` instead of
 *     `{ output: JSON.stringify(...) }`.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

import type { Logger } from "../logger.js";

export const BIZAR_OPEN_KB_TOOL_NAME = "bizar_open_kb";

export interface OpenKbDeps {
  worktree: string;
  logger: Logger;
}

export type BizarOpenKbInput = z.infer<typeof bizarOpenKbSchema>;
export type BizarOpenKbOutput =
  | { ok: true; vaultPath: string; opened: true; method: "obsidian" | "xdg-open"; message: string }
  | { ok: false; error: string; vaultPath?: string; message: string; config?: MemoryJson };

interface MemoryJson {
  version?: number;
  backend?: string;
  projectId?: string;
  memoryRepo?: {
    mode?: string;
    path?: string;
    remote?: string | null;
    branch?: string;
    namespace?: string | null;
  };
  namespaces?: {
    project?: string;
    global?: string;
    user?: string;
  };
}

const bizarOpenKbSchema = z.object({});

function loadMemoryJson(worktree: string): MemoryJson | null {
  const p = join(worktree, ".bizar", "memory.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function resolveVaultPath(worktree: string, cfg: MemoryJson | null): string | null {
  if (!cfg) return null;
  const mr = cfg.memoryRepo || {};
  const mode = mr.mode || "local-only";
  const projectId = cfg.projectId || worktree.split("/").pop() || "unknown";

  if (mode === "local-only") {
    return join(worktree, ".obsidian");
  }

  // managed or linked
  const rawPath = mr.path || "";
  if (!rawPath) return null;
  const expanded = rawPath.startsWith("~")
    ? join(homedir(), rawPath.slice(1))
    : rawPath;
  return join(expanded, "projects", projectId);
}

export function createOpenKbTool(
  deps: OpenKbDeps,
): AgentTool<BizarOpenKbInput, BizarOpenKbOutput> {
  return createTool({
    name: BIZAR_OPEN_KB_TOOL_NAME,
    description:
      "Open the Bizar Memory vault in Obsidian. Resolves the vault path " +
      "from .bizar/memory.json and spawns Obsidian with the path. " +
      "If Obsidian isn't installed, prints the vault path so the user " +
      "can open it manually. Available to all agents.",
    inputSchema: bizarOpenKbSchema.shape,
    execute: async () => {
      const cfg = loadMemoryJson(deps.worktree);

      if (!cfg) {
        return {
          ok: false as const,
          error: "memory_not_initialized",
          message:
            "Run `bizar memory init` first to set up the Bizar Memory vault.",
        };
      }

      const vaultPath = resolveVaultPath(deps.worktree, cfg);

      if (!vaultPath) {
        return {
          ok: false as const,
          error: "vault_path_unresolved",
          message: "Could not resolve vault path from .bizar/memory.json",
          config: cfg,
        };
      }

      if (!existsSync(vaultPath)) {
        return {
          ok: false as const,
          error: "vault_not_found",
          vaultPath,
          message: `Vault directory does not exist at ${vaultPath}. Run \`bizar memory init\` to create it.`,
        };
      }

      // Try `obsidian <path>` first
      try {
        const child = spawn("obsidian", [vaultPath], {
          detached: true,
          stdio: "ignore",
        });
        child.on("error", () => {
          // Fall through to xdg-open attempt
        });
        child.unref();

        // Give it a beat — if spawn succeeded, assume success
        return {
          ok: true as const,
          vaultPath,
          opened: true as const,
          method: "obsidian" as const,
          message: `Opened vault in Obsidian at ${vaultPath}`,
        };
      } catch (err) {
        deps.logger.warn(
          `bizar: open-kb: obsidian spawn failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        // fall through to xdg-open
      }

      // Fallback: xdg-open with obsidian:// URI
      try {
        const child = spawn(
          "xdg-open",
          [`obsidian://open?path=${encodeURIComponent(vaultPath)}`],
          { detached: true, stdio: "ignore" },
        );
        child.on("error", (err) => {
          deps.logger.warn(`bizar: open-kb: xdg-open failed: ${err.message}`);
        });
        child.unref();

        return {
          ok: true as const,
          vaultPath,
          opened: true as const,
          method: "xdg-open" as const,
          message: `Opened vault via xdg-open at ${vaultPath}`,
        };
      } catch (err) {
        // Last resort: just print the path
        return {
          ok: false as const,
          error: "no_obsidian",
          vaultPath,
          message:
            `Could not launch Obsidian. Vault path: ${vaultPath}\n` +
            `Install Obsidian (https://obsidian.md) and try again, or open the vault manually with \`obsidian ${vaultPath}\`.`,
        };
      }
    },
  });
}
