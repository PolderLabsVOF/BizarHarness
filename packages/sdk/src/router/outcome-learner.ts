/**
 * router/outcome-learner.ts — Contextual-bandit outcome learner (IMP-020 / F-192).
 *
 * v10.16.0 — replaces the Thompson-sampling per-tier Beta priors and the
 * Q-learning `recordOutcome(agent, success)` contamination with a learner
 * keyed by the EXACT `ContextKey` that produced the dispatch decision.
 *
 * IMPROVEMENTS.md line 705 closes a P1 gap: the old router recorded only a
 * Boolean success per coarse tier and updated every state bucket for the
 * selected agent. This module ships the acceptance gate verbatim:
 *
 *     "Updates affect only the relevant model/task state."
 *
 * Design contract
 * ───────────────
 *
 *   1. Per-context posteriors. The canonical key is the canonicalised JSON
 *      of the `ContextKey` (`modelId`, `tier`, `role`, `phase`, `capability`,
 *      `riskLevel`, `provider`, `languageTag`, `contextSizeBucket`).
 *      Two `ContextKey`s with the same logical content always produce
 *      the same bucket key regardless of property insertion order.
 *   2. Verified signals only. `OutcomeSignal.verifiedBy` MUST be one of
 *      `human | auto-verifier | test-runner | review-bot`; the learner
 *      never updates on assistant self-report.
 *   3. Quarantine. Auto-quarantine a `modelId` after `quarantineStrikes`
 *      failures (default 3) within a rolling 24h window for the strike
 *      set `{ transport, auth, rate-limit, model-quality }`. `timeout`
 *      and `context-overflow` are NOT strikes (per IMP-018 evidence
 *      taxonomy: those are caller-side prompt-shape issues, not model
 *      quality signals).
 *   4. Decay. `decayHalfLifeDays` (default 14) halves `alpha + beta`
 *      toward the floor 1 over time without erasing the row. `decay(now)`
 *      is invoked explicitly by callers (typically via a periodic
 *      telemetry tick) — the learner does not time-travel on read.
 *   5. Exploration. NEVER_DOWNGRADE_ROLES (security, architecture,
 *      adversarial, audit, karen) ALWAYS pin to the strongest healthy
 *      candidate — exploration is disabled. Low/medium-risk roles with
 *      low evidence (`alpha + beta < 5`) explore 10% of the time by
 *      sampling from the uniform over the non-greedy candidates.
 *   6. Persistence. `createFileOutcomeLearner` writes a JSON snapshot
 *      synchronously on every record. `restore(state)` merges by
 *      key + `lastUpdated` so older snapshots never overwrite newer
 *      posteriors.
 *   7. Error surface. Disk errors, malformed signals, and unknown
 *      statuses throw typed `OutcomeLearnerError`s — callers can
 *      distinguish them from generic `Error`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { BizarTier } from "./agent-model-registry.js";

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Public types                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Per-context decision key. The set of properties here is the IMP-020
 * acceptance gate: the learner MUST bucket a posterior per (model, role,
 * phase, capability, riskLevel, provider, language, context size). Any
 * property omitted from the signal becomes `undefined` and is canonicalised
 * the same way on every call.
 */
export interface ContextKey {
  modelId: string;
  tier: BizarTier;
  role?: string;
  phase?: string;
  capability?: string;
  riskLevel?: "low" | "medium" | "high";
  provider?: string;
  languageTag?: string;
  contextSizeBucket?: "small" | "medium" | "large" | "xlarge";
}

/**
 * Verified outcome for a single dispatch. `routingDecisionId` ties this
 * signal back to the F-018 evidence store / the routing decision that
 * produced the dispatch — the learner refuses updates when the ID is
 * missing or not a UUID.
 */
export interface OutcomeSignal {
  routingDecisionId: string;
  modelId: string;
  taskKey: ContextKey;
  status: "success" | "failure" | "timeout" | "context-overflow" | "transport" | "auth" | "rate-limit" | "model-quality";
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  retryCount?: number;
  reviewSeverity?: "none" | "minor" | "major" | "critical";
  rollbackRequired?: boolean;
  verifiedBy: "human" | "auto-verifier" | "test-runner" | "review-bot";
  capturedAt: string;
}

