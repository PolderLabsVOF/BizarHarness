/** Dynamic model-tier registry shared with the Bizar CLI. */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * `BIZAR_HOME` resolver — kept in sync with `cli/provision.mjs#BIZAR_HOME`
 * and `cli/install/paths.mjs`. The router file is operator-controlled
 * state that must survive cwd changes and `bizar install --force` clean
 * runs, so the SDK reads it from `BIZAR_HOME` (the same path the CLI
 * writes to via `cli/commands/models.mjs`).
 */
function bizarHome(): string {
  if (process.env.BIZAR_HOME && process.env.BIZAR_HOME.trim()) {
    return process.env.BIZAR_HOME;
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  const home = osHomedir();
  return xdg && xdg.trim() ? join(xdg, "bizar") : join(home, ".config", "bizar");
}

export type BizarTier = "premium" | "high" | "mid-design" | "default" | "mid" | "budget";

export type ModelRegistryErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID"
  | "MODEL_POLICY_INVALID"
  | "UNKNOWN_TIER"
  | "RUN_ID_REQUIRED";

export class ModelRegistryError extends Error {
  readonly code: ModelRegistryErrorCode;
  constructor(code: ModelRegistryErrorCode, message: string) {
    super(message);
    this.name = "ModelRegistryError";
    this.code = code;
  }
}

export interface TierModelEntry {
  tier: BizarTier;
  modelIds: readonly string[];
  purpose: string;
  effort: string | null;
}

export interface ResolvedTierModel extends TierModelEntry {
  modelId: string | null;
  fallback: readonly string[];
  endpoint: string | null;
  inheritSession: boolean;
}

export interface AgentModelEntry {
  agent: string;
  tier: BizarTier;
  modelId: string | null;
  inheritSession: boolean;
  rationale: string;
}

export interface ResolvedAgentModel extends AgentModelEntry {
  endpoint: string | null;
}

export interface GatewayPolicy extends Record<string, unknown> {
  endpoint?: string;
  availabilityProbe?: string;
  unavailableBehavior?: string;
}

export interface ModelRegistryPolicy extends Record<string, unknown> {
  mainOrchestrator: string;
  selectionOwner?: string;
  discoveryFailure?: string;
  unavailableModel?: string;
  retryModelAliases?: boolean;
  maxDispatchModelAttempts?: number;
}

/**
 * Capability profile for a single selected model. Shape mirrors
 * `cli/commands/models.mjs:toCapabilityProfile` so the picker can persist
 * it under `userSelected.profiles` and the SDK resolver can consume it
 * without re-fetching Models.dev. All fields are optional on read — the
 * resolver tolerates partial profiles (legacy entries or sparse fetches).
 */
export interface ModelCapabilityProfile {
  name?: string;
  baseModel?: string | null;
  family?: string | null;
  gatewayId?: string | null;
  capabilities?: {
    attachment?: boolean;
    reasoning?: boolean;
    toolCall?: boolean;
    structuredOutput?: boolean;
    temperature?: boolean;
    inputModalities?: readonly string[];
    outputModalities?: readonly string[];
  };
  limits?: {
    contextTokens?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
  };
  releaseDate?: string | null;
  lastUpdated?: string | null;
  metadata?: {
    source?: string;
    sourceUrl?: string | null;
    retrievedAt?: string | null;
    matchType?: string;
    confidence?: number;
  };
}

/**
 * Block of user-controlled model picks. Persisted under
 * `model-router.json#userSelected`. The orchestrator dispatches subagents
 * using ONLY these IDs (plus the active session model). The picker is the
 * discovery surface — live gateway discovery is NOT required to validate
 * picks.
 *
 * `profiles` carries Models.dev-derived capability metadata for each
 * selected ID (F-166 + Models.dev enrichment). The resolver
 * (`rankUserSelectedForRole`) uses `profiles` to rank eligible candidates;
 * entries with no profile still participate in ranking (they sort last).
 */
export interface UserSelectedModels {
  models: string[];
  lastUpdated?: string;
  source?: string;
  tierHints?: Partial<Record<BizarTier, string[]>> & Record<string, BizarTier>;
  profiles?: Record<string, ModelCapabilityProfile>;
}

/**
 * Optional requirements used by `rankUserSelectedForRole` to filter
 * candidates. Defaults are permissive (no floors): every candidate is
 * eligible when no requirements are supplied.
 */
export interface RoleRequirements {
  /** Minimum context window in tokens. Profiles with `null`/missing context pass. */
  minContextTokens?: number;
  /** Require reasoning capability. */
  requireReasoning?: boolean;
  /** Require tool-calling capability. */
  requireToolCall?: boolean;
  /** Require structured-output capability. */
  requireStructuredOutput?: boolean;
  /** Require image input modality. */
  requireImageInput?: boolean;
  /** Eligible only when derived tier is in this list. Empty/missing = no constraint. */
  preferredTiers?: readonly BizarTier[];
}

/**
 * A ranked user-selected model candidate. Sort order is
 * `(eligible desc, capabilityScore desc, hasProfile desc, originalIndex asc)`.
 */
export interface RankedUserSelectedEntry {
  id: string;
  tier: BizarTier;
  eligible: boolean;
  ineligibleReasons: string[];
  capabilityScore: number;
  hasProfile: boolean;
  originalIndex: number;
}

export interface ModelRegistry {
  version: string;
  endpoint: string | null;
  configuredEndpoint: string | null;
  gateway: GatewayPolicy;
  policies: ModelRegistryPolicy;
  tiers: Map<BizarTier, TierModelEntry>;
  roleDefaults: Map<string, BizarTier>;
  userSelected?: UserSelectedModels;
}

export interface RunAssignmentSnapshot {
  runId: string;
  routerVersion: string;
  gatewayEndpoint: string | null;
  availabilityProbe: string | null;
  discoveryAttempted: boolean;
  decisions: Record<string, { tier: BizarTier; model: string | null; inheritSession: boolean; reason: string }>;
  createdAt: string;
  fingerprint: string;
}

interface RegistrySource { configPath?: string; cwd?: string; data?: unknown }

function registryError(code: ModelRegistryErrorCode, message: string): never {
  throw new ModelRegistryError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function modelIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))]
    : [];
}

