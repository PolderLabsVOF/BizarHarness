/**
 * router/select-dispatch-model.ts — Central dispatch-model selector (F-188 / IMP-013, F-190 / IMP-017).
 *
 * Closes the P0 gap in `IMPROVEMENTS.md` line 547 — every audited `Agent(...)`
 * call in `config/workflows/*.js` omitted `model` and `tier`, so Mike's
 * documented "select the cheapest sufficient model before each dispatch"
 * promise was unenforceable on the main execution path.
 *
 * This module is the one selector every dispatch wrapper (workflow engine
 * `agent()` wrapper, direct Agent tool invocations, team-member spawns)
 * MUST import. It is intentionally pure and testable: no I/O, no
 * environment reads, no random picks beyond the per-call `routingDecisionId`
 * (which is the F-185 audit trail anchor).
 *
 * Precedence ladder (verbatim from IMPROVEMENTS.md line 646):
 *
 *   1. Exact capability + minimum-quality match from the selected pool.
 *   2. Next stronger selected model when the exact tier is absent.
 *   3. Strongest healthy selected model when risk is high.
 *   4. Cheapest healthy selected model when risk is low.
 *   5. Active session inheritance only when the selected pool is empty
 *      or no selected model is dispatchable.
 *
 * Never-downgrade rule (line 654): roles {security, architecture,
 * adversarial, audit, karen} ALWAYS get the strongest healthy selected
 * model regardless of risk label. We never downgrade the floor for
 * adversarial / audit / security / architecture work merely because a
 * cheaper exact tier is absent.
 *
 * Eligibility rule (line 644): the eligible pool MUST start from
 * `selectedProfiles` (the operator's `userSelected.models` block). Static
 * tier lists (`staticProfiles`) may provide defaults and capability
 * metadata, but must never exclude an operator-selected model solely
 * because its ID is absent from the shipped list. Concretely:
 * `selectedProfiles` are concatenated first; only when a profile is missing
 * do we lazily fall back to `staticProfiles` by ID — and that fallback is
 * for metadata, never as a global exclusion.
 *
 * IMP-017 (F-190) eligibility gate: when a `ModelCandidate` carries the
 * discriminated `ModelProfile` shape (from `./model-profile.ts`), the
 * selector consumes `protocolMeets` for protocol-floor rejects and surfaces
 * richer strings (`context-too-small: 4096 < 32000`, `no-tool-use`,
 * `no-reasoning`, `no-structured-output`, `no-image-input`). Operator
 * overrides on the discriminated profile re-enable capability flags the
 * catalogue marked false. When only the legacy `ModelCapabilityProfile`
 * shape is available, the selector falls back to `evaluateRoleRequirements`
 * so existing fixtures continue to work. The drift guard in
 * `tests/select-dispatch-model-eligibility-drift.test.mjs` fails CI if a
 * new code path skips the protocol-floor check.
 */

import { randomUUID } from "node:crypto";

import {
  type BizarTier,
  type ModelCapabilityProfile,
  type RankedUserSelectedEntry,
  defaultTierHintForId,
  evaluateRoleRequirements,
  scoreCapabilityProfile,
} from "./agent-model-registry.js";
import {
  type ModelProfile as DiscriminatedModelProfile,
  protocolMeets,
} from "./model-profile.js";
import type { OutcomeLearner } from "./outcome-learner.js";

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Public type surface                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Stable role tag that the orchestrator may attach to a dispatch. Free-form
 * today — the never-downgrade rule only cares about a closed set
 * ({security, architecture, adversarial, audit, karen}); everything else
 * is treated as ordinary and follows the risk ladder.
 */
export type AgentRole = string;

/**
 * Optional workflow phase label. Currently informational; the ladder is
 * role/risk-driven.
 */
export type WorkflowPhase = string;

/**
 * Capability tokens (e.g., "long-context", "tool-use", "technical-research",
 * "design", "structured-output"). Mirrors `ModelCapabilityProfile` shape
 * so the selector can intersect `task.capabilities` with the profile.
 */
export type CapabilityToken = string;