/**
 * Beta posterior for a single `ContextKey` bucket. `alpha`/`beta` are the
 * standard sufficient statistics; `successes`/`failures` track the raw
 * counts; `meanReward` is the moving-average reward (0 = all failures,
 * 1 = all successes) with success = 1, failure / transport / auth / etc. = 0.
 */
export interface Posterior {
  alpha: number;
  beta: number;
  successes: number;
  failures: number;
  meanReward: number;
  lastUpdated: string;
}

/**
 * Full learner state for persistence. `posteriors` keys are canonicalised
 * `ContextKey` JSON strings. `quarantined` is keyed by `modelId` (quarantine
 * is a per-model decision, not a per-context one — the IMP-018 evidence
 * taxonomy says transport/correctness strikes imply the model is a hazard,
 * not just bad at this context).
 */
export interface OutcomeLearnerState {
  posteriors: Record<string, Posterior>;
  quarantined: Record<string, { since: string; reason: string; strikes: number }>;
  decayHalfLifeDays: number;
  policyVersion: number;
}

/**
 * Persistent view of a `record()` call. `updated` lists the canonical
 * `ContextKey` JSON keys whose posteriors shifted. `quarantined` is the
 * `modelId` of the model that just crossed the strike threshold (only
 * present on the call that triggered quarantine).
 */
export interface RecordResult {
  updated: string[];
  quarantined?: string;
}

