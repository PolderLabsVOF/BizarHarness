/**
 * router/model-profile.ts — Discriminated ModelProfile schema (F-190 / IMP-017).
 *
 * Closes the IMP-017 gap from `IMPROVEMENTS.md` line 870 — the picker writes
 * a loose `ModelCapabilityProfile` (F-184) shape, but the dispatch selector
 * needs a single object that distinguishes:
 *
 *   - `protocol` — wire-level capabilities published by the upstream
 *     provider / Models.dev (tools, reasoning, modalities, structured output,
 *     context / output tokens). These are HARD floors: a model missing
 *     required reasoning or with too small a context window is rejected
 *     outright.
 *   - `measured` — learned quality signals (coding, debugging, architecture,
 *     security, research, visual, reliability, latency, cost). These are
 *     used for tie-breaking in the ranking ladder, never for hard
 *     eligibility — a model with poor measured coding is still eligible
 *     when no better option exists.
 *   - `provenance` — when / how the profile was last refreshed, the match
 *     type used to bind the gateway ID to the catalogue ID, and a
 *     confidence score (0..1). Drives `isStale` and the refresh-gate.
 *   - `operatorOverrides` — fields set explicitly by the operator that
 *     survive catalogue refresh (re-enable a capability the catalogue
 *     marked false; widen a context window the catalogue under-reported).
 *   - `serving` — provider-specific metadata sourced from
 *     `https://models.dev/catalog.json` (gateway alias, rate limits,
 *     provider endpoint).
 *
 * Helpers:
 *
 *   - `mergeProfile(fetched, operatorOverrides)` — layer overrides on top
 *     of fetched metadata; the canonical merge used by both the picker
 *     write path and the refresh path.
 *   - `isStale(profile, now)` — true when `now >= expiresAt` (7 days after
 *     `retrievedAt` for catalogue sources; far future for operator-only
 *     profiles).
 *   - `needsRefresh(profile, now)` — true when `now >= refreshRequiredAfter`
 *     (the more aggressive of expiresAt minus a one-day window).
 *   - `protocolMeets(profile, requirements)` — IMP-017 acceptance gate.
 *     Returns the list of strings the selector surfaces in
 *     `ModelDecision.ineligibleReasons` for each violated floor.
 *   - `measuredScore(profile, capability)` — measured-quality tie-breaker.
 *     Returns 0 when no measured value exists for `capability`.
 *
 * Why a separate module: keeps the new discriminated schema decoupled from
 * the legacy F-184 `ModelCapabilityProfile` shape (still read for
 * backwards compatibility) and from the selector wrapper shape. The
 * selector consumes `ModelProfile` directly via `protocolMeets`; the
 * legacy `ModelCapabilityProfile` continues to flow through
 * `agent-model-registry.ts:parseCapabilityProfile` for picker read paths.
 */

import type { BizarTier } from "./agent-model-registry.js";

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Public schema                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** Input / output modality tokens accepted by the protocol block. */
export type Modality = "text" | "image" | "audio";

/** Source of a `ModelProfile.provenance` block. */
export type ProfileSource = "gateway" | "models.dev" | "catalog.json" | "operator" | "alias-map";

/** Match confidence category used to bind a gateway ID to a catalogue entry. */
export type ProfileMatchType = "exact" | "normalized" | "alias" | "manual" | "none";

/**
 * Wire-level capabilities. All fields are *protocol floors* — the selector
 * rejects a profile that fails to satisfy any field explicitly required by
 * a `RoleRequirements` block. Numeric values may be missing when the
 * catalogue entry was sparse; missing values pass unknown rather than fail
 * (same convention as F-184 `evaluateRoleRequirements`).
 */
export interface ModelProtocolCapabilities {
  /** Provider supports tool calling. */
  toolUse: boolean;
  /** Provider supports reasoning / extended thinking. */
  reasoning: boolean;
  /** Accepted input modalities. */
  modalities: readonly Modality[];
  /** Provider supports structured JSON output. */
  structuredOutput: boolean;
  /** Maximum context window in tokens. */
  contextTokens: number;
  /** Maximum output tokens per turn. */
  maxOutputTokens: number;
}

/**
 * Measured quality / cost signals. All fields are 0..1 fractions (except
 * latencyMsP50 / costUsdPer1kInput / costUsdPer1kOutput). Missing values
 * degrade gracefully to `undefined`; the selector never refuses a model
 * for a missing measured field — only `protocol` failures reject.
 */
export interface ModelMeasuredCapabilities {
  /** Coding task success rate. 0..1. */
  coding?: number;
  /** Debugging task success rate. 0..1. */
  debugging?: number;
  /** Architecture task success rate. 0..1. */
  architecture?: number;
  /** Security task success rate. 0..1. */
  security?: number;
  /** Research task success rate. 0..1. */
  research?: number;
  /** Visual task success rate (image / multimodal). 0..1. */
  visual?: number;
  /** Reliability as 1 - failure rate. 0..1. */
  reliability?: number;
  /** Median latency in milliseconds. */
  latencyMsP50?: number;
  /** USD per 1000 input tokens. */
  costUsdPer1kInput?: number;
  /** USD per 1000 output tokens. */
  costUsdPer1kOutput?: number;
}

