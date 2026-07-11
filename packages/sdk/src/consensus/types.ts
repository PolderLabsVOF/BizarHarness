/**
 * consensus/types.ts — Shared type definitions for the in-process
 * Byzantine consensus layer.
 *
 * F-039 — thin port of ruflo's `v3/@claude-flow/swarm/src/consensus/byzantine.ts`
 * for Bizar's review/decision steps. We carry the full PBFT phase
 * vocabulary (pre-prepare / prepare / commit / reply) and a 3-of-5
 * simple-majority quorum — enough surface for Bizar to gate
 * multi-agent review decisions without the operational cost of full
 * PBFT (no transport, no crypto signatures, no checkpoint protocol).
 *
 * Determinism rule: quorum math is purely set-based. The only place
 * randomness (or ordering) enters is the optional round-robin
 * proposer election in `queen.ts`, and even there the caller can
 * pass an explicit seed for replay safety.
 */

// ─── Phase vocabulary ──────────────────────────────────────────────────

/**
 * PBFT-style phase identifiers. Each proposal walks
 * `pre-prepare → prepare → commit → reply` in order.
 */
export type Phase =
  | "pre-prepare"
  | "prepare"
  | "commit"
  | "reply";

export const PHASE_ORDER: readonly Phase[] = [
  "pre-prepare",
  "prepare",
  "commit",
  "reply",
] as const;

/** Decision a peer casts during the `prepare` phase. */
export type Decision = "yes" | "no" | "abstain";

// ─── Messages ──────────────────────────────────────────────────────────

/**
 * A vote cast by a peer during the `prepare` phase. The signature
 * field is a free-form string — we don't enforce cryptographic
 * signatures in the thin port (no transport), but callers that
 * wire in a transport can stuff an HMAC in here without changing
 * the shape.
 */
export interface Vote {
  agentId: string;
  phase: Extract<Phase, "prepare">;
  decision: Decision;
  signature?: string;
  /** Wall-clock timestamp at which the peer emitted the vote. */
  timestamp: string;
}

/**
 * A proposal is the unit of agreement. `proposer` is the agent that
 * initiated pre-prepare; `quorum` is the number of matching `yes`
 * votes required for commit (3-of-5 simple majority by default).
 */
export interface Proposal {
  id: string;
  payload: unknown;
  proposer: string;
  quorum: number;
  /** Total peer count this proposal was negotiated against (incl. proposer). */
  peerCount: number;
  /** Current phase, drives which transitions are legal. */
  phase: Phase;
  /** Set of agentIds that have voted `yes` in `prepare`. */
  approvals: Set<string>;
  /** Set of agentIds that have voted `no` in `prepare`. */
  rejections: Set<string>;
  /** Set of agentIds that have voted `abstain`. */
  abstentions: Set<string>;
  /** Free-form reason for `view-change` (set if status === 'view-change'). */
  viewChangeReason?: string;
  /** Set when the proposal is committed. */
  committedAt?: string;
  /** Set when the proposal is finalized (reply phase). */
  finalizedAt?: string;
  /** Wall-clock timestamp at which the proposer started pre-prepare. */
  createdAt: string;
}

export type ProposalStatus =
  | "pending"
  | "pre-prepare"
  | "prepare"
  | "commit"
  | "reply"
  | "view-change"
  | "committed"
  | "rejected"
  | "expired";

/** A snapshot of a proposal for the public `status()` query. */
export interface ProposalSnapshot {
  id: string;
  status: ProposalStatus;
  phase: Phase;
  proposer: string;
  quorum: number;
  peerCount: number;
  approvals: number;
  rejections: number;
  abstentions: number;
  createdAt: string;
  committedAt?: string;
  finalizedAt?: string;
  viewChangeReason?: string;
  payload: unknown;
}

// ─── Quorum ────────────────────────────────────────────────────────────

/** 3-of-5 simple majority quorum, per the F-039 spec. */
export const DEFAULT_QUORUM = 3;
export const DEFAULT_PEER_COUNT = 5;

/** The default fault tolerance — at most 1 Byzantine peer per cluster. */
export const DEFAULT_MAX_FAULTS = 1;

// ─── Consensus status (returned by `status()`) ─────────────────────────

export interface ConsensusStatus {
  /** All proposals the instance has processed, in arrival order. */
  proposals: ProposalSnapshot[];
  /** Current proposer (head of the round-robin schedule, weighted by faults). */
  currentProposer: string;
  /** View number — increments on every view-change. */
  viewNumber: number;
  /** Total proposals ever committed (status === 'committed'). */
  committed: number;
  /** Total proposals ever rejected (status === 'rejected'). */
  rejected: number;
  /** Total proposals ever expired (status === 'expired'). */
  expired: number;
  /** Total view-changes triggered by a faulty proposer. */
  viewChanges: number;
}

// ─── Constructor / orchestrator options ─────────────────────────────────

export interface ConsensusOpts {
  /** Local agent id — votes cast by `localAgentId` are short-circuited
   *  to `prepare`. Required. */
  localAgentId: string;
  /** Full peer roster (including `localAgentId`). Order matters for
   *  round-robin proposer election. Required. */
  peers: string[];
  /** Quorum threshold for `prepare → commit`. Defaults to 3. */
  quorum?: number;
  /** Maximum Byzantine faults the cluster is sized for. Defaults to 1. */
  maxFaults?: number;
  /** Wall-clock timeout (ms) after which a pending proposal expires. */
  /** Optional seed for round-robin proposer election — makes proposer
   *  selection deterministic for tests. If absent, round-robin walks
   *  the peer list in the order given. */
  proposerSeed?: string;
  /** A clock function for deterministic timestamps in tests. */
  now?: () => Date;
}

// ─── Public result shapes ──────────────────────────────────────────────

export interface ProposeResult {
  proposalId: string;
  status: ProposalStatus;
  phase: Phase;
}

export interface VoteResult {
  proposalId: string;
  status: ProposalStatus;
  phase: Phase;
  approvals: number;
  rejections: number;
  abstentions: number;
  committed: boolean;
}

export interface CommitResult {
  proposalId: string;
  status: ProposalStatus;
  committedAt: string;
  finalizedAt: string;
  approvals: number;
}

export interface ViewChangeResult {
  previousProposer: string;
  newProposer: string;
  viewNumber: number;
  reason: string;
  proposalId: string;
}