function defaultConfigPath(_cwd = process.cwd()): string {
  // Anchor on BIZAR_HOME — the router file is operator-controlled state
  // that must survive cwd changes and `bizar install --force` clean runs.
  // The `_cwd` parameter is retained for the explicit `configPath` branch
  // (relative `BIZAR_MODEL_ROUTER_CONFIG` overrides still resolve against
  // it for tests that pre-stage the file in a tmp dir).
  return join(bizarHome(), "config", "claude", "model-router.json");
}

export function loadModelRegistry(src: RegistrySource = {}): ModelRegistry {
  let raw: unknown = src.data;
  if (raw === undefined) {
    const configPath = src.configPath
      ? (isAbsolute(src.configPath) ? src.configPath : resolve(src.cwd || process.cwd(), src.configPath))
      : defaultConfigPath(src.cwd);
    try { raw = JSON.parse(readFileSync(configPath, "utf8")); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      registryError(message.includes("ENOENT") ? "CONFIG_NOT_FOUND" : "CONFIG_INVALID", `Cannot load model router: ${message}`);
    }
  }
  if (!isRecord(raw)) registryError("CONFIG_INVALID", "Model router must be an object.");
  if (!isRecord(raw.tiers) || Object.keys(raw.tiers).length === 0) registryError("CONFIG_INVALID", "Model router must define tiers.");
  if (!isRecord(raw.policies) || raw.policies.selectionOwner !== "orchestrator") registryError("MODEL_POLICY_INVALID", "The orchestrator must own model selection.");
  const fallbackPolicies = new Set(["inherit-session", "configured-tier-fallback"]);
  if (!fallbackPolicies.has(String(raw.policies.discoveryFailure)) || !fallbackPolicies.has(String(raw.policies.unavailableModel))) {
    registryError("MODEL_POLICY_INVALID", "Discovery and unavailable-model failures must use an explicit configured policy.");
  }
  if (raw.policies.retryModelAliases !== false || raw.policies.maxDispatchModelAttempts !== 1) {
    registryError("MODEL_POLICY_INVALID", "Model alias retries are forbidden.");
  }
  const tiers = new Map<BizarTier, TierModelEntry>();
  for (const [name, value] of Object.entries(raw.tiers)) {
    if (!isRecord(value)) registryError("CONFIG_INVALID", `Tier ${name} is invalid.`);
    const ids = modelIds(value.models);
    if (ids.length === 0) registryError("CONFIG_INVALID", `Tier ${name} has no candidate models.`);
    tiers.set(name as BizarTier, { tier: name as BizarTier, modelIds: ids, purpose: String(value.purpose || ""), effort: typeof value.effort === "string" ? value.effort : null });
  }
  const roleDefaults = new Map<string, BizarTier>();
  if (isRecord(raw.roleDefaults)) for (const [agent, tier] of Object.entries(raw.roleDefaults)) if (typeof tier === "string") roleDefaults.set(agent, tier as BizarTier);
  const gateway = isRecord(raw.gateway) ? raw.gateway : {};
  const configuredEndpoint = typeof raw.endpoint === "string" ? raw.endpoint : typeof gateway.endpoint === "string" ? gateway.endpoint : null;
  const endpoint = process.env.BIZAR_MODEL_ROUTER_URL ?? process.env.ANTHROPIC_BASE_URL ?? configuredEndpoint;
  const userSelected = parseUserSelected(raw.userSelected);
  return { version: String(raw.version || "unknown"), endpoint, configuredEndpoint, gateway, policies: raw.policies as ModelRegistry["policies"], tiers, roleDefaults, ...(userSelected ? { userSelected } : {}) };
}

