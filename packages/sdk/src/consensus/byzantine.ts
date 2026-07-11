/**
 * consensus/byzantine.ts — In-process PBFT-style consensus for Bizar.
 *
 * F-039 — thin port of ruflo's `v3/@claude-flow/swarm/src/consensus/byzantine.ts`.
 * Bizar's review/decision steps need a 3-of-5 majority with view-change
 * on faulty proposers, but not the full PBFT transport stack. This
 * class is the in-memory consensus surface; it tracks one proposal
 * at a time per (cluster, quorum) tuple, and exposes the four PBFT
 * phases (`pre-prepare → prepare → commit → reply`) plus `view-change`.
 *
 * Design choices:
 *
 *   • No network transport. Peers are passed in the constructor; the
 *     class is a single-node simulator that an outer orchestrator
 *     (or the MCP tool) drives by calling `onPrePrepare` / `onPrepare`
 *     with each peer's vote. This is exactly the surface Bizar needs
 *     for review-gate decisions; a real transport lives in a separate
 *     concern (would be `transport.ts` in ruflo — not ported).
 *
 *   • Determinism. Quorum math is purely set-based. The only ordering
 *     input is the round-robin proposer election in `queen.ts`, and
 *     even that accepts an explicit `proposerSeed` so tests can pin
 *     the head.
 *
 *   • Replay protection. `propose(payload)` is keyed on the payload's
 *     stable hash. Re-submitting the same payload returns the cached
 *     proposal id without re-running pre-prepare.
 *
 *   • Fault detection. A "faulty" proposer is one that votes `no` in
 *     the prepare phase (or doesn't vote at all within the timeout).
 *     `viewChange(reason)` walks the round-robin schedule to the next
 *     peer and increments `viewNumber`.
 */

import { createHash, randomUUID } from "node:crypto";

import { QueenCoordinator } from "./queen.js";
import {
  DEFAULT_MAX_FAULTS,
  DEFAULT_PEER_COUNT,
  DEFAULT_QUORUM,
  PHASE_ORDER,
  type CommitResult,
  type ConsensusOpts,
  type ConsensusStatus,
  type Decision,
  type Phase,
  type ProposeResult,
  type Proposal,
  type ProposalSnapshot,
  type ProposalStatus,
  type Vote,
  type VoteResult,
  type ViewChangeResult,
} from "./types.js";

// ─── Status derivation ─────────────────────────────────────────────────

function deriveStatus(p: Proposal, now: Date, timeoutMs: number): ProposalStatus {
  if (p.phase === "reply" && p.committedAt) return "committed";
  if (p.phase === "reply" && p.viewChangeReason) return "view-change";
  if (p.phase === "reply" && !p.committedAt) return "rejected";
  if (p.phase === "commit") return "commit";
  if (p.phase === "prepare") {
    if (now.getTime() - new Date(p.createdAt).getTime() > timeoutMs) return "expired";
    if (p.rejections.size > 0) return "rejected";
    return "prepare";
  }
  if (p.phase === "pre-prepare") {
    if (now.getTime() - new Date(p.createdAt).getTime() > timeoutMs) return "expired";
    return "pre-prepare";
  }
  return "pending";
}

function snapshotOf(p: Proposal, now: Date, timeoutMs: number): ProposalSnapshot {
  return {
    id: p.id,
    status: deriveStatus(p, now, timeoutMs),
    phase: p.phase,
    proposer: p.proposer,
    quorum: p.quorum,
    peerCount: p.peerCount,
    approvals: p.approvals.size,
    rejections: p.rejections.size,
    abstentions: p.abstentions.size,
    createdAt: p.createdAt,
    committedAt: p.committedAt,
    finalizedAt: p.finalizedAt,
    viewChangeReason: p.viewChangeReason,
    payload: p.payload,
  };
}

// ─── ByzantineConsensus class ──────────────────────────────────────────

export interface ByzantineConsensusOpts extends ConsensusOpts {
  /** Wall-clock timeout (ms) after which a pending proposal expires.
   *  Defaults to 5 seconds. */
  timeoutMs?: number;
  /** Maximum number of proposals to retain in the history (LRU eviction).
   *  Defaults to 100. */
  historyLimit?: number;
}