/**
 * Provenance — when / how the profile was sourced. Drives
 * `isStale` and the refresh gate. `expiresAt` for catalogue sources is
 * `retrievedAt + 7d`. `expiresAt` for operator-only profiles is the
 * far future (year 9999) so a refresh never deletes operator overrides.
 */
export interface ModelProfileProvenance {
  source: ProfileSource;
  /** ISO timestamp the profile was last refreshed. */
  retrievedAt: string;
  /** ISO timestamp the profile becomes stale and must be refreshed. */
  expiresAt: string;
  /** ISO timestamp before which the operator should re-run `--refresh`. */
  refreshRequiredAfter: string;
  /** How the gateway ID was bound to the catalogue entry. */
  matchType: ProfileMatchType;
  /** Confidence in the catalogue match (0..1). */
  confidence: number;
}

/**
 * Provider-specific serving metadata, sourced from
 * `https://models.dev/catalog.json`. Honours provider overrides that
 * differ from the base model entry.
 */
export interface ModelServingMetadata {
  /** Provider-assigned gateway ID for the model. */
  gatewayId?: string;
  /** Provider-side rate limit in requests per minute. */
  rateLimitRpm?: number;
  /** Provider endpoint for this specific model. */
  providerEndpoint?: string;
}

/**
 * Discriminated `ModelProfile` shape. Persisted under
 * `model-router.json#userSelected.profiles[id]`. The legacy F-184
 * `ModelCapabilityProfile` shape remains readable for backwards
 * compatibility; new code should consume `ModelProfile` directly.
 */