function parseUserSelected(raw: unknown): UserSelectedModels | undefined {
  if (!isRecord(raw)) return undefined;
  const models = modelIds(raw.models);
  const tierHints = isRecord(raw.tierHints) ? Object.fromEntries(Object.entries(raw.tierHints).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v as BizarTier])) : undefined;
  const profiles = parseUserSelectedProfiles(raw.profiles);
  if (models.length === 0 && !tierHints && !profiles) return undefined;
  const block: UserSelectedModels = {
    models,
    lastUpdated: typeof raw.lastUpdated === "string" ? raw.lastUpdated : undefined,
    source: typeof raw.source === "string" ? raw.source : undefined,
  };
  if (tierHints) block.tierHints = tierHints;
  if (profiles) block.profiles = profiles;
  return block;
}

/**
 * Defensive reader for `userSelected.profiles`. Mirrors the shape
 * produced by `cli/commands/models.mjs:toCapabilityProfile`. Invalid
 * entries (non-objects, wrong primitive types) are skipped silently so
 * a single corrupt profile never poisons the whole registry — this is
 * the F-184 fix that closes the IMP-016 entry in `IMPROVEMENTS.md`.
 */
function parseUserSelectedProfiles(raw: unknown): Record<string, ModelCapabilityProfile> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, ModelCapabilityProfile> = {};
  let any = false;
  for (const [id, value] of Object.entries(raw)) {
    if (typeof id !== "string" || !id.trim() || !isRecord(value)) continue;
    const profile = parseCapabilityProfile(value);
    if (profile) {
      out[id.trim()] = profile;
      any = true;
    }
  }
  return any ? out : undefined;
}

function parseCapabilityProfile(raw: Record<string, unknown>): ModelCapabilityProfile | undefined {
  if (!isRecord(raw)) return undefined;
  const caps = isRecord(raw.capabilities) ? raw.capabilities : {};
  const lims = isRecord(raw.limits) ? raw.limits : {};
  const meta = isRecord(raw.metadata) ? raw.metadata : {};
  return {
    name: typeof raw.name === "string" ? raw.name : undefined,
    baseModel: raw.baseModel === null || typeof raw.baseModel === "string" ? raw.baseModel : undefined,
    family: raw.family === null || typeof raw.family === "string" ? raw.family : undefined,
    gatewayId: raw.gatewayId === null || typeof raw.gatewayId === "string" ? raw.gatewayId : undefined,
    capabilities: {
      attachment: caps.attachment === true,
      reasoning: caps.reasoning === true,
      toolCall: caps.toolCall === true,
      structuredOutput: caps.structuredOutput === true,
      temperature: caps.temperature !== false,
      inputModalities: Array.isArray(caps.inputModalities) ? caps.inputModalities.filter((m): m is string => typeof m === "string") : undefined,
      outputModalities: Array.isArray(caps.outputModalities) ? caps.outputModalities.filter((m): m is string => typeof m === "string") : undefined,
    },
    limits: {
      contextTokens: lims.contextTokens === null || Number.isFinite(lims.contextTokens) ? (lims.contextTokens as number | null) : undefined,
      inputTokens: lims.inputTokens === null || Number.isFinite(lims.inputTokens) ? (lims.inputTokens as number | null) : undefined,
      outputTokens: lims.outputTokens === null || Number.isFinite(lims.outputTokens) ? (lims.outputTokens as number | null) : undefined,
    },
    releaseDate: raw.releaseDate === null || typeof raw.releaseDate === "string" ? raw.releaseDate : undefined,
    lastUpdated: raw.lastUpdated === null || typeof raw.lastUpdated === "string" ? raw.lastUpdated : undefined,
    metadata: Object.keys(meta).length > 0 ? {
      source: typeof meta.source === "string" ? meta.source : undefined,
      sourceUrl: meta.sourceUrl === null || typeof meta.sourceUrl === "string" ? meta.sourceUrl : undefined,
      retrievedAt: meta.retrievedAt === null || typeof meta.retrievedAt === "string" ? meta.retrievedAt : undefined,
      matchType: typeof meta.matchType === "string" ? meta.matchType : undefined,
      confidence: Number.isFinite(meta.confidence) ? (meta.confidence as number) : undefined,
    } : undefined,
  };
}

