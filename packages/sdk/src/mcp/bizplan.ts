/**
 * mcp/bizplan.ts — Bizplan-specific MCP entry points.
 *
 * This module is a thin facade over `mcp/server.ts` that exposes only
 * the bizplan-named tools and a server factory configured for them.
 * The named exports (`bizplan_mcp`, `bizplan_tools`) give consumers a
 * stable import path that does not collide with the existing
 * `createBizarMcpServer` factory or the broader `BIZAR_TOOLS` array.
 *
 * The tools themselves (`bizplan_validate`, `bizplan_persist`,
 * `bizplan_spawn_task`) live in `mcp/server.ts` and are exported via
 * the `BIZAR_TOOLS` array; this file filters that array to the
 * bizplan subset and exposes it under the bizplan namespace.
 */

import {
  BIZAR_TOOLS,
  createBizarMcpServer,
  createBizarMcpServerConfig,
  defineTool,
  getBizarMcpToolSummary,
  type SdkMcpServerConfig,
  type SdkMcpToolDef,
} from "./server.js";

const BIZPLAN_TOOL_NAMES = new Set([
  "bizplan_validate",
  "bizplan_persist",
  "bizplan_spawn_task",
]);

/**
 * The bizplan subset of `BIZAR_TOOLS`. Stable name so external
 * consumers do not need to filter the full array themselves.
 */
export const bizplan_tools: readonly SdkMcpToolDef[] = Object.freeze(
  BIZAR_TOOLS.filter((tool) => BIZPLAN_TOOL_NAMES.has(tool.name)),
);

/**
 * Build an MCP server config scoped to the bizplan tools. Pass this
 * into Claude Code's `mcpServers` option if you only want the bizplan
 * surface (rare; most callers should use `createBizarMcpServer`).
 */
export function bizplan_mcp_server_config(opts?: {
  name?: string;
  version?: string;
}): SdkMcpServerConfig {
  const base = createBizarMcpServerConfig(opts);
  return { ...base, tools: [...bizplan_tools] };
}

/**
 * Named factory so consumers can write `bizplan_mcp()` without
 * confusing it with the existing `createBizarMcpServer` symbol.
 */
export const bizplan_mcp: typeof createBizarMcpServer = createBizarMcpServer;

// Re-export the underlying server factory for consumers that want the
// full Bizar surface but also the bizplan tools.
export { defineTool, getBizarMcpToolSummary };
