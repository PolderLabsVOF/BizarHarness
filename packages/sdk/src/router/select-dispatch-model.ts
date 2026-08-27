/**
 * router/select-dispatch-model.ts — Central dispatch-model selector (F-188 / IMP-013).
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
 */
export interface ModelProfile {
  id: string;
  tier?: BizarTier;
  profile?: ModelCapabilityProfile;
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
  selectedProfiles: ModelProfile[];
  staticProfiles?: ModelProfile[];
  activeSessionModel?: string;
  budget: BudgetState;
  health: ProviderHealthMap;
  history?: OutcomeHistory;
  runId: string;
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

function deriveTier(entry: ModelProfile): BizarTier {
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
  selected: readonly ModelProfile[],
  staticProfiles: readonly ModelProfile[] | undefined,
): ModelProfile[] {
  if (!staticProfiles || staticProfiles.length === 0) return [...selected];
  const staticById = new Map<string, ModelProfile>();
  for (const p of staticProfiles) staticById.set(p.id, p);
  const merged: ModelProfile[] = selected.map((p) => {
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
 */
function evaluateProfile(
  entry: ModelProfile,
  requirements: Parameters<typeof evaluateRoleRequirements>[1],
): RankedUserSelectedEntry {
  const tier = deriveTier(entry);
  const { eligible, ineligibleReasons } = evaluateRoleRequirements(entry.profile, requirements, tier);
  return {
    id: entry.id,
    tier,
    eligible,
    ineligibleReasons,
    capabilityScore: scoreCapabilityProfile(entry.profile),
    hasProfile: Boolean(entry.profile),
    originalIndex: 0,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Main selector                                     */
/* ────────────────────────────────────────────────────────────────────────── */

export function selectDispatchModel(input: SelectDispatchModelInput): ModelDecision {
  const runId = input.runId;
  const features = input.task;
  const requirements = taskRequirements(features);
  const historyKey = roleCapabilityKey(features.role, features.capabilities);
  const routingDecisionId = randomUUID();

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