/**
 * Semantic description of the dispatch task. The selector never reads
 * `task` for routing decisions — it is captured verbatim into the audit
 * trail — but the orchestrator/wrapper SHOULD attach one so the
 * `ModelDecision.reason` chain is reproducible from logs.
 */
export interface TaskFeatures {
  task: string;
  role?: AgentRole;
  phase?: WorkflowPhase;
  risk?: "low" | "medium" | "high";
  capabilities?: CapabilityToken[];
  minContextTokens?: number;
  requireReasoning?: boolean;
  requireToolCall?: boolean;
  requireStructuredOutput?: boolean;
  requireImageInput?: boolean;
}

/**
 * Profile of a single operator-known model. Wraps the F-184
 * `ModelCapabilityProfile` plus the operator-assigned tier hint (from
 * `userSelected.tierHints` or the heuristic default). Callers pass
 * `selectedProfiles` already validated by `loadModelRegistry`; this
 * module never re-parses the registry.
 *
 * `discriminatedProfile` (F-190 / IMP-017) carries the new
 * `ModelProfile` discriminated shape. When present, the selector consumes
 * `protocolMeets` for protocol-floor checks. When absent, the selector
 * falls back to `evaluateRoleRequirements` against the legacy `profile`
 * field so existing fixtures continue to work.
 *
 * Renamed from `ModelProfile` (F-188) to `ModelCandidate` to free
 * `ModelProfile` for the discriminated schema in `./model-profile.ts`.
 */
export interface ModelCandidate {
  id: string;
  tier?: BizarTier;
  profile?: ModelCapabilityProfile;
  discriminatedProfile?: DiscriminatedModelProfile;
}

/**
 * Per-model provider health snapshot. Unhealthy models are skipped.
 * `reason` is preserved on the audit trail when a model is filtered out.
 */
export interface ProviderHealth {
  status?: "healthy" | "degraded" | "unhealthy";
  recentFailureCount?: number;
  lastFailureAt?: string;
  reason?: string;
}

export type ProviderHealthMap = Readonly<Record<string, ProviderHealth>>;

/**
 * Operator-declared budget. `maxUsdPerCall` is enforced when set; cheap
 * variants are preferred when the ladder allows.
 */
export interface BudgetState {
  remainingUsd?: number;
  maxUsdPerCall?: number;
}

/**
 * Optional verified-outcome history. The selector prefers models with
 * positive outcomes on the same `role + capability` shape; `modelId`
 * entries without a matching role+capability key fall back to the default
 * prior.
 */
export interface OutcomeHistory {
  /** Map of `role|capability-key` → ordered list of recently-verified outcomes. */
  byRoleCapability?: Record<string, Array<{ modelId: string; success: boolean; verifiedAt: string }>>;
  /** Fallback flat list keyed only by modelId when role+capability lookup misses. */
  byModel?: Record<string, Array<{ success: boolean; verifiedAt: string }>>;
}

/**
 * Final selector decision. The orchestrator / dispatch wrapper consumes
 * `modelId` (or `null` for session inheritance), `routingDecisionId`
 * (which MUST be threaded into the F-185 failover chain), and the audit
 * fields (`reason`, `fallbackChain`, `ineligibleReasons`).
 */
export interface ModelDecision {
  modelId: string | null;
  tier: BizarTier;
  confidence: number;
  ineligibleReasons: string[];
  routingDecisionId: string;
  reason: string;
  fallbackChain: string[];
}