/**
 * Default tier classification for a model ID, mirroring the heuristic
 * exported from `cli/commands/models.mjs:defaultTierHint`. The picker
 * uses the same regex set; this SDK-side helper guarantees the
 * resolver can derive a tier for any selected ID even when
 * `userSelected.tierHints` is missing. Most-specific patterns run first
 * so `haiku-4-x` lands in `high` and bare `haiku` lands in `budget`.
 */
export function defaultTierHintForId(modelId: string): BizarTier {
  const id = String(modelId || "").toLowerCase();
  if (!id) return "default";
  if (/(qwen3\.8|gpt-5|opus|o3-pro|o4-mini|sonnet-4)/.test(id)) return "premium";
  if (/(haiku-4|sonnet-3-7|mini-high|m3-high|grok-3)/.test(id)) return "high";
  if (/(sonnet|gpt-4|m3(-|$)|(^|[^a-z])default($|[^a-z]))/.test(id)) return "default";
  if (/(nano|mini[-/]|flash|lite|tiny|haiku($|[-_]\d))/.test(id)) return "budget";
  return "mid";
}

/**
 * Resolve the model ID for a tier.
 *
 * Precedence (F-184):
 *   1. If `registry.userSelected.models` is non-empty, rank the pool via
 *      `rankUserSelectedForRole` and pick the first *eligible* candidate.
 *      When `availableModelIds` is provided, that pick is intersected with
 *      the live set; no intersection falls through to (2).
 *   2. Otherwise (or when the user-selected pick has no eligible live
 *      candidate), use the first live entry from `registry.tiers[tier]`.
 *   3. When no live candidate exists, use the configured tier fallback when
 *      policy requires it. Legacy `inherit-session` registries may return
 *      `null`; the shipped Bizar policy never does.
 *
 * Failover (F-185 / IMP-019): callers needing health-aware failover
 * should chain `pickFailover` (from `./failover.js`) against this
 * registry after a transport/availability failure. `resolveTierModel`
 * intentionally returns a single-shot decision; the cap on
 * `maxDispatchModelAttempts: 1` is preserved here, and the 1-failover
 * cap for selected-pool failover lives in `pickFailover`.
 */
export function resolveTierModel(tier: BizarTier, registry: ModelRegistry, availableModelIds?: readonly string[]): ResolvedTierModel {
  const entry = registry.tiers.get(tier);
  if (!entry) registryError("UNKNOWN_TIER", `Unknown model tier ${tier}.`);
  const available = availableModelIds === undefined ? null : new Set(availableModelIds);
  const userSelected = registry.userSelected;
  if (userSelected && userSelected.models.length > 0) {
    const { eligible } = rankUserSelectedForRole(registry, String(tier));
    const pick = available ? eligible.find((entry) => available.has(entry.id)) : eligible[0];
    if (pick) {
      return { ...entry, modelId: pick.id, fallback: [], endpoint: registry.endpoint, inheritSession: false };
    }
  }
  const live = available ? entry.modelIds.find((id) => available.has(id)) || null : null;
  const policy = available === null ? registry.policies.discoveryFailure : registry.policies.unavailableModel;
  const selected = live || (policy === "configured-tier-fallback" ? entry.modelIds[0] || null : null);
  return { ...entry, modelId: selected, fallback: [], endpoint: registry.endpoint, inheritSession: selected === null };
}

