/** Dynamic model-tier registry shared with the Bizar CLI. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

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
 * Block of user-controlled model picks. Persisted under
 * `model-router.json#userSelected`. The orchestrator dispatches subagents
 * using ONLY these IDs (plus the active session model). The picker is the
 * discovery surface — live gateway discovery is NOT required to validate
 * picks.
 */
export interface UserSelectedModels {
  models: string[];
  lastUpdated?: string;
  source?: string;
  tierHints?: Partial<Record<BizarTier, string[]>> & Record<string, BizarTier>;
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

function defaultConfigPath(cwd = process.cwd()): string {
  return resolve(cwd, "config", "claude", "model-router.json");
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
  if (raw.policies.discoveryFailure !== "inherit-session" || raw.policies.unavailableModel !== "inherit-session") {
    registryError("MODEL_POLICY_INVALID", "Discovery failures and unavailable models must inherit the session.");
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
  if (models.length === 0 && !tierHints) return undefined;
  return {
    models,
    lastUpdated: typeof raw.lastUpdated === "string" ? raw.lastUpdated : undefined,
    source: typeof raw.source === "string" ? raw.source : undefined,
    ...(tierHints ? { tierHints } : {}),
  };
}

export function resolveTierModel(tier: BizarTier, registry: ModelRegistry, availableModelIds?: readonly string[]): ResolvedTierModel {
  const entry = registry.tiers.get(tier);
  if (!entry) registryError("UNKNOWN_TIER", `Unknown model tier ${tier}.`);
  const available = availableModelIds === undefined ? null : new Set(availableModelIds);
  const selected = available ? entry.modelIds.find((id) => available.has(id)) || null : null;
  return { ...entry, modelId: selected, fallback: [], endpoint: registry.endpoint, inheritSession: selected === null };
}

export function resolveAgentModel(agent: string, registry: ModelRegistry, availableModelIds?: readonly string[], tier?: BizarTier): ResolvedAgentModel {
  const chosenTier = tier || registry.roleDefaults.get(agent) || "default";
  const resolved = resolveTierModel(chosenTier, registry, availableModelIds);
  return { agent, tier: chosenTier, modelId: resolved.modelId, inheritSession: resolved.inheritSession, rationale: resolved.inheritSession ? "inherit active session model" : "first live tier candidate", endpoint: registry.endpoint };
}

export function listAgentModels(registry: ModelRegistry): AgentModelEntry[] {
  return Array.from(registry.roleDefaults, ([agent, tier]) => resolveAgentModel(agent, registry, undefined, tier));
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
    return [agent, { tier: resolved.tier, model: resolved.modelId, inheritSession: resolved.inheritSession, reason: resolved.inheritSession ? (availableModelIds === undefined ? "model-discovery-unavailable" : "no-tier-candidate-available") : "live-tier-candidate" }];
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