export interface ModelProfile {
  id: string;
  provider: string;
  tier?: BizarTier;
  enabled: boolean;
  protocol: ModelProtocolCapabilities;
  measured: ModelMeasuredCapabilities;
  provenance: ModelProfileProvenance;
  /** Operator-set overrides that survive catalogue refresh. */
  operatorOverrides?: Partial<ModelProtocolCapabilities & ModelMeasuredCapabilities>;
  /** Provider-specific serving metadata from `catalog.json`. */
  serving?: ModelServingMetadata;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Helpers                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/** Number of milliseconds in one day — used for the refresh window. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Operator profiles never expire (decade-out far future). */
const OPERATOR_FAR_FUTURE = "9999-12-31T23:59:59.999Z";

/**
 * Layer `operatorOverrides` on top of a fetched `ModelProfile`. The
 * selector always consumes the merged shape — `operatorOverrides` is the
 * only escape hatch when the catalogue under-reports a capability
 * (operator can re-enable tool use; widen a context window; etc.).
 *
 * When `operatorOverrides` is empty / missing the input is returned
 * unchanged. The merge produces a *new* profile object — `fetched` is
 * not mutated.
 */
export function mergeProfile(
  fetched: ModelProfile,
  operatorOverrides: Partial<ModelProtocolCapabilities & ModelMeasuredCapabilities> | undefined,
): ModelProfile {
  if (!operatorOverrides || Object.keys(operatorOverrides).length === 0) return fetched;
  const mergedProtocol: ModelProtocolCapabilities = {
    toolUse: pickBool(operatorOverrides.toolUse, fetched.protocol.toolUse),
    reasoning: pickBool(operatorOverrides.reasoning, fetched.protocol.reasoning),
    modalities: Array.isArray(operatorOverrides.modalities) && operatorOverrides.modalities.length > 0
      ? operatorOverrides.modalities.slice()
      : fetched.protocol.modalities.slice(),
    structuredOutput: pickBool(operatorOverrides.structuredOutput, fetched.protocol.structuredOutput),
    contextTokens: pickNumber(operatorOverrides.contextTokens as number | undefined, fetched.protocol.contextTokens) ?? fetched.protocol.contextTokens,
    maxOutputTokens: pickNumber(operatorOverrides.maxOutputTokens as number | undefined, fetched.protocol.maxOutputTokens) ?? fetched.protocol.maxOutputTokens,
  };
  const mergedMeasured: ModelMeasuredCapabilities = {
    coding: pickNumber(operatorOverrides.coding, fetched.measured.coding),
    debugging: pickNumber(operatorOverrides.debugging, fetched.measured.debugging),
    architecture: pickNumber(operatorOverrides.architecture, fetched.measured.architecture),
    security: pickNumber(operatorOverrides.security, fetched.measured.security),
    research: pickNumber(operatorOverrides.research, fetched.measured.research),
    visual: pickNumber(operatorOverrides.visual, fetched.measured.visual),
    reliability: pickNumber(operatorOverrides.reliability, fetched.measured.reliability),
    latencyMsP50: pickNumber(operatorOverrides.latencyMsP50, fetched.measured.latencyMsP50),
    costUsdPer1kInput: pickNumber(operatorOverrides.costUsdPer1kInput, fetched.measured.costUsdPer1kInput),
    costUsdPer1kOutput: pickNumber(operatorOverrides.costUsdPer1kOutput, fetched.measured.costUsdPer1kOutput),
  };
  return {
    ...fetched,
    protocol: mergedProtocol,
    measured: mergedMeasured,
    operatorOverrides,
  };
}

function pickBool(over: boolean | undefined, base: boolean): boolean {
  return typeof over === "boolean" ? over : base;
}

function pickNumber<T>(over: T | undefined, base: T | undefined): T | undefined {
  return over === undefined ? base : over;
}

/**
 * True when the profile's `expiresAt` is in the past relative to `now`.
 * Catalogue-sourced profiles expire 7 days after retrieval. Operator-only
 * profiles never expire (`expiresAt` is set to the far future).
 */
export function isStale(profile: ModelProfile, now: Date = new Date()): boolean {
  const expires = Date.parse(profile.provenance.expiresAt);
  if (!Number.isFinite(expires)) return false;
  return now.getTime() >= expires;
}

/**
 * True when the profile should be re-fetched — `now` is past
 * `refreshRequiredAfter` (one day before `expiresAt`). The one-day
 * buffer ensures a refresh can finish before the profile goes stale.
 * Operator-only profiles never need a refresh.
 */
export function needsRefresh(profile: ModelProfile, now: Date = new Date()): boolean {
  const required = Date.parse(profile.provenance.refreshRequiredAfter);
  if (!Number.isFinite(required)) return false;
  return now.getTime() >= required;
}

/**
 * Compute `expiresAt` / `refreshRequiredAfter` from a `retrievedAt`
 * timestamp. Exposed so the fetcher and the test can produce
 * deterministic provenance.
 */
export function deriveExpiry(retrievedAt: string, now: Date = new Date()): {
  expiresAt: string;
  refreshRequiredAfter: string;
} {
  const base = Date.parse(retrievedAt);
  if (!Number.isFinite(base)) {
    const fallback = now.toISOString();
    return { expiresAt: fallback, refreshRequiredAfter: fallback };
  }
  const expires = new Date(base + 7 * DAY_MS).toISOString();
  const required = new Date(base + 6 * DAY_MS).toISOString();
  return { expiresAt: expires, refreshRequiredAfter: required };
}

/**
 * Make an operator-only profile whose `expiresAt` is the far future.
 * Used when the operator records a manual capability correction that
 * catalogue refresh must never overwrite.
 */
export function operatorExpiry(): {
  expiresAt: string;
  refreshRequiredAfter: string;
} {
  return {
    expiresAt: OPERATOR_FAR_FUTURE,
    refreshRequiredAfter: OPERATOR_FAR_FUTURE,
  };
}

/**
 * IMP-017 acceptance gate — protocol floor check.
 *
 * Returns the list of strings the selector surfaces in
 * `ModelDecision.ineligibleReasons` when a profile fails to satisfy
 * the supplied requirements. Each string is `<floor>: <actual>`
 * shaped so a downstream operator can read the failure mode without
 * context-switching into the schema docs.
 *
 * `protocolMeets` is the ONLY function the central selector calls for
 * protocol-floor eligibility — the F-184 `evaluateRoleRequirements`
 * helper continues to exist for tier-preference filtering but is no
 * longer the single source of truth for hard floors.
 */
export function protocolMeets(
  profile: ModelProfile,
  requirements: {
    minContextTokens?: number;
    requireReasoning?: boolean;
    requireToolCall?: boolean;
    requireStructuredOutput?: boolean;
    requireImageInput?: boolean;
  },
): string[] {
  const reasons: string[] = [];
  if (typeof requirements.minContextTokens === "number" && profile.protocol.contextTokens < requirements.minContextTokens) {
    reasons.push(`context-too-small: ${profile.protocol.contextTokens} < ${requirements.minContextTokens}`);
  }
  if (requirements.requireToolCall === true && profile.protocol.toolUse !== true) {
    reasons.push("no-tool-use");
  }
  if (requirements.requireReasoning === true && profile.protocol.reasoning !== true) {
    reasons.push("no-reasoning");
  }
  if (requirements.requireStructuredOutput === true && profile.protocol.structuredOutput !== true) {
    reasons.push("no-structured-output");
  }
  if (requirements.requireImageInput === true && !profile.protocol.modalities.includes("image")) {
    reasons.push("no-image-input");
  }
  return reasons;
}

/**
 * Measured-quality tie-breaker. Returns the measured value for
 * `capability` (one of `coding`, `debugging`, `architecture`, `security`,
 * `research`, `visual`, `reliability`) or `0` when no measured value is
 * recorded. Cost / latency are not surfaced through this helper — they
 * belong to the budget filter in the selector.
 */
export function measuredScore(profile: ModelProfile, capability: string): number {
  const value = (profile.measured as Record<string, number | undefined>)[capability];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}