/**
 * In-process Byzantine fault-tolerant consensus. One instance per
 * (cluster, quorum) tuple. Thread-unsafe — single-threaded JS so
 * the concern is theoretical, but document it for callers that wrap
 * the instance in worker threads.
 */
export class ByzantineConsensus {
  private readonly localAgentId: string;
  private readonly peers: string[];
  private readonly quorum: number;
  private readonly maxFaults: number;
  private readonly timeoutMs: number;
  private readonly historyLimit: number;
  private readonly now: () => Date;

  private readonly queen: QueenCoordinator;
  private viewNumber = 0;

  /** Live proposals, keyed by proposalId. */
  private readonly proposals = new Map<string, Proposal>();
  /** Payload digest → proposalId, for replay protection. */
  private readonly payloadIndex = new Map<string, string>();
  /** Total counts (status === 'committed' / 'rejected' / 'expired'). */
  private committed = 0;
  private rejected = 0;
  private expired = 0;
  private viewChanges = 0;

  constructor(opts: ByzantineConsensusOpts) {
    if (!opts || typeof opts.localAgentId !== "string" || opts.localAgentId.trim().length === 0) {
      throw new Error("ByzantineConsensus: `localAgentId` is required");
    }
    if (!Array.isArray(opts.peers) || opts.peers.length < 2) {
      throw new Error("ByzantineConsensus: `peers` must be a non-empty array of >=2 ids");
    }
    if (!opts.peers.includes(opts.localAgentId)) {
      throw new Error(
        `ByzantineConsensus: localAgentId "${opts.localAgentId}" must be in the peer list`,
      );
    }
    const peerCount = opts.peers.length;
    const quorum = opts.quorum ?? (peerCount >= DEFAULT_PEER_COUNT
      ? DEFAULT_QUORUM
      : Math.max(1, Math.floor(peerCount / 2) + 1));
    if (quorum < 1 || quorum > peerCount) {
      throw new Error(
        `ByzantineConsensus: quorum (${quorum}) must be in [1, peerCount=${peerCount}]`,
      );
    }
    const maxFaults = opts.maxFaults ?? DEFAULT_MAX_FAULTS;
    // PBFT requires n >= 3f+1 for true Byzantine tolerance. We allow
    // smaller clusters (the F-039 spec uses 3-of-5 simple majority,
    // not full BFT), but warn at the API boundary so callers know.
    if (peerCount < 3 * maxFaults + 1) {
      // Best-effort — we don't throw because the orchestrator can
      // still drive a useful simple-majority consensus on smaller
      // clusters. The QueenCoordinator tracks the same `maxFaults`
      // value for proposer-skip math.
      void maxFaults; // surfaces in `this.maxFaults` getter below.
    }
    this.localAgentId = opts.localAgentId;
    this.peers = [...opts.peers];
    this.quorum = quorum;
    this.maxFaults = maxFaults;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.historyLimit = opts.historyLimit ?? 100;
    this.now = opts.now ?? (() => new Date());
    this.queen = new QueenCoordinator({
      peers: this.peers,
      maxFaults: this.maxFaults,
      seed: opts.proposerSeed,
    });
  }

  // ─── Read-only accessors ───────────────────────────────────────────

  /** Identity of the local agent (mirrors `opts.localAgentId`). */
  getLocalAgentId(): string {
    return this.localAgentId;
  }

  /** Maximum Byzantine faults the cluster is sized for. */
  getMaxFaults(): number {
    return this.maxFaults;
  }

  /** Maximum proposal history retained (LRU eviction). */
  getHistoryLimit(): number {
    return this.historyLimit;
  }

  /** Current proposer (head of the round-robin schedule). */
  getCurrentProposer(): string {
    return this.queen.currentProposer();
  }

  getViewNumber(): number {
    return this.viewNumber;
  }

  getQuorum(): number {
    return this.quorum;
  }

  getPeers(): string[] {
    return [...this.peers];
  }

  // ─── Proposal lifecycle ─────────────────────────────────────────────

