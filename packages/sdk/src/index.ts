/**
 * Public API for @polderlabs/bizar-sdk.
 *
 * v0.4.0 — Claude Code-native rewrite. The legacy Cline wrappers
 * (`createClineSdk`, `subscribeClineEvents`, `Cline*` types) have been
 * removed because Bizar no longer integrates with the Cline runtime.
 * The Claude Code integration is via the MCP server exported from
 * `./mcp/server.ts` (`createBizarMcpServer`) and the in-process memory
 * vault exported from `./memory/index.ts`.
 */

// In-process memory vault (Obsidian-compatible markdown notes).
export {
  readNote,
  writeNote,
  listNotes,
  searchNotes,
  parseFrontmatter,
  serializeFrontmatter,
  resolveVaultRoot,
  DEFAULT_MEMORY_VAULT,
  LEGACY_MEMORY_VAULT,
} from "./memory/index.js";
export type { MemoryNote } from "./memory/index.js";

// Dangerous-pattern scanner.
export {
  checkDangerous,
  listDangerousPatterns,
  getDangerousPatternStats,
} from "./dangerous-patterns.js";
export type { ApprovalDecision, ApprovalCheck } from "./dangerous-patterns.js";

// Tool-call fingerprint (stable hash for loop-guard).
export { fingerprint } from "./fingerprint.js";

// Claude Code MCP server.
export {
  createBizarMcpServer,
  createBizarMcpServerConfig,
  BIZAR_TOOLS,
  getBizarMcpToolSummary,
  defineTool,
} from "./mcp/server.js";
export type { SdkMcpToolDef, SdkMcpServerConfig } from "./mcp/server.js";

// F-032 — Swarm coordination primitives.
export {
  BizarAgentRegistry,
  bizarAgentRegistry,
} from "./agent-registry.js";
export type {
  AgentRecord,
  AgentStatus,
  RegisterAgentInput,
  RegisterAgentResult,
  ListAgentsInput,
  ListAgentsResult,
  TerminateAgentInput,
  TerminateAgentResult,
} from "./agent-registry.js";

export {
  SwarmTopologyRegistry,
  swarmTopologyRegistry,
  initSwarm,
  getSwarm,
  listSwarms,
  recordAgentInSwarm,
  decommissionSwarm,
  SWARM_TOPOLOGIES,
  DEFAULT_TOPOLOGY,
  DEFAULT_MAX_AGENTS,
  DEFAULT_SWARM_ID,
} from "./swarm-topology.js";
export type {
  SwarmRecord,
  SwarmTopology,
  InitSwarmInput,
  InitSwarmResult,
} from "./swarm-topology.js";

export { SDK_VERSION } from "./version.js";
