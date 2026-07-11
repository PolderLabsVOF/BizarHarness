/**
 * federation/trust.ts — TrustEvaluator: peer allowlist + recent fail
 * rate + envelope age → trust score.
 *
 * F-038 — ported from ruflo
 * `v3/@claude-flow/plugin-agent-federation/src/application/trust-evaluator.ts`
 * (computeScore shape), stripped down for the skeleton:
 *
 *   evaluate(envelope, peer) → { allowed, reason, score }
 *
 * Inputs:
 *   - peer (PeerState): { nodeId, allowlisted, recentFailRate, lastSeenMs }
 *   - envelope: FederationEnvelope
 *
 * Scoring (pure function):
 *   baseScore = peer.allowlisted ? 0.6 : 0.0
 *   freshness  = clamp(1 - ageMs / MAX_AGE_MS, 0, 1) * 0.2
 *   reliability = clamp(1 - peer.recentFailRate, 0, 1) * 0.2
 *   score = baseScore + freshness + reliability
 *
 * Decision:
 *   allowed = peer.allowlisted AND ageMs <= MAX_AGE_MS AND score >= MIN_SCORE
 *
 * State — per-node recent fail rate + last-seen are tracked
 * in a Map so repeated calls from the same peer update the
 * picture. Failures can be recorded via `recordFailure(nodeId)`.
 */

import { envelopeAgeMs, type FederationEnvelope } from "./envelope.js";

/** Maximum envelope age we'll trust (5 minutes — matches the
 *  HMAC freshness window). Older envelopes fail freshness
 *  independently of HMAC verification. */
export const MAX_TRUST_AGE_MS = 5 * 60 * 1000;

/** Minimum composite trust score required to admit an envelope. */
export const MIN_TRUST_SCORE = 0.7;

/** Number of recent failures tracked per peer for fail-rate calc. */
const FAILURE_WINDOW = 20;

export interface PeerState {
  readonly nodeId: string;
  readonly allowlisted: boolean;
  /** Failure rate over the last `FAILURE_WINDOW` calls (0..1). */
  readonly recentFailRate: number;
  /** Last activity timestamp (ms epoch). Used as a tiebreaker. */
  readonly lastSeenMs?: number;
}

export type TrustDecision =
  | { allowed: true; score: number; reason: string }
  | { allowed: false; score: number; reason: string };

export class TrustEvaluator {
  private readonly allowlist: Set<string>;
  private readonly failHistory = new Map<string, { failures: boolean[]; lastSeenMs: number }>();

  constructor(opts: { allowlist?: readonly string[] } = {}) {
    this.allowlist = new Set((opts.allowlist ?? []).map((s) => String(s)));
  }

  /** Add or remove a node from the trust allowlist at runtime. */
  setAllowlisted(nodeId: string, allowlisted: boolean): void {
    if (allowlisted) this.allowlist.add(nodeId);
    else this.allowlist.delete(nodeId);
  }

  isAllowlisted(nodeId: string): boolean {
    return this.allowlist.has(nodeId);
  }

  /** Snapshot the per-peer state seen by `evaluate()`. */
  getPeerState(nodeId: string, _now: number = Date.now()): PeerState {
    const rec = this.failHistory.get(nodeId);
    const total = rec?.failures.length ?? 0;
    const failures = rec?.failures.filter((b) => b).length ?? 0;
    return {
      nodeId,
      allowlisted: this.allowlist.has(nodeId),
      recentFailRate: total === 0 ? 0 : failures / total,
      lastSeenMs: rec?.lastSeenMs,
    };
  }

  /** Record that an exchange with `nodeId` succeeded/failed. Sliding
   *  window of `FAILURE_WINDOW` most-recent events. */
  recordOutcome(nodeId: string, ok: boolean, now: number = Date.now()): void {
    const rec = this.failHistory.get(nodeId) ?? { failures: [], lastSeenMs: now };
    rec.failures.push(!ok);
    if (rec.failures.length > FAILURE_WINDOW) rec.failures.shift();
    rec.lastSeenMs = now;
    this.failHistory.set(nodeId, rec);
  }

  /** Compute the trust score (0..1). Pure function — useful for tests
   *  and for the orchestrator's `status` tool.
   *
   *   baseScore  = 0.3 if allowlisted else 0.0  (allowlist is necessary, not sufficient)
   *   freshness  = (1 - ageMs / MAX_TRUST_AGE_MS) * 0.3  (envelope must be fresh)
   *   reliability = (1 - peer.recentFailRate) * 0.4  (peer must be reliable)
   *
   *   MIN_TRUST_SCORE = 0.5 — a peer needs AT LEAST 2 of the 3 axes
   *   in good standing to pass.
   */
  computeScore(envelope: FederationEnvelope, peer: PeerState, now: number = Date.now()): number {
    if (!peer.allowlisted) return 0;
    const baseScore = 0.3;
    const ageMs = envelopeAgeMs(envelope, now);
    const freshness = Math.max(0, Math.min(1, 1 - ageMs / MAX_TRUST_AGE_MS)) * 0.3;
    const reliability = Math.max(0, Math.min(1, 1 - peer.recentFailRate)) * 0.4;
    return Math.max(0, Math.min(1, baseScore + freshness + reliability));
  }

  /** Admit or reject an envelope based on the per-peer trust state. */
  evaluate(envelope: FederationEnvelope, peer: PeerState, now: number = Date.now()): TrustDecision {
    if (!peer.allowlisted) {
      return {
        allowed: false,
        score: 0,
        reason: `peer_not_allowlisted: ${peer.nodeId}`,
      };
    }
    const ageMs = envelopeAgeMs(envelope, now);
    if (ageMs > MAX_TRUST_AGE_MS) {
      return {
        allowed: false,
        score: 0,
        reason: `envelope_too_old: ${ageMs}ms`,
      };
    }
    const score = this.computeScore(envelope, peer, now);
    if (score < MIN_TRUST_SCORE) {
      return {
        allowed: false,
        score,
        reason: `score_below_floor: ${score.toFixed(3)} < ${MIN_TRUST_SCORE}`,
      };
    }
    return {
      allowed: true,
      score,
      reason: `score=${score.toFixed(3)} (peer_allowlisted=true, age=${ageMs}ms, fail_rate=${peer.recentFailRate.toFixed(3)})`,
    };
  }
}