/**
 * Resolve the model ID for an agent.
 *
 * Rationale values:
 *   - `"userSelected-ranked"`  — picked from the operator's userSelected pool.
 *   - `"first live tier candidate"` — fell through to the tier default (live).
 *   - `"configured tier fallback"` — no live candidate; explicit configured model retained.
 *   - `"inherit active session model"` — legacy opt-in policy only.
 */
export function resolveAgentModel(agent: string, registry: ModelRegistry, availableModelIds?: readonly string[], tier?: BizarTier): ResolvedAgentModel {
  const chosenTier = tier || registry.roleDefaults.get(agent) || "default";
  const resolved = resolveTierModel(chosenTier, registry, availableModelIds);
  const rationale = !resolved.modelId
    ? "inherit active session model"
    : registry.userSelected && registry.userSelected.models.includes(resolved.modelId)
      ? "userSelected-ranked"
      : availableModelIds !== undefined && !availableModelIds.includes(resolved.modelId)
        ? "configured tier fallback"
        : "first live tier candidate";
  return { agent, tier: chosenTier, modelId: resolved.modelId, inheritSession: resolved.inheritSession, rationale, endpoint: registry.endpoint };
}

export function listAgentModels(registry: ModelRegistry): AgentModelEntry[] {
  return Array.from(registry.roleDefaults, ([agent, tier]) => resolveAgentModel(agent, registry, undefined, tier));
}

/**
 * Rank user-selected models for a role. Pure function — no I/O, no side
 * effects. Used by `resolveTierModel` to honour the operator's selection
 * before falling back to the live tier candidates.
 *
 * Sorting rules (descending primary, ascending tie-breaker):
 *   1. `eligible` desc      — role floors pass
 *   2. `capabilityScore` desc — weighted capability sum
 *   3. `hasProfile` desc    — profiles beat unprofiled
 *   4. `originalIndex` asc  — first selected wins
 *
 * Hard-floor defaults are permissive: with no `requirements`, every
 * candidate is eligible. Profile-less candidates stay last via
 * `hasProfile=false` but still participate.
 *
 * @param registry Model registry (`registry.userSelected.models` is the pool).
 * @param role Free-form role label (kept for future filtering / logs).
 * @param requirements Optional eligibility floors.
 */
export function rankUserSelectedForRole(registry: ModelRegistry, role: string, requirements: RoleRequirements = {}): { ranked: RankedUserSelectedEntry[]; eligible: RankedUserSelectedEntry[] } {
  const candidates = userSelectedModelIds(registry);
  if (candidates.length === 0) return { ranked: [], eligible: [] };
  const tierHints = registry.userSelected?.tierHints;
  const profiles = registry.userSelected?.profiles;
  const ranked: RankedUserSelectedEntry[] = candidates.map((id, originalIndex) => {
    const profile = profiles?.[id];
    const hasProfile = Boolean(profile);
    const tier = (tierHints && typeof tierHints[id] === "string" ? tierHints[id] : defaultTierHintForId(id)) as BizarTier;
    const { eligible, ineligibleReasons } = evaluateRoleRequirements(profile, requirements, tier);
    const capabilityScore = scoreCapabilityProfile(profile);
    const entry: RankedUserSelectedEntry = { id, tier, eligible, ineligibleReasons, capabilityScore, hasProfile, originalIndex };
    return entry;
  });
  ranked.sort(compareRankedEntries);
  const eligible = ranked.filter((entry) => entry.eligible);
  // role is consumed only for future per-role filtering / logging hooks.
  void role;
  return { ranked, eligible };
}

/**
 * Pure sorter extracted for testability. Mutates and returns the input
 * array. Sort key: `(eligible desc, capabilityScore desc, hasProfile desc,
 * originalIndex asc)`.
 */
export function compareRankedEntries(a: RankedUserSelectedEntry, b: RankedUserSelectedEntry): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  if (a.capabilityScore !== b.capabilityScore) return b.capabilityScore - a.capabilityScore;
  if (a.hasProfile !== b.hasProfile) return a.hasProfile ? -1 : 1;
  return a.originalIndex - b.originalIndex;
}

