/**
 * consensus/index.ts — Public orchestrator for the consensus layer.
 *
 * F-039 — wraps `ByzantineConsensus` behind a stable factory API and
 * re-exports every type/utility callers need. This is the surface the
 * MCP tool (`consensus_propose`) and any future dashboard wiring
 * consume.
 *
 * The orchestrator is intentionally minimal — it's a thin facade over
 * `ByzantineConsensus` plus the type re-exports. Anything fancier
 * (proposer scheduling, fault dashboards, etc.) belongs in `queen.ts`
 * or a future `dashboard.ts`.
 */

import { ByzantineConsensus, type ByzantineConsensusOpts } from "./byzantine.js";
import {
  DEFAULT_MAX_FAULTS,
  DEFAULT_QUORUM,
  type CommitResult,
  type ConsensusStatus,
  type Decision,
  type ProposeResult,
  type ProposalSnapshot,
  type Vote,
  type VoteResult,
  type ViewChangeResult,
} from "./types.js";

export interface CreateConsensusOpts extends Omit<ByzantineConsensusOpts, "localAgentId" | "peers"> {
  localAgentId: string;
  peers: string[];
}

export interface ConsensusHandle {
  /** Identity of the local agent (vote short-circuits on its own calls). */
  readonly localAgentId: string;
  /** Read-only snapshot of every proposal the instance has tracked. */
  status(): ConsensusStatus;
  /** Snapshot of a single proposal, or `undefined` if unknown. */
  getProposal(proposalId: string): ProposalSnapshot | undefined;
  /** Initiate pre-prepare for a new proposal. Re-submitting the same
   *  payload under the same view returns the cached proposalId. */
  propose(payload: unknown): ProposeResult;
  /** Cast a vote for a peer during the `prepare` phase. */
  castVote(proposalId: string, agentId: string, decision: Decision, signature?: string): VoteResult;
  /** Transport-friendly entry point — `onPrepare(proposalId, vote)`. */
  onPrepare(proposalId: string, vote: Vote): VoteResult;
  /** Force-commit a proposal (admin override; rare). */
  commit(proposalId: string): CommitResult;
  /** Trigger a view-change; returns the new proposer + view number. */
  viewChange(reason: string, proposalId?: string): ViewChangeResult;
  /** Head of the round-robin proposer schedule. */
  getCurrentProposer(): string;
  /** Current view number (incremented on every view-change). */
  getViewNumber(): number;
  /** Quorum threshold in effect. */
  getQuorum(): number;
  /** Peer roster (read-only copy). */
  getPeers(): string[];
}

/**
 * Build a `ConsensusHandle` for a given local agent + peer roster.
 * The returned object is the public surface used by the MCP tool and
 * any dashboard wiring.
 */
export function createConsensus(opts: CreateConsensusOpts): ConsensusHandle {
  const instance = new ByzantineConsensus(opts);
  return {
    localAgentId: opts.localAgentId,
    status: () => instance.status(),
    getProposal: (id) => instance.getProposal(id),
    propose: (payload) => instance.propose(payload),
    castVote: (proposalId, agentId, decision, signature) =>
      instance.castVote(proposalId, agentId, decision, signature),
    onPrepare: (proposalId, vote) => instance.onPrepare(proposalId, vote),
    commit: (proposalId) => instance.commit(proposalId),
    viewChange: (reason, proposalId) => instance.viewChange(reason, proposalId),
    getCurrentProposer: () => instance.getCurrentProposer(),
    getViewNumber: () => instance.getViewNumber(),
    getQuorum: () => instance.getQuorum(),
    getPeers: () => instance.getPeers(),
  };
}

// ─── Re-exports ────────────────────────────────────────────────────────

export { ByzantineConsensus, type ByzantineConsensusOpts } from "./byzantine.js";
export { QueenCoordinator, type QueenCoordinatorOpts } from "./queen.js";
export {
  DEFAULT_MAX_FAULTS,
  DEFAULT_PEER_COUNT,
  DEFAULT_QUORUM,
  PHASE_ORDER,
} from "./types.js";
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
} from "./types.js";

// ─── Process-wide singleton ───────────────────────────────────────────

/**
 * The shared consensus singleton used by the MCP tool. Initialized
 * with the Bizar default 5-peer roster (odin / frigg / vor / mimir /
 * heimdall — the same five Norse agents F-033 routes between) and a
 * deterministic seed so MCP-driven consensus is reproducible across
 * restarts. Tests should call `createConsensus()` with their own
 * `localAgentId` + `peers` to get an isolated instance.
 *
 * The roster here is intentional — it maps to the existing 5-agent
 * surface F-033 already exposes, so a single MCP call can drive the
 * same set of agents the orchestrator routes to.
 */
const DEFAULT_PEERS: readonly string[] = ["odin", "frigg", "vor", "mimir", "heimdall"];
const DEFAULT_LOCAL_AGENT = "odin";
const DEFAULT_PROPOSER_SEED = "bizar-f039-default";

let _shared: ConsensusHandle | null = null;

export function getSharedConsensus(): ConsensusHandle {
  if (_shared) return _shared;
  _shared = createConsensus({
    localAgentId: DEFAULT_LOCAL_AGENT,
    peers: [...DEFAULT_PEERS],
    quorum: DEFAULT_QUORUM,
    maxFaults: DEFAULT_MAX_FAULTS,
    proposerSeed: DEFAULT_PROPOSER_SEED,
    historyLimit: 50,
  });
  return _shared;
}

/** Reset the singleton — test/dev only. */
export function resetSharedConsensus(): void {
  _shared = null;
}