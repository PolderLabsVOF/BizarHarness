/**
 * plugins/bizar/index.ts
 *
 * v6.3.0 — Claude Code-native plugin shim.
 *
 * The legacy Cline `AgentPlugin` wrapper (327 lines, 32 files) has
 * been removed. The actual logic now lives in `packages/sdk/` and is
 * exposed to Claude Code via the MCP server (`createBizarMcpServer`)
 * registered in `~/.claude/settings.json`.
 *
 * This file is a thin re-export so any code that still imports from
 * `@polderlabs/bizar-plugin` (or from the old plugin entry path) keeps
 * working. Claude Code itself never loads this file — it loads the
 * MCP server binary at `packages/sdk/src/mcp/bin.ts` instead.
 *
 * Why keep the plugin package at all?
 *   - Back-compat for users with custom scripts that import the plugin
 *     entry point.
 *   - The npm package `@polderlabs/bizar-plugin` continues to exist so
 *     marketplace listings don't break, but it now ships no source
 *     beyond this shim.
 */

export {
  // Memory vault (Obsidian-compatible markdown)
  readNote,
  writeNote,
  listNotes,
  searchNotes,
  parseFrontmatter,
  serializeFrontmatter,
  resolveVaultRoot,
  DEFAULT_MEMORY_VAULT,
  LEGACY_MEMORY_VAULT,
  // Dangerous-pattern scanner
  checkDangerous,
  listDangerousPatterns,
  getDangerousPatternStats,
  // Tool-call fingerprint
  fingerprint,
  // MCP server (Claude Code's only path into the SDK)
  createBizarMcpServer,
  createBizarMcpServerConfig,
  BIZAR_TOOLS,
  getBizarMcpToolSummary,
  defineTool,
  SDK_VERSION,
} from "@polderlabs/bizar-sdk";

export type { MemoryNote, ApprovalDecision, ApprovalCheck, SdkMcpToolDef, SdkMcpServerConfig } from "@polderlabs/bizar-sdk";