/**
 * Weighted capability score: reasoning=0.3, toolCall=0.25,
 * structuredOutput=0.15, attachment=0.1, temperature=0.05,
 * +0.15 when `inputModalities` includes "image". Missing/partial
 * profiles score 0 — they sort last via `hasProfile=false`.
 */
export function scoreCapabilityProfile(profile: ModelCapabilityProfile | undefined): number {
  if (!profile || !profile.capabilities) return 0;
  const caps = profile.capabilities;
  let score = 0;
  if (caps.reasoning) score += 0.3;
  if (caps.toolCall) score += 0.25;
  if (caps.structuredOutput) score += 0.15;
  if (caps.attachment) score += 0.1;
  if (caps.temperature) score += 0.05;
  if (Array.isArray(caps.inputModalities) && caps.inputModalities.includes("image")) score += 0.15;
  return Math.round(score * 1e6) / 1e6;
}

/**
 * Evaluate the role requirements against a (possibly missing) profile.
 * Returns `eligible=true` with no reasons when no requirements are set.
 * Profiles missing the relevant data (e.g., `null` context tokens) pass
 * unknown-values — the resolver only downgrades when a known value
 * violates a floor.
 */
export function evaluateRoleRequirements(profile: ModelCapabilityProfile | undefined, requirements: RoleRequirements, tier: BizarTier): { eligible: boolean; ineligibleReasons: string[] } {
  const reasons: string[] = [];
  if (typeof requirements.minContextTokens === "number" && profile?.limits && Number.isFinite(profile.limits.contextTokens) && (profile.limits.contextTokens as number) < requirements.minContextTokens) {
    reasons.push(`contextTokens ${profile.limits.contextTokens} < required ${requirements.minContextTokens}`);
  }
  if (requirements.requireReasoning && profile?.capabilities && profile.capabilities.reasoning !== true) {
    reasons.push("missing required reasoning capability");
  }
  if (requirements.requireToolCall && profile?.capabilities && profile.capabilities.toolCall !== true) {
    reasons.push("missing required tool-call capability");
  }
  if (requirements.requireStructuredOutput && profile?.capabilities && profile.capabilities.structuredOutput !== true) {
    reasons.push("missing required structured-output capability");
  }
  if (requirements.requireImageInput && profile?.capabilities && !(Array.isArray(profile.capabilities.inputModalities) && profile.capabilities.inputModalities.includes("image"))) {
    reasons.push("missing required image input modality");
  }
  if (Array.isArray(requirements.preferredTiers) && requirements.preferredTiers.length > 0 && !requirements.preferredTiers.includes(tier)) {
    reasons.push(`tier ${tier} not in preferred list`);
  }
  return { eligible: reasons.length === 0, ineligibleReasons: reasons };
}

/**
 * The set of model IDs the orchestrator is allowed to dispatch to, derived
 * from `registry.userSelected`. When `userSelected` is missing or empty,
 * the function returns an empty array and the orchestrator MUST inherit the
 * active session model instead.
 */
export function userSelectedModelIds(registry: ModelRegistry): string[] {
  if (!registry.userSelected) return [];
  return [...new Set(registry.userSelected.models.filter((m) => typeof m === "string" && m.trim()))];
}

export function getEndpoint(registry?: ModelRegistry): string | null {
  return registry?.endpoint ?? loadModelRegistry().endpoint;
}

/**
 * F-190 / IMP-017 explicit alias map. Reads from
 * `~/.config/bizar/alias-map.json` so the operator can bind gateway IDs
 * that cannot be matched conservatively (normalised / unique) to a
 * specific catalogue ID. Format:
 *
 *   { "gateway/alias-id": { "modelId": "provider/catalogue-id", "matchType": "alias" } }
 *
 * Missing or unreadable file ⇒ empty map. The CLI fetcher honours the
 * alias map before falling through to the conservative matcher.
 */
export interface AliasMapEntry {
  /** Canonical catalogue ID the gateway alias resolves to. */
  modelId: string;
  /** Match type stamped on the profile's provenance block. */
  matchType: "alias" | "manual";
  /** Optional confidence override (defaults to 1.0 for explicit aliases). */
  confidence?: number;
}

export type AliasMap = Readonly<Record<string, AliasMapEntry>>;

/**
 * Read the alias map from `~/.config/bizar/alias-map.json`. Returns an
 * empty map when the file is missing or unreadable. The CLI is the
 * canonical writer — see `cli/commands/models.mjs`. This helper is
 * pure I/O and tolerates a missing file so callers in tests do not need
 * to seed the path.
 */