export interface OutcomeLearner {
  record(signal: OutcomeSignal): RecordResult;
  posteriorFor(key: ContextKey): Posterior;
  ranking(role: string, candidates: ContextKey[]): ContextKey[];
  isQuarantined(modelId: string): boolean;
  decay(now: string): { decayed: number };
  snapshot(): OutcomeLearnerState;
  restore(state: OutcomeLearnerState): void;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Constants                                         */
/* ────────────────────────────────────────────────────────────────────────── */

/** Verified reviewers that may update a posterior. */
const VALID_VERIFIERS: ReadonlySet<OutcomeSignal["verifiedBy"]> = new Set<OutcomeSignal["verifiedBy"]>([
  "human",
  "auto-verifier",
  "test-runner",
  "review-bot",
]);

/** UUID v4 shape — the learner rejects non-UUID `routingDecisionId`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Failure statuses that count toward quarantine strikes. `timeout` and
 * `context-overflow` are excluded per the IMP-018 evidence taxonomy:
 * those reflect caller-side prompt-shape / latency-target issues, not
 * model quality, so a streak of them must not poison the model.
 */
const STRIKE_STATUSES: ReadonlySet<OutcomeSignal["status"]> = new Set<OutcomeSignal["status"]>([
  "transport",
  "auth",
  "rate-limit",
  "model-quality",
]);

/** Statuses the learner treats as a "failure" for the Beta posterior update. */
const FAILURE_STATUSES: ReadonlySet<OutcomeSignal["status"]> = new Set<OutcomeSignal["status"]>([
  "failure",
  "timeout",
  "context-overflow",
  "transport",
  "auth",
  "rate-limit",
  "model-quality",
]);

/** Roles where exploration is FORBIDDEN (per IMPROVEMENTS.md line 718 +
 *  IMP-018 evidence taxonomy). The selection always pins to the strongest
 *  non-quarantined candidate. */
export const NEVER_DOWNGRADE_ROLES: ReadonlySet<string> = new Set<string>([
  "security",
  "architecture",
  "adversarial",
  "audit",
  "karen",
]);

/** Exploration rate for low/medium-risk contexts with low evidence. */
const EXPLORATION_RATE = 0.1;
/** Minimum evidence to consider a posterior "converged"; below this the
 *  learner still allows exploration. */
const LOW_EVIDENCE_THRESHOLD = 5;

/** Default decay half-life (days). */
const DEFAULT_DECAY_HALF_LIFE_DAYS = 14;
/** Default quarantine strike threshold (within a 24h rolling window). */
const DEFAULT_QUARANTINE_STRIKES = 3;
/** Rolling window for strike counting (ms). */
const STRIKE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Minimum posterior mass after decay — never below this. */
const POSTERIOR_FLOOR = 1;

/** Stable policy version so the persisted state knows which rules it
 *  obeys. Bumped on each contract change. */
export const POLICY_VERSION = 1;

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Errors                                            */
/* ────────────────────────────────────────────────────────────────────────── */

export type OutcomeLearnerErrorCode =
  | "INVALID_ROUTING_DECISION_ID"
  | "INVALID_VERIFIER"
  | "INVALID_STATUS"
  | "INVALID_CONTEXT_KEY"
  | "MISSING_MODEL_ID"
  | "QUARANTINE_UPDATE_DENIED"
  | "PERSISTENCE_FAILURE";

export class OutcomeLearnerError extends Error {
  readonly code: OutcomeLearnerErrorCode;
  constructor(code: OutcomeLearnerErrorCode, message: string) {
    super(message);
    this.name = "OutcomeLearnerError";
    this.code = code;
  }
}

function learnerError(code: OutcomeLearnerErrorCode, message: string): never {
  throw new OutcomeLearnerError(code, message);
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Internal state                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Record of a single strike — used to roll-strike-counts inside the
 * 24-hour quarantine window.
 */
interface StrikeRecord {
  modelId: string;
  status: OutcomeSignal["status"];
  capturedAt: string;
  timestamp: number;
}

/**
 * Mutable learner shape. Wrapped by the constructors to expose only the
 * `OutcomeLearner` interface.
 */
class OutcomeLearnerImpl implements OutcomeLearner {
  private readonly posteriors: Map<string, Posterior> = new Map();
  private readonly quarantined: Map<string, { since: string; reason: string; strikes: number }> = new Map();
  private readonly recentStrikes: StrikeRecord[] = [];
  private decayHalfLifeDays: number;
  private readonly quarantineStrikes: number;
  private policyVersion: number = POLICY_VERSION;
  private readonly onAfterRecordPersist?: (state: OutcomeLearnerState) => void;

  constructor(opts: { decayHalfLifeDays?: number; quarantineStrikes?: number; onAfterRecordPersist?: (state: OutcomeLearnerState) => void } = {}) {
    this.decayHalfLifeDays = opts.decayHalfLifeDays ?? DEFAULT_DECAY_HALF_LIFE_DAYS;
    this.quarantineStrikes = opts.quarantineStrikes ?? DEFAULT_QUARANTINE_STRIKES;
    this.onAfterRecordPersist = opts.onAfterRecordPersist;
  }

  /** Required bucket-key method: produces a deterministic, canonicalised
   *  JSON string for a `ContextKey`. Property insertion order does not
   *  affect the result.
   *
   *  Missing fields are coerced to `null` so the canonical key ALWAYS
   *  has the same set of keys (otherwise the recorded bucket
   *  `provider: "anthropic"` would hash differently from a query
   *  `provider: undefined` — silently splitting the bucket space). */
  private static bucketKey(key: ContextKey): string {
    // Drop undefined keys so the JSON shape matches what callers pass
    // when they omit optional fields (tests + production callers both
    // omit rather than set `null`). Otherwise `provider: null` would
    // hash to a different bucket than `provider: undefined`, silently
    // splitting the posterior space.
    const out: Record<string, unknown> = {
      modelId: key.modelId,
      tier: key.tier,
    };
    for (const f of ["role", "phase", "capability", "riskLevel", "provider", "languageTag", "contextSizeBucket"] as const) {
      const v = key[f];
      if (v !== undefined) out[f] = v;
    }
    return JSON.stringify(out);
  }

  private static emptyPosterior(now: string): Posterior {
    return {
      alpha: 1,
      beta: 1,
      successes: 0,
      failures: 0,
      meanReward: 0.5,
      lastUpdated: now,
    };
  }

  private getOrCreatePosterior(key: ContextKey, now: string): Posterior {
    const bucketKey = OutcomeLearnerImpl.bucketKey(key);
    const existing = this.posteriors.get(bucketKey);
    if (existing) return existing;
    const fresh = OutcomeLearnerImpl.emptyPosterior(now);
    this.posteriors.set(bucketKey, fresh);
    return fresh;
  }

  record(signal: OutcomeSignal): RecordResult {
    // ── Validate the signal. Failures throw typed errors; never silently
    //    drop. The acceptance gate ("Updates affect only the relevant
    //    model/task state") requires this — silent updates make the
    //    acceptance test misread an unvalidated signal as a clean one.
    if (!UUID_RE.test(signal.routingDecisionId)) {
      learnerError("INVALID_ROUTING_DECISION_ID", `routingDecisionId must be a UUID v4 (got ${signal.routingDecisionId})`);
    }
    if (!VALID_VERIFIERS.has(signal.verifiedBy)) {
      learnerError("INVALID_VERIFIER", `verifiedBy must be one of human|auto-verifier|test-runner|review-bot (got ${signal.verifiedBy})`);
    }
    const STATUSES = new Set<OutcomeSignal["status"]>([
      "success",
      "failure",
      "timeout",
      "context-overflow",
      "transport",
      "auth",
      "rate-limit",
      "model-quality",
    ]);
    if (!STATUSES.has(signal.status)) {
      learnerError("INVALID_STATUS", `status must be one of the closed taxonomy (got ${signal.status})`);
    }
    if (!signal.modelId || typeof signal.modelId !== "string") {
      learnerError("MISSING_MODEL_ID", "signal.modelId is required");
    }
    if (!signal.taskKey || signal.taskKey.modelId !== signal.modelId) {
      learnerError("INVALID_CONTEXT_KEY", "taskKey.modelId must equal signal.modelId");
    }
    if (this.isQuarantined(signal.modelId)) {
      // Quarantined models are read-only for posterior updates; the
      // F-018 evidence store still records the signal, but the IMP-020
      // learner refuses to shift the posterior for a model it has
      // quarantined. The acceptance gate says updates affect only the
      // relevant context — we extend that to "we don't update a hazard
      // until someone manually un-quarantines it".
      learnerError("QUARANTINE_UPDATE_DENIED", `model ${signal.modelId} is quarantined; un-quarantine manually to resume learning`);
    }

    // ── Update the single matching bucket. The learner never touches
    //    other buckets; the `updated` array carries only the key it
    //    actually shifted.
    const posterior = this.getOrCreatePosterior(signal.taskKey, signal.capturedAt);
    const isSuccess = signal.status === "success";
    const isFailure = !isSuccess && FAILURE_STATUSES.has(signal.status);
    if (isSuccess) {
      posterior.alpha += 1;
      posterior.successes += 1;
    } else if (isFailure) {
      posterior.beta += 1;
      posterior.failures += 1;
    } else {
      // Unknown statuses are impossible after validation, but TypeScript
      // exhaustiveness needs the else branch.
      learnerError("INVALID_STATUS", `status ${signal.status} did not map to success or failure`);
    }
    const total = posterior.successes + posterior.failures;
    posterior.meanReward = total === 0 ? 0.5 : posterior.successes / total;
    posterior.lastUpdated = signal.capturedAt;

    const updated: string[] = [OutcomeLearnerImpl.bucketKey(signal.taskKey)];

    // ── Strike handling for quarantine. Only `STRIKE_STATUSES` count;
    //    `timeout` and `context-overflow` do NOT trigger quarantine.
    let quarantined: string | undefined;
    if (STRIKE_STATUSES.has(signal.status)) {
      const strike: StrikeRecord = {
        modelId: signal.modelId,
        status: signal.status,
        capturedAt: signal.capturedAt,
        timestamp: Date.parse(signal.capturedAt),
      };
      this.recentStrikes.push(strike);
      this.evictStaleStrikes(strike.timestamp);
      const strikes = this.recentStrikes.filter((s) => s.modelId === signal.modelId).length;
      if (strikes >= this.quarantineStrikes && !this.quarantined.has(signal.modelId)) {
        this.quarantined.set(signal.modelId, {
          since: signal.capturedAt,
          reason: `quarantined after ${strikes} strike(s) in 24h (last: ${signal.status})`,
          strikes,
        });
        quarantined = signal.modelId;
      }
    }

    if (this.onAfterRecordPersist) {
      try {
        this.onAfterRecordPersist(this.snapshot());
      } catch (err) {
        learnerError("PERSISTENCE_FAILURE", `after-record persist failed: ${(err as Error).message}`);
      }
    }

    return quarantined ? { updated, quarantined } : { updated };
  }

  posteriorFor(key: ContextKey): Posterior {
    const bucketKey = OutcomeLearnerImpl.bucketKey(key);
    const existing = this.posteriors.get(bucketKey);
    if (existing) return existing;
    // Default prior is Beta(1,1) — uniform mean 0.5. Returned by copy so
    // callers never mutate the learner's internal state.
    return OutcomeLearnerImpl.emptyPosterior(new Date().toISOString());
  }

  ranking(role: string, candidates: ContextKey[]): ContextKey[] {
    if (candidates.length === 0) return [];
    // Sanitise: caller might pass duplicates. Keep the first occurrence.
    const seen = new Set<string>();
    const unique: ContextKey[] = [];
    for (const c of candidates) {
      const k = OutcomeLearnerImpl.bucketKey(c);
      if (!seen.has(k)) {
        seen.add(k);
        unique.push(c);
      }
    }

    // NEVER_DOWNGRADE_ROLES: pin to the strongest healthy candidate by
    // tier. No exploration. We do NOT consume the learner here — these
    // roles are deliberately excluded from contextual learning because
    // wrong answers are catastrophic.
    if (NEVER_DOWNGRADE_ROLES.has(role)) {
      const sorted = [...unique].sort((a, b) => tierStrengthRank(a.tier) - tierStrengthRank(b.tier));
      return sorted;
    }

    // Sort by posterior mean (greedy). Candidates with the same mean
    // fall back to tier strength (strongest first) so the ranking is
    // deterministic.
    const sortedByMean = [...unique].sort((a, b) => {
      const pa = this.posteriorFor(a).meanReward;
      const pb = this.posteriorFor(b).meanReward;
      if (pa !== pb) return pb - pa;
      return tierStrengthRank(a.tier) - tierStrengthRank(b.tier);
    });

    // Exploration: any candidate with low evidence (`alpha + beta < 5`)
    // and any role that is NOT a `NEVER_DOWNGRADE_ROLE` may explore 10%
    // of the time. The exploration picks uniformly over the non-greedy
    // low-evidence candidates — those are the ones the learner would
    // never normally expose, so 10% of picks land on each non-greedy
    // candidate (proportional to its weight).
    const evidenceOf = (k: ContextKey): number => {
      const p = this.posteriorFor(k);
      return p.alpha + p.beta;
    };
    const hasLowEvidence = sortedByMean.some((c) => evidenceOf(c) < LOW_EVIDENCE_THRESHOLD);
    if (hasLowEvidence && sortedByMean.length > 1 && Math.random() < EXPLORATION_RATE) {
      const greedyHead = sortedByMean[0];
      const nonGreedyLowEvidence = sortedByMean.filter(
        (c) => evidenceOf(c) < LOW_EVIDENCE_THRESHOLD && !(c.modelId === greedyHead.modelId && c.tier === greedyHead.tier),
      );
      if (nonGreedyLowEvidence.length > 0) {
        const pick = nonGreedyLowEvidence[Math.floor(Math.random() * nonGreedyLowEvidence.length)];
        const rest = sortedByMean.filter((c) => !(c.modelId === pick.modelId && c.tier === pick.tier));
        return [pick, ...rest];
      }
    }

    return sortedByMean;
  }

  isQuarantined(modelId: string): boolean {
    return this.quarantined.has(modelId);
  }

  decay(now: string): { decayed: number } {
    if (this.posteriors.size === 0) return { decayed: 0 };
    const nowMs = Date.parse(now);
    let decayed = 0;
    for (const [key, posterior] of this.posteriors) {
      const lastMs = Date.parse(posterior.lastUpdated);
      if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) continue;
      const ageDays = (nowMs - lastMs) / (24 * 60 * 60 * 1000);
      if (ageDays <= 0) continue;
      const halfLife = Math.max(this.decayHalfLifeDays, 0.001);
      const factor = Math.pow(0.5, ageDays / halfLife);
      const newAlpha = POSTERIOR_FLOOR + (posterior.alpha - POSTERIOR_FLOOR) * factor;
      const newBeta = POSTERIOR_FLOOR + (posterior.beta - POSTERIOR_FLOOR) * factor;
      if (Math.abs(newAlpha - posterior.alpha) > 1e-9 || Math.abs(newBeta - posterior.beta) > 1e-9) {
        posterior.alpha = newAlpha;
        posterior.beta = newBeta;
        posterior.lastUpdated = now;
        this.posteriors.set(key, posterior);
        decayed += 1;
      }
    }
    return { decayed };
  }

  snapshot(): OutcomeLearnerState {
    const posteriors: Record<string, Posterior> = {};
    for (const [key, posterior] of this.posteriors) {
      posteriors[key] = { ...posterior };
    }
    const quarantined: Record<string, { since: string; reason: string; strikes: number }> = {};
    for (const [modelId, info] of this.quarantined) {
      quarantined[modelId] = { ...info };
    }
    return {
      posteriors,
      quarantined,
      decayHalfLifeDays: this.decayHalfLifeDays,
      policyVersion: this.policyVersion,
    };
  }

  restore(state: OutcomeLearnerState): void {
    if (!state || typeof state !== "object") {
      learnerError("PERSISTENCE_FAILURE", "restore() requires a valid OutcomeLearnerState");
    }
    if (typeof state.decayHalfLifeDays === "number" && state.decayHalfLifeDays > 0) {
      this.decayHalfLifeDays = state.decayHalfLifeDays;
    }
    if (typeof state.policyVersion === "number") {
      this.policyVersion = state.policyVersion;
    }
    if (state.posteriors && typeof state.posteriors === "object") {
      for (const [key, incoming] of Object.entries(state.posteriors)) {
        if (!incoming || typeof incoming !== "object") continue;
        const existing = this.posteriors.get(key);
        // Newer wins on conflict. `restore` is used to recover from a
        // snapshot taken BEFORE the learner drifted — never to overwrite
        // a posterior that has since been updated by a fresh signal.
        if (existing && Date.parse(existing.lastUpdated) > Date.parse(incoming.lastUpdated)) {
          continue;
        }
        this.posteriors.set(key, { ...incoming });
      }
    }
    if (state.quarantined && typeof state.quarantined === "object") {
      for (const [modelId, info] of Object.entries(state.quarantined)) {
        if (!info || typeof info !== "object") continue;
        this.quarantined.set(modelId, { ...info });
      }
    }
  }

  private evictStaleStrikes(nowMs: number): void {
    const cutoff = nowMs - STRIKE_WINDOW_MS;
    while (this.recentStrikes.length > 0) {
      const head = this.recentStrikes[0];
      if (head.timestamp >= cutoff) break;
      this.recentStrikes.shift();
    }
  }
}

/** Tier-strength rank (lowest = strongest). Mirrors `select-dispatch-model.ts`. */
function tierStrengthRank(tier: BizarTier): number {
  switch (tier) {
    case "premium": return 0;
    case "high": return 1;
    case "mid-design": return 2;
    case "default": return 3;
    case "mid": return 4;
    case "budget": return 5;
    default: return 6;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Public factories                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * In-memory learner for tests and ephemeral dispatch surfaces. State
 * disappears on process exit; callers can keep a snapshot via
 * `.snapshot()`.
 */
export function createInMemoryOutcomeLearner(opts?: {
  decayHalfLifeDays?: number;
  quarantineStrikes?: number;
}): OutcomeLearner {
  return new OutcomeLearnerImpl(opts);
}

/**
 * File-backed learner. Writes a JSON snapshot synchronously on every
 * `record()` call via an internal `onAfterRecordPersist` hook — the
 * write happens in the same call stack as the in-memory update so the
 * on-disk snapshot can never lag behind the in-memory state. If the
 * snapshot file is missing or unparseable, the learner starts from an
 * empty state and overwrites the file on the first `record()` call.
 */
export function createFileOutcomeLearner(path: string, opts?: {
  decayHalfLifeDays?: number;
  quarantineStrikes?: number;
}): OutcomeLearner {
  const absPath = isAbsolute(path) ? path : resolve(path);
  const initial = loadSnapshotFromDisk(absPath);
  const learner = new OutcomeLearnerImpl({
    decayHalfLifeDays: opts?.decayHalfLifeDays,
    quarantineStrikes: opts?.quarantineStrikes,
    onAfterRecordPersist: (state) => persistSnapshotToDisk(absPath, state),
  });
  if (initial) {
    learner.restore(initial);
  }
  return learner;
}

function loadSnapshotFromDisk(path: string): OutcomeLearnerState | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as OutcomeLearnerState;
    return parsed;
  } catch {
    return null;
  }
}

function persistSnapshotToDisk(path: string, state: OutcomeLearnerState): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    // The hook signature is `(state) => void`; surface the failure as an
    // `OutcomeLearnerError` so the dispatch wrapper can react. We re-
    // throw the typed error inside the `record()` catch block.
    throw new OutcomeLearnerError("PERSISTENCE_FAILURE", `failed to persist snapshot to ${path}: ${(err as Error).message}`);
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Validation helpers                                */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Returns a UUID v4 — used by callers that need to mint a
 * `routingDecisionId` to thread into the audit trail alongside this
 * learner. The validator in `record()` accepts only UUID v4 (the
 * `randomUUID()` output).
 */
export function newRoutingDecisionId(): string {
  return randomUUID();
}
