/**
 * Public API for @polderlabs/bizar-sdk.
 *
 * v0.4.0 — Claude Code-native rewrite. The legacy Cline wrappers
 * (`createClineSdk`, `subscribeClineEvents`, `Cline*` types) have been
 * removed because Bizar no longer integrates with the Cline runtime.
 * The Claude Code integration is via the MCP server exported from
 * `./mcp/server.ts` (`createBizarMcpServer`) through its guarded MCP and SDK primitives.
 */

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

// F-039 — Byzantine fault-tolerant consensus (thin PBFT port).
export {
  ByzantineConsensus,
  type ByzantineConsensusOpts,
  QueenCoordinator,
  type QueenCoordinatorOpts,
  createConsensus,
  getSharedConsensus,
  resetSharedConsensus,
  type ConsensusHandle,
  type CreateConsensusOpts,
  PHASE_ORDER,
  DEFAULT_QUORUM,
  DEFAULT_PEER_COUNT,
  DEFAULT_MAX_FAULTS,
} from "./consensus/index.js";
export type {
  CommitResult,
  ConsensusOpts,
  ConsensusStatus,
  Decision,
  Phase,
  ProposeResult,
  Proposal,
  ProposalSnapshot,
  ProposalStatus,
  Vote,
  VoteResult,
  ViewChangeResult,
} from "./consensus/types.js";

// F-034 — Self-learning (Pillar D): instincts + decisions logs.
export {
  recordInstinct,
  listInstincts,
  promoteInstinct,
  dropInstinct,
  recordDecision,
  listDecisions,
  verifyChain,
  datamark,
} from "./learning/index.js";

// Pillar A — heartbeat + cron (autonomous long-running agents)
export {
  startHeartbeat,
  stopHeartbeat,
  failHeartbeat,
  heartbeatPath,
  type HeartbeatRecord,
  type SessionStatus,
} from "./agent/heartbeat.js";
export {
  addCronTask,
  listCronTasks,
  removeCronTask,
  type CronTask,
} from "./agent/cron.js";

// F-206 — `/guard` progress-guarding loop (Pillar A extension).
export {
  addGuard,
  getGuard,
  listGuards,
  removeGuard,
  recordGuardCheck,
  markGuardStopped,
  listGuardChecks,
  normalizeSlug,
  GUARD_SCHEMA_VERSION,
  type Guard,
  type GuardCheck,
  type GuardStatus,
  type GuardVerdict,
} from "./agent/guard.js";

// F-207 — Mike autonomous goal / ultragoal bootstrap.
export {
  bootstrapGoal,
  bootstrapGoalFromFile,
  renderAggregateCharter,
  GoalBootstrapError,
  GOAL_BOOTSTRAP_SCHEMA_VERSION,
  type BootstrapFeature,
  type BootstrapGoalInput,
  type BootstrapVerdict,
} from "./agent/goal-bootstrap.js";

// F-194 — Autonomy contract (Phase B.1): typed ObjectiveRun,
// EvidenceBundle, OutcomeLearnerOutcome.
export * from "./autonomy/index.js";

// Audit #83 — Release provenance: SBOM, SLSA attestation, signature.
export * from "./release/index.js";

// Audit #85 — Efficiency benchmarks + auto-fan-out reduction.
export * from "./bench/index.js";

// F-202 Phase 1 — OMX adoption scaffolding: ambiguity math, deep-
// interview spec, and the bizplan handoff contract (replacing the
// retired `ralplan` surface). These are additive re-exports; existing
// consumers are unaffected. `bizplan` owns both the contract types
// and the persistence / task-spawn functions used by the MCP tools.
export * from "./ambiguity/index.js";
export * from "./handoff/bizplan.js";
export { bizplan_mcp, bizplan_tools } from "./mcp/bizplan.js";
export * from "./specs/deep-interview.js";

// F-202 Phase 1 — bizplan MCP additions: named entry points for
// the bizplan MCP surface so external consumers do not have to
// import the raw `mcp/server` module. `bizplan_mcp` is the server
// factory; `bizplan_tools` is the tool list. Coexists with the
// existing `createBizarMcpServer` and `BIZAR_TOOLS` re-exports.
export { bizplan_mcp, bizplan_tools } from "./mcp/bizplan.js";

export { SDK_VERSION } from "./version.js";