export function getAliasMap(homedir: string = osHomedir()): AliasMap {
  const path = resolve(homedir, ".config", "bizar", "alias-map.json");
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(raw)) return {};
    const out: Record<string, AliasMapEntry> = {};
    for (const [alias, value] of Object.entries(raw)) {
      if (typeof alias !== "string" || !alias.trim()) continue;
      if (!isRecord(value)) continue;
      const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
      if (!modelId) continue;
      const matchType: AliasMapEntry["matchType"] = value.matchType === "manual" ? "manual" : "alias";
      const confidence = Number.isFinite(value.confidence) ? Number(value.confidence) : 1.0;
      out[alias.trim()] = { modelId, matchType, confidence };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Layer provider-specific serving metadata from
 * `https://models.dev/catalog.json` on top of base `ModelProfile[]`.
 * The base profiles carry provider-agnostic metadata from
 * `https://models.dev/models.json`; `catalog.json` adds rate limits,
 * provider endpoints, and provider-side gateway IDs that differ for
 * some hosted deployments. Operator-set `serving` fields are NOT
 * overwritten — the operator's serving overrides win on collision.
 */
export interface ServingMetadataEntry {
  gatewayId?: string;
  rateLimitRpm?: number;
  providerEndpoint?: string;
}

export type ServingMetadata = Readonly<Record<string, ServingMetadataEntry>>;

export function mergeWithServing(
  profiles: readonly { id: string; serving?: ServingMetadataEntry }[],
  serving: ServingMetadata,
): { id: string; serving: ServingMetadataEntry | undefined }[] {
  return profiles.map((profile) => {
    const addition = serving[profile.id];
    if (!addition) return { id: profile.id, serving: profile.serving };
    const merged: ServingMetadataEntry = { ...addition, ...(profile.serving || {}) };
    return { id: profile.id, serving: merged };
  });
}

export interface CreateRunAssignmentSnapshotInput {
  runId: string;
  agentNames?: readonly string[];
  availableModelIds?: readonly string[];
  registry: ModelRegistry;
  createdAt?: string;
}

export function createRunAssignmentSnapshot({ runId, agentNames, availableModelIds, registry, createdAt = new Date().toISOString() }: CreateRunAssignmentSnapshotInput): RunAssignmentSnapshot {
  if (typeof runId !== "string" || !runId.trim()) registryError("RUN_ID_REQUIRED", "A non-empty runId is required.");
  const agents = [...new Set((agentNames || []).filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim()))];
  const decisions = Object.fromEntries(agents.map((agent) => {
    const resolved = resolveAgentModel(agent, registry, availableModelIds);
    const live = resolved.modelId && availableModelIds?.includes(resolved.modelId);
    const reason = resolved.inheritSession
      ? (availableModelIds === undefined ? "model-discovery-unavailable" : "no-tier-candidate-available")
      : live || availableModelIds === undefined ? "live-tier-candidate" : "configured-tier-fallback";
    return [agent, { tier: resolved.tier, model: resolved.modelId, inheritSession: resolved.inheritSession, reason }];
  }));
  const payload = { runId: runId.trim(), routerVersion: registry.version, gatewayEndpoint: registry.endpoint, availabilityProbe: typeof registry.gateway.availabilityProbe === "string" ? registry.gateway.availabilityProbe : null, discoveryAttempted: availableModelIds !== undefined, decisions, createdAt };
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return deepFreeze({ ...payload, fingerprint });
}

export function verifyRunAssignmentSnapshot(snapshot: RunAssignmentSnapshot): boolean {
  if (!snapshot || typeof snapshot !== "object" || typeof snapshot.fingerprint !== "string") return false;
  const { fingerprint, ...payload } = snapshot;
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex") === fingerprint;
}

// ─── F-185 / IMP-019 health-aware selected-pool failover ──────────────────
//
// The failover walker lives in `./failover.js` to keep this file focused
// on registry/parse/resolver responsibilities. Re-exporting the public
// surface here means existing callers that already import from
// `agent-model-registry.js` see the new symbols without a path change.
export {
  pickFailover,
  classifyError,
  TRANSPORT_OR_AVAILABILITY,
  type FailureReason,
  type FailoverVerdict,
  type FailoverChainEntry,
  type PickFailoverInput,
} from "./failover.js";