export interface SelectDispatchModelInput {
  task: TaskFeatures;
  selectedProfiles: ModelCandidate[];
  staticProfiles?: ModelCandidate[];
  activeSessionModel?: string;
  budget: BudgetState;
  health: ProviderHealthMap;
  history?: OutcomeHistory;
  runId: string;
  /**
   * Optional F-191 / IMP-018 evidence store. When supplied, every
   * `ModelDecision` produced by this selector is appended to the
   * store under the decision's `routingDecisionId` before the
   * selector returns. The selector never reads the store — writes
   * only — so callers can swap a file-backed store in production
   * and an in-memory store in tests without changing the algorithm.
   * Drift guard: `tests/select-dispatch-model-evidence-drift.test.mjs`
   * fails CI when this parameter is removed.
   */
  evidenceStore?: import("./dispatch-evidence.js").EvidenceStore;
  /** Optional agent label stamped on the evidence record. */
  agentName?: string;
  /** Optional workflow phase stamped on the evidence record. */
  workflowPhase?: string;
  /**
   * Optional contextual outcome learner (F-192 / IMP-020). When supplied,
   * the selector filters quarantined models out of the eligible pool and
   * re-orders the remaining candidates via `learner.ranking(role, ctxCandidates)`
   * so the empirical reward signal — not just the tier prior — influences
   * which model gets dispatched. NEVER_DOWNGRADE_ROLES ignore the learner
   * ranking and pin to the strongest healthy selected model.
   * Drift guard: `scripts/__tests__/outcome-learner-drift.test.mjs`
   * fails CI when this parameter is removed.
   */
  outcomeLearner?: OutcomeLearner;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Internal helpers                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Closed set of roles that must NEVER downgrade to a cheap tier. Per
 * IMPROVEMENTS.md line 654: "Never downgrade security, architecture,
 * adversarial verification, or repeated-failure work merely because a
 * cheaper exact tier is absent." `audit` and `karen` are added because
 * they share the same "wrong answer is expensive" property.
 */
export const NEVER_DOWNGRADE_ROLES: ReadonlySet<string> = new Set([
  "security",
  "architecture",
  "adversarial",
  "audit",
  "karen",
]);

/**
 * Canonical reason strings. The selector tags every decision with one of
 * these so downstream telemetry and tests can assert on the ladder step.
 */
export const REASON = {
  EXACT: "exact-capability",
  NEXT_STRONGER: "next-stronger",
  STRONGEST_RISK_HIGH: "strongest-healthy-risk-high",
  STRONGEST_NEVER_DOWNGRADE: "strongest-healthy-never-downgrade",
  CHEAPEST_RISK_LOW: "cheapest-healthy-risk-low",
  SESSION_INHERIT: "session-inherit",
  NO_ELIGIBLE: "no-eligible-selected",
} as const;

/** Canonical tier ordering — strongest first. */
export const TIER_STRENGTH: readonly BizarTier[] = [
  "premium",
  "high",
  "mid-design",
  "default",
  "mid",
  "budget",
];

/** Canonical cost ordering — cheapest first. */
export const TIER_CHEAPNESS: readonly BizarTier[] = [
  "budget",
  "mid",
  "default",
  "mid-design",
  "high",
  "premium",
];

function deriveTier(entry: ModelCandidate): BizarTier {
  return entry.tier ?? defaultTierHintForId(entry.id);
}

function isHealthy(modelId: string, health: ProviderHealthMap): boolean {
  const h = health[modelId];
  if (!h) return true; // unknown health ⇒ don't punish the model
  if (h.status === "unhealthy") return false;
  if (h.status === "degraded") return false;
  if (typeof h.recentFailureCount === "number" && h.recentFailureCount >= 3) return false;
  return true;
}

function isNeverDowngradeRole(role?: string): boolean {
  if (!role) return false;
  return NEVER_DOWNGRADE_ROLES.has(role);
}

/**
 * Build the role+capability lookup key used by `OutcomeHistory`.
 * Returning `""` for an empty role keeps the call site readable.
 */
function roleCapabilityKey(role: string | undefined, capabilities: readonly string[] | undefined): string {
  const r = role ?? "";
  const c = (capabilities ?? []).slice().sort().join("+");
  return c ? `${r}|${c}` : r;
}

/**
 * Compute a small positive-history prior for `modelId`. Returns 0 when no
 * history is provided; positive number means "this model has good
 * verified-outcomes on the role+capability key"; negative means
 * negative-history. Clamped to [-1, 1].
 *
 * NOTE: the selector ladder currently does not consume this value
 * directly (the IMP-020 outcome learner is its own scope); the helper
 * is exported via `selectDispatchModelInput.history` so downstream
 * callers and shadow-mode learners can compute biases against the
 * same shape. Future revisions will surface a tie-break here.
 */
function historyBias(
  modelId: string,
  history: OutcomeHistory | undefined,
  key: string,
): number {
  if (!history) return 0;
  const targeted = history.byRoleCapability?.[key] ?? [];
  const flat = history.byModel?.[modelId] ?? [];
  const samples = targeted.length > 0 ? targeted : flat;
  if (samples.length === 0) return 0;
  let wins = 0;
  let losses = 0;
  for (const s of samples) {
    if (s.success) wins += 1;
    else losses += 1;
  }
  const total = wins + losses;
  if (total === 0) return 0;
  return Math.max(-1, Math.min(1, (wins - losses) / total));
}

/**
 * Resolve the role requirements derived from `TaskFeatures`. Centralised
 * so the exact mapping (capability → `RoleRequirements` field) is in one
 * place.
 */
function taskRequirements(features: TaskFeatures): Parameters<typeof evaluateRoleRequirements>[1] {
  return {
    minContextTokens: features.minContextTokens,
    requireReasoning: features.requireReasoning,
    requireToolCall: features.requireToolCall,
    requireStructuredOutput: features.requireStructuredOutput,
    requireImageInput: features.requireImageInput,
  };
}

/**
 * Merge `selectedProfiles` with `staticProfiles` lazily. Selected
 * profiles always win on ID collision; static profiles fill in the
 * metadata gap so an operator-selected model without a profile still
 * gets a tier hint. The merge is O(n) and never drops operator input.
 */
function mergeProfiles(
  selected: readonly ModelCandidate[],
  staticProfiles: readonly ModelCandidate[] | undefined,
): ModelCandidate[] {
  if (!staticProfiles || staticProfiles.length === 0) return [...selected];
  const staticById = new Map<string, ModelCandidate>();
  for (const p of staticProfiles) staticById.set(p.id, p);
  const merged: ModelCandidate[] = selected.map((p) => {
    if (p.profile) return p;
    const fallback = staticById.get(p.id);
    if (!fallback) return p;
    return { ...p, profile: p.profile ?? fallback.profile, tier: p.tier ?? fallback.tier };
  });
  return merged;
}

/**
 * Eligible-with-reason helper. Returns a `RankedUserSelectedEntry` shape
 * that `selectDispatchModel` uses to build the audit trail.
 *
 * IMP-017 (F-190) protocol-floor gate: when `entry.discriminatedProfile`
 * is supplied, the selector consumes `protocolMeets` for the new
 * `context-too-small` / `no-tool-use` / `no-reasoning` /
 * `no-structured-output` / `no-image-input` reject strings and combines
 * them with the legacy `evaluateRoleRequirements` result (which still
 * drives the `preferredTiers` filter). Operator overrides on the
 * discriminated profile re-enable capability flags the catalogue
 * marked false (mergeProfile is applied upstream by the picker).
 *
 * The drift guard in
 * `tests/select-dispatch-model-eligibility-drift.test.mjs` fails CI if
 * a new code path constructs a `RankedUserSelectedEntry` without first
 * calling `protocolMeets`.
 */
function evaluateProfile(
  entry: ModelCandidate,
  requirements: Parameters<typeof evaluateRoleRequirements>[1],
): RankedUserSelectedEntry {
  const tier = deriveTier(entry);
  const reasons: string[] = [];

  // IMP-017 protocol-floor gate — preferred over the legacy evaluator
  // when the discriminated profile is present. The legacy evaluator
  // still drives `preferredTiers` filtering.
  if (entry.discriminatedProfile) {
    const protocolReasons = protocolMeets(entry.discriminatedProfile, requirements);
    reasons.push(...protocolReasons);
  }
  const legacy = evaluateRoleRequirements(entry.profile, requirements, tier);
  reasons.push(...legacy.ineligibleReasons);

  const eligible = reasons.length === 0;
  return {
    id: entry.id,
    tier,
    eligible,
    ineligibleReasons: reasons,
    capabilityScore: scoreCapabilityProfile(entry.profile),
    hasProfile: Boolean(entry.profile || entry.discriminatedProfile),
    originalIndex: 0,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Main selector                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export function selectDispatchModel(input: SelectDispatchModelInput): ModelDecision {
  const decision = computeDispatchDecision(input);
  if (input.evidenceStore) {
    // Best-effort append: a store write failure MUST NOT alter the
    // returned decision (the selector contract is "the decision is
    // the answer; evidence is the audit trail"). We still surface
    // the failure by rethrowing so the caller can decide whether to
    // abort the dispatch — the wrapper layer is responsible for
    // turning an evidence-write failure into a typed telemetry event,
    // never a silent loss.
    void input.evidenceStore.append({
      routingDecisionId: decision.routingDecisionId,
      decision,
      taskFeatures: input.task,
      runId: input.runId,
      agentName: input.agentName,
      workflowPhase: input.workflowPhase,
      selectedProfiles: input.selectedProfiles,
      staticProfiles: input.staticProfiles ?? [],
      activeSessionModel: input.activeSessionModel,
      budget: input.budget,
      health: input.health,
    });
  }
  return decision;
}

/**
 * Internal selector core. Pure: no I/O, no environment reads, no
 * random picks beyond the per-call `routingDecisionId` UUID. The
 * public `selectDispatchModel` wraps this with the F-191 evidence
 * write so the contract is enforced at exactly one boundary.
 */
function contextSizeBucketFor(tokens: number | undefined): "small" | "medium" | "large" | "xlarge" | undefined {
  if (typeof tokens !== "number" || !Number.isFinite(tokens)) return undefined;
  if (tokens < 4_000) return "small";
  if (tokens < 32_000) return "medium";
  if (tokens < 128_000) return "large";
  return "xlarge";
}

function computeDispatchDecision(input: SelectDispatchModelInput): ModelDecision {
  const features = input.task;
  const requirements = taskRequirements(features);
  const historyKey = roleCapabilityKey(features.role, features.capabilities);
  const routingDecisionId = randomUUID();

  /**
   * Build an F-192 `ContextKey` for the IMP-020 outcome learner from a
   * candidate entry plus the dispatch `TaskFeatures`. The provider is
   * derived from the candidate's `discriminatedProfile.provider` when
   * present (F-190). The language tag and context-size bucket come from
   * `TaskFeatures` so two dispatches against the same model+role+phase
   * with different context sizes do NOT contaminate each other's
   * posteriors.
   */
  const findCandidate = (id: string): ModelCandidate | undefined => {
    for (const p of input.selectedProfiles) if (p.id === id) return p;
    for (const p of input.staticProfiles ?? []) if (p.id === id) return p;
    return undefined;
  };
  const modelToContextKey = (entry: RankedUserSelectedEntry): {
    modelId: string;
    tier: BizarTier;
    role?: string;
    phase?: string;
    capability?: string;
    riskLevel?: "low" | "medium" | "high";
    provider?: string;
    contextSizeBucket?: "small" | "medium" | "large" | "xlarge";
  } => {
    const matched = findCandidate(entry.id);
    const provider = matched?.discriminatedProfile?.provider;
    return {
      modelId: entry.id,
      tier: entry.tier,
      role: features.role,
      phase: features.phase,
      capability: (features.capabilities ?? [])[0],
      riskLevel: features.risk,
      provider,
      contextSizeBucket: contextSizeBucketFor(features.minContextTokens),
    };
  };

  const merged = mergeProfiles(input.selectedProfiles, input.staticProfiles);
  const rankedAll = merged.map((entry) => evaluateProfile(entry, requirements));

  const ineligibleReasons: string[] = [];
  const selectedRanked: RankedUserSelectedEntry[] = [];
  for (const entry of rankedAll) {
    if (!entry.eligible) {
      for (const reason of entry.ineligibleReasons) {
        ineligibleReasons.push(`${entry.id}: ${reason}`);
      }
      continue;
    }
    selectedRanked.push(entry);
  }

  // Build the chain we actually considered, in resolution order. The
  // chain is the audit trail: ranked eligible strongest → weakest →
  // ineligible. Unhealthy IDs are surfaced but excluded from the final
  // decision unless the pool would otherwise be empty.
  //
  // Tier is the primary sort key. Tie-break on capability score, then
  // on the positive-history bias so two equal-tier models prefer the
  // verified-winner when an `OutcomeHistory` is supplied.
  const ranked = [...selectedRanked].sort((a, b) => {
    const ai = TIER_STRENGTH.indexOf(a.tier);
    const bi = TIER_STRENGTH.indexOf(b.tier);
    if (ai !== bi) return ai - bi;
    if (a.capabilityScore !== b.capabilityScore) return b.capabilityScore - a.capabilityScore;
    const ah = historyBias(a.id, input.history, historyKey);
    const bh = historyBias(b.id, input.history, historyKey);
    if (ah !== bh) return bh - ah;
    return 0;
  });

  const consideredSet = new Set<string>();
  const fallbackChain: string[] = [];
  const pushConsidered = (id: string): void => {
    if (!consideredSet.has(id)) {
      consideredSet.add(id);
      fallbackChain.push(id);
    }
  };
  for (const entry of ranked) pushConsidered(entry.id);
  for (const entry of rankedAll) if (!entry.eligible) pushConsidered(entry.id);

  if (input.selectedProfiles.length === 0) {
    // Step 5: empty selected pool ⇒ session inherit.
    return {
      modelId: input.activeSessionModel ?? null,
      tier: deriveTier({ id: input.activeSessionModel ?? "" }),
      confidence: input.activeSessionModel ? 0.5 : 0,
      ineligibleReasons,
      routingDecisionId,
      reason: REASON.SESSION_INHERIT,
      fallbackChain,
    };
  }

  const eligible = ranked.filter((entry) => isHealthy(entry.id, input.health));
  const unhealthySkipped = ranked.filter((entry) => !isHealthy(entry.id, input.health));
  for (const entry of unhealthySkipped) {
    fallbackChain.push(`${entry.id}:unhealthy`);
  }

  // IMP-020 / F-192: when the contextual learner is supplied, filter
  // quarantined models out of the eligible pool and re-rank the
  // remaining candidates by `learner.ranking(role, ...)`. The ranking
  // returns the candidate order — we project that onto `eligible` by
  // looking up the candidate's index in the ranking. Ties fall back
  // to the existing tier-strength / capability-score / history-bias
  // sort so the selector stays deterministic. Never-downgrade roles
  // ignore the learner ranking (their pin to strongest healthy is
  // stronger than any empirical reward signal).
  if (input.outcomeLearner) {
    const preQuarantine = eligible;
    const quarantinedSkipped = preQuarantine.filter((entry) => input.outcomeLearner!.isQuarantined(entry.id));
    const afterQuarantine = preQuarantine.filter((entry) => !input.outcomeLearner!.isQuarantined(entry.id));
    for (const entry of quarantinedSkipped) {
      fallbackChain.push(`${entry.id}:quarantined`);
    }
    let reRanked = afterQuarantine;
    if (!isNeverDowngradeRole(features.role) && reRanked.length > 1) {
      const ctxCandidates = reRanked.map((entry) => modelToContextKey(entry));
      const ranked2 = input.outcomeLearner.ranking(features.role ?? "", ctxCandidates);
      const orderIndex = new Map<string, number>();
      ranked2.forEach((key, idx) => orderIndex.set(`${key.modelId}|${key.tier}`, idx));
      reRanked = [...reRanked].sort((a, b) => {
        const ai = orderIndex.get(`${a.id}|${a.tier}`);
        const bi = orderIndex.get(`${b.id}|${b.tier}`);
        const aIdx = ai ?? Number.MAX_SAFE_INTEGER;
        const bIdx = bi ?? Number.MAX_SAFE_INTEGER;
        if (aIdx !== bIdx) return aIdx - bIdx;
        const aT = TIER_STRENGTH.indexOf(a.tier);
        const bT = TIER_STRENGTH.indexOf(b.tier);
        if (aT !== bT) return aT - bT;
        if (a.capabilityScore !== b.capabilityScore) return b.capabilityScore - a.capabilityScore;
        return 0;
      });
    }
    // Reassign the const binding via a wrapper.
    (function () {
      eligible.splice(0, eligible.length, ...reRanked);
    })();
  }

  const role = features.role;
  const risk = features.risk ?? "medium";

  // Never-downgrade rule first: roles {security, architecture, adversarial,
  // audit, karen} always pick the strongest HEALTHY selected model.
  if (isNeverDowngradeRole(role) && eligible.length > 0) {
    const strongest = eligible[0];
    return {
      modelId: strongest.id,
      tier: strongest.tier,
      confidence: 1.0,
      ineligibleReasons,
      routingDecisionId,
      reason: REASON.STRONGEST_NEVER_DOWNGRADE,
      fallbackChain,
    };
  }

  // Risk-driven overrides (steps 3 + 4 from IMPROVEMENTS.md line 646).
  // `risk: high` always prefers the strongest healthy regardless of any
  // exact match; `risk: low` always prefers the cheapest healthy. The
  // risk label is the operator's hint about which failure mode to bias
  // against.
  if (eligible.length > 0 && risk === "high") {
    const strongest = eligible[0];
    return {
      modelId: strongest.id,
      tier: strongest.tier,
      confidence: 0.95,
      ineligibleReasons,
      routingDecisionId,
      reason: REASON.STRONGEST_RISK_HIGH,
      fallbackChain,
    };
  }
  if (eligible.length > 0 && risk === "low") {
    const cheapest = [...eligible].sort((a, b) => {
      const ai = TIER_CHEAPNESS.indexOf(a.tier);
      const bi = TIER_CHEAPNESS.indexOf(b.tier);
      if (ai !== bi) return ai - bi;
      if (a.capabilityScore !== b.capabilityScore) return a.capabilityScore - b.capabilityScore;
      return 0;
    })[0];
    return {
      modelId: cheapest.id,
      tier: cheapest.tier,
      confidence: 0.7,
      ineligibleReasons,
      routingDecisionId,
      reason: REASON.CHEAPEST_RISK_LOW,
      fallbackChain,
    };
  }

  // Step 1: exact-capability match. We only consider an EXACT match when
  // the orchestrator supplied capability tokens AND the strongest
  // eligible model has a profile that covers the requested tokens. When
  // `task.capabilities` is empty (the common case for routine dispatches)
  // there is no "exact" target and we fall through to the risk ladder
  // (step 2).
  const requestedCapabilities = features.capabilities ?? [];
  if (requestedCapabilities.length > 0 && eligible.length > 0) {
    const exact = eligible[0];
    if (exact.hasProfile) {
      return {
        modelId: exact.id,
        tier: exact.tier,
        confidence: 1.0,
        ineligibleReasons,
        routingDecisionId,
        reason: REASON.EXACT,
        fallbackChain,
      };
    }
  }

  // Step 2: next stronger from the selected pool (default risk ladder
  // outcome when no exact-capability match was available and risk was
  // medium / unspecified).
  if (eligible.length > 0) {
    const next = eligible[0];
    return {
      modelId: next.id,
      tier: next.tier,
      confidence: 0.85,
      ineligibleReasons,
      routingDecisionId,
      reason: REASON.NEXT_STRONGER,
      fallbackChain,
    };
  }

  // Selected pool non-empty but nothing eligible + healthy. Falls
  // through to session inherit (step 5).
  return {
    modelId: input.activeSessionModel ?? null,
    tier: input.activeSessionModel ? deriveTier({ id: input.activeSessionModel }) : "default",
    confidence: input.activeSessionModel ? 0.4 : 0,
    ineligibleReasons,
    routingDecisionId,
    reason: input.activeSessionModel ? REASON.SESSION_INHERIT : REASON.NO_ELIGIBLE,
    fallbackChain,
  };
}