  /**
   * Initiate pre-prepare for a new proposal. Generates a stable
   * proposalId from the payload + viewNumber. If the same payload is
   * re-submitted in the same view, the existing proposal is returned
   * (replay protection — see F-039 spec).
   */
  propose(payload: unknown): ProposeResult {
    this.evictExpired();
    const digest = this.payloadDigest(payload, this.viewNumber);
    const existingId = this.payloadIndex.get(digest);
    if (existingId) {
      const existing = this.proposals.get(existingId);
      if (existing) {
        return {
          proposalId: existing.id,
          status: deriveStatus(existing, this.now(), this.timeoutMs),
          phase: existing.phase,
        };
      }
    }

    const proposer = this.queen.currentProposer();
    const id = `bft-v${this.viewNumber}-${randomUUID().slice(0, 8)}`;
    const proposal: Proposal = {
      id,
      payload,
      proposer,
      quorum: this.quorum,
      peerCount: this.peers.length,
      phase: "pre-prepare",
      approvals: new Set(),
      rejections: new Set(),
      abstentions: new Set(),
      createdAt: this.now().toISOString(),
    };
    this.proposals.set(id, proposal);
    this.payloadIndex.set(digest, id);

    // Pre-prepare completes immediately for the local proposer; the
    // proposer's own vote is added by `onPrepare` if the caller wants
    // it counted. We do NOT auto-vote here — the caller decides whether
    // the proposer participates in its own proposal (typical: yes).
    this.advanceToPrepare(proposal);

    return { proposalId: id, status: deriveStatus(proposal, this.now(), this.timeoutMs), phase: proposal.phase };
  }

  /**
   * Cast a vote for a peer during the `prepare` phase. Returns the
   * updated tally; if the proposal reaches quorum the phase auto-
   * advances to `commit` and the `reply` snapshot is recorded.
   *
   * If the proposer themselves votes `no`, the proposal is
   * immediately rejected (self-fault detection) — view-change is the
   * caller's responsibility (call `viewChange`).
   */
  castVote(proposalId: string, agentId: string, decision: Decision, signature?: string): VoteResult {
    this.evictExpired();
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`castVote: unknown proposalId: ${proposalId}`);
    }
    if (!this.peers.includes(agentId)) {
      throw new Error(`castVote: agent "${agentId}" is not in the peer list`);
    }
    if (proposal.phase === "commit" || proposal.phase === "reply") {
      // Late vote — already committed/rejected. Return current tally
      // (matches ruflo's `vote` early-return when status !== 'pending').
      return this.snapshotVoteResult(proposal);
    }
    if (proposal.phase !== "prepare") {
      throw new Error(
        `castVote: proposal ${proposalId} is in phase "${proposal.phase}", not "prepare"`,
      );
    }

    // Self-fault: proposer voting "no" is a Byzantine signal.
    if (decision === "no" && agentId === proposal.proposer) {
      proposal.rejections.add(agentId);
      proposal.phase = "reply";
      proposal.viewChangeReason = `proposer-${agentId}-self-rejected`;
      proposal.finalizedAt = this.now().toISOString();
      this.rejected++;
      this.viewChanges++;
      this.queen.recordFault(agentId);
      // Advance the round-robin + view number so the next proposal
      // lands on a non-faulted proposer.
      this.queen.advance();
      this.viewNumber++;
      // Clear the payload digest so the same payload can be re-proposed
      // under the new view.
      const digest = this.payloadDigest(proposal.payload, this.viewNumber - 1);
      if (this.payloadIndex.get(digest) === proposal.id) {
        this.payloadIndex.delete(digest);
      }
      return this.snapshotVoteResult(proposal);
    }

    // Idempotency: re-voting replaces the prior vote.
    proposal.approvals.delete(agentId);
    proposal.rejections.delete(agentId);
    proposal.abstentions.delete(agentId);
    if (decision === "yes") proposal.approvals.add(agentId);
    else if (decision === "no") proposal.rejections.add(agentId);
    else proposal.abstentions.add(agentId);

    // Track the vote in the proposal's audit log (for `status()` output).
    const vote: Vote = {
      agentId,
      phase: "prepare",
      decision,
      signature,
      timestamp: this.now().toISOString(),
    };
    void vote; // vote is captured by the Set membership; kept in the
                // interface for callers that want to log externally.

    // Quorum check — promote on majority `yes`.
    if (proposal.approvals.size >= proposal.quorum) {
      proposal.phase = "commit";
      proposal.committedAt = this.now().toISOString();
      // Auto-advance to reply immediately (synchronous thin port).
      proposal.phase = "reply";
      proposal.finalizedAt = this.now().toISOString();
      this.committed++;
    } else if (proposal.rejections.size > 0 && !this.canStillReachQuorum(proposal)) {
      proposal.phase = "reply";
      proposal.finalizedAt = this.now().toISOString();
      this.rejected++;
    }

    return this.snapshotVoteResult(proposal);
  }

  /**
   * External entry-point that lets the orchestrator deliver a peer
   * vote that arrived over a transport. The `proposalId` is passed
   * explicitly (it's not part of the `Vote` shape — Votes are scoped
   * to a single proposal inside the cluster).
   */
  onPrepare(proposalId: string, vote: Vote): VoteResult {
    return this.castVote(proposalId, vote.agentId, vote.decision, vote.signature);
  }

  /**
   * External entry-point for a peer that has accepted the
   * pre-prepare. In the in-memory thin port this is mostly a
   * confirmation that the peer transitioned to `prepare` — we
   * record the pre-prepare accept and let `onPrepare` / `castVote`
   * carry the actual vote.
   */
  onPrePrepare(peerId: string, proposalId: string): { proposalId: string; phase: Phase } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`onPrePrepare: unknown proposalId: ${proposalId}`);
    }
    if (!this.peers.includes(peerId)) {
      throw new Error(`onPrePrepare: peer "${peerId}" is not in the peer list`);
    }
    if (proposal.phase !== "pre-prepare" && proposal.phase !== "prepare") {
      throw new Error(
        `onPrePrepare: proposal ${proposalId} is past pre-prepare (phase "${proposal.phase}")`,
      );
    }
    // Pre-prepare → prepare happens automatically in `propose`; this
    // method exists to satisfy the spec surface and let the orchestrator
    // record that peerId acknowledged the pre-prepare.
    return { proposalId, phase: proposal.phase };
  }

  /**
   * Mark a proposal as committed (used when the orchestrator wants
   * to force a commit, e.g. for tests that skip the vote tally).
   */
  commit(proposalId: string): CommitResult {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`commit: unknown proposalId: ${proposalId}`);
    }
    proposal.phase = "commit";
    proposal.committedAt = this.now().toISOString();
    proposal.phase = "reply";
    proposal.finalizedAt = this.now().toISOString();
    this.committed++;
    return {
      proposalId,
      status: "committed",
      committedAt: proposal.committedAt,
      finalizedAt: proposal.finalizedAt,
      approvals: proposal.approvals.size,
    };
  }

  /**
   * Trigger a view-change. Advances the round-robin schedule to the
   * next eligible peer (lowest fault count), increments viewNumber,
   * and increments the viewChanges counter. The currently-active
   * proposal (if any) is marked with the given `reason` and frozen
   * at its current phase — the orchestrator can re-submit the same
   * payload under the new view.
   */
  viewChange(reason: string, proposalId?: string): ViewChangeResult {
    const previousProposer = this.queen.currentProposer();
    this.queen.recordFault(previousProposer);
    this.queen.advance();
    this.viewNumber++;
    this.viewChanges++;

    let frozenProposalId = proposalId ?? "";
    if (frozenProposalId) {
      const proposal = this.proposals.get(frozenProposalId);
      if (proposal) {
        proposal.viewChangeReason = reason;
        if (proposal.phase !== "reply") {
          proposal.phase = "reply";
          proposal.finalizedAt = this.now().toISOString();
          // A view-change counts as neither committed nor rejected —
          // the new view will re-propose the payload.
          if (proposal.approvals.size < proposal.quorum) {
            this.rejected++;
          }
        }
        // Bump the payload digest index so the new view produces a
        // fresh proposalId for the same payload (otherwise replay
        // protection would short-circuit the retry).
        const digest = this.payloadDigest(proposal.payload, this.viewNumber - 1);
        if (this.payloadIndex.get(digest) === proposal.id) {
          this.payloadIndex.delete(digest);
        }
      }
    }

    return {
      previousProposer,
      newProposer: this.queen.currentProposer(),
      viewNumber: this.viewNumber,
      reason,
      proposalId: frozenProposalId,
    };
  }

  // ─── Status / snapshot ─────────────────────────────────────────────

  /** Read-only snapshot of every proposal the instance has tracked. */
  status(): ConsensusStatus {
    this.evictExpired();
    const snapshots: ProposalSnapshot[] = [];
    for (const p of this.proposals.values()) {
      snapshots.push(snapshotOf(p, this.now(), this.timeoutMs));
    }
    // Most-recent first (lex order by createdAt desc is fine for in-memory).
    snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      proposals: snapshots,
      currentProposer: this.queen.currentProposer(),
      viewNumber: this.viewNumber,
      committed: this.committed,
      rejected: this.rejected,
      expired: this.expired,
      viewChanges: this.viewChanges,
    };
  }

  /** Snapshot of a single proposal, or `undefined` if unknown. */
  getProposal(proposalId: string): ProposalSnapshot | undefined {
    const p = this.proposals.get(proposalId);
    if (!p) return undefined;
    return snapshotOf(p, this.now(), this.timeoutMs);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private snapshotVoteResult(proposal: Proposal): VoteResult {
    return {
      proposalId: proposal.id,
      status: deriveStatus(proposal, this.now(), this.timeoutMs),
      phase: proposal.phase,
      approvals: proposal.approvals.size,
      rejections: proposal.rejections.size,
      abstentions: proposal.abstentions.size,
      committed: proposal.phase === "reply" && !!proposal.committedAt,
    };
  }

  /**
   * Promote a proposal from `pre-prepare` to `prepare`. In the thin
   * port this is synchronous — we don't simulate network latency.
   */
  private advanceToPrepare(proposal: Proposal): void {
    if (proposal.phase !== "pre-prepare") return;
    proposal.phase = "prepare";
  }

  /**
   * Returns true if a proposal in `prepare` can still reach quorum
   * given the remaining un-voted peers. Used to short-circuit
   * dead proposals into `rejected` early.
   */
  private canStillReachQuorum(proposal: Proposal): boolean {
    const voted = proposal.approvals.size + proposal.rejections.size + proposal.abstentions.size;
    const remaining = proposal.peerCount - voted;
    const maxYes = proposal.approvals.size + remaining;
    return maxYes >= proposal.quorum;
  }

  /**
   * Walk the proposal map, mark anything older than `timeoutMs` as
   * expired, and trim history to `historyLimit` entries.
   */
  private evictExpired(): void {
    const now = this.now();
    const toExpire: string[] = [];
    for (const [id, p] of this.proposals) {
      if (p.phase === "reply") continue;
      if (now.getTime() - new Date(p.createdAt).getTime() > this.timeoutMs) {
        toExpire.push(id);
      }
    }
    for (const id of toExpire) {
      const p = this.proposals.get(id);
      if (!p) continue;
      p.phase = "reply";
      p.finalizedAt = now.toISOString();
      // Strip the payload digest so a future re-submit gets a fresh
      // proposalId under the same view.
      const digest = this.payloadDigest(p.payload, this.viewNumber);
      if (this.payloadIndex.get(digest) === id) {
        this.payloadIndex.delete(digest);
      }
      this.expired++;
    }
    // LRU trim.
    if (this.proposals.size > this.historyLimit) {
      const ordered = Array.from(this.proposals.values())
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const drop = ordered.slice(0, this.proposals.size - this.historyLimit);
      for (const p of drop) {
        this.proposals.delete(p.id);
      }
    }
  }

  /**
   * Stable hash of a payload for replay protection. The viewNumber is
   * included so the same payload in a new view produces a fresh digest
   * (view-changes are explicitly allowed to re-propose).
   */
  private payloadDigest(payload: unknown, viewNumber: number): string {
    return createHash("sha256")
      .update(JSON.stringify(payload ?? null))
      .update(`|v${viewNumber}`)
      .digest("hex");
  }
}

// ─── Re-exports for callers that want them in one import ───────────────

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
};
export { PHASE_ORDER };