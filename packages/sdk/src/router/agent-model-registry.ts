/**
 * Strict agent → exact-model registry for Bizar's v2 model-router contract.
 *
 * Role selection happens elsewhere. This module validates the independently
 * configured complexity tiers and exact per-agent assignments, then refuses
 * unknown or unavailable identities instead of substituting another model.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type BizarTier =
  | "premium"
  | "high"
  | "mid-design"
  | "default"
  | "mid"
  | "budget";

export type ModelRegistryErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID"
  | "GATEWAY_POLICY_INVALID"
  | "MODEL_POLICY_INVALID"
  | "UNKNOWN_AGENT"
  | "UNKNOWN_TIER"
  | "RUN_ID_REQUIRED"
  | "GATEWAY_AVAILABILITY_REQUIRED"
  | "DUPLICATE_AGENT_ASSIGNMENT"
  | "REQUESTED_MODEL_UNAVAILABLE"
  | "SNAPSHOT_INVALID";

export class ModelRegistryError extends Error {
  readonly code: ModelRegistryErrorCode;

  constructor(code: ModelRegistryErrorCode, message: string) {
    super(message);
    this.name = "ModelRegistryError";
    this.code = code;
  }
}

export interface AgentModelEntry {
  agent: string;
  modelId: string;
  tier: BizarTier;
  rationale: string;
}

export interface TierModelEntry {
  tier: BizarTier;
  /** Exactly one model ID. Multi-model tier lists are forbidden fallbacks. */
  modelIds: readonly [string];
  purpose: string;
}

export interface ResolvedAgentModel extends AgentModelEntry {
  endpoint: string;
}

export interface ResolvedTierModel {
  tier: BizarTier;
  modelId: string;
  /** Kept for API compatibility; strict v2 registries always return []. */
  fallback: readonly [];
  endpoint: string;
  purpose: string;
}

export interface GatewayPolicy {
  required: true;
  endpoint: string;
  availabilityProbe: string;
  exactModelRequired: true;
  unavailableBehavior: "fail";
}

export interface ModelRegistryPolicy {
  mainOrchestrator: string;
  assignmentSnapshot: "immutable-per-run";
  requireConfiguredGateway: true;
  requireExactRequestedModel: true;
  rejectDispatchModelOverride: true;
  silentFallback: false;
  unavailableModel: "fail-and-report";
}

export interface ModelRegistry {
  version: string;
  /** Effective endpoint; environment/source overrides may change only this. */
  endpoint: string;
  /** Endpoint declared by the validated registry. */
  configuredEndpoint: string;
  gateway: GatewayPolicy;
  policies: ModelRegistryPolicy;
  agents: ReadonlyMap<string, Readonly<AgentModelEntry>>;
  tiers: ReadonlyMap<BizarTier, Readonly<TierModelEntry>>;
}

export interface RegistrySource {
  /** Path to `model-router.json`. Default: `.claude/model-router.json`. */
  configPath?: string;
  /** Endpoint-only override. Exact agent/model identities remain unchanged. */
  endpoint?: string;
}

export interface RunAssignmentSnapshot {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly createdAt: string;
  readonly routerVersion: string;
  readonly gatewayEndpoint: string;
  readonly availabilityProbe: string;
  readonly assignments: Readonly<Record<string, Readonly<{
    /** Canonical snapshot key shared with the CLI workflow state and hooks. */
    model: string;
    tier: BizarTier;
    rationale: string;
  }>>>;
  readonly fingerprint: string;
}

export interface CreateRunAssignmentSnapshotInput {
  runId: string;
  registry: ModelRegistry;
  /** Successful `/models` probe result from `registry.endpoint`. */
  availableModelIds: Iterable<string>;
  /** Defaults to every configured agent. */
  agentNames?: Iterable<string>;
  /** Injectable for deterministic tests/audit replay. */
  createdAt?: string;
}

const DEFAULT_CONFIG = ".claude/model-router.json";
const KNOWN_TIERS: readonly BizarTier[] = [
  "premium",
  "high",
  "mid-design",
  "default",
  "mid",
  "budget",
] as const;

function registryError(code: ModelRegistryErrorCode, message: string): never {
  throw new ModelRegistryError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isKnownTier(value: unknown): value is BizarTier {
  return typeof value === "string" && (KNOWN_TIERS as readonly string[]).includes(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) registryError("CONFIG_INVALID", `${field} must be an object.`);
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function parseGateway(raw: Record<string, unknown>, configuredEndpoint: string): GatewayPolicy {
  const gateway = expectRecord(raw.gateway, "gateway");
  if (
    gateway.required !== true
    || gateway.exactModelRequired !== true
    || gateway.unavailableBehavior !== "fail"
    || !nonEmptyString(gateway.endpoint)
    || !nonEmptyString(gateway.availabilityProbe)
    || gateway.endpoint !== configuredEndpoint
  ) {
    registryError(
      "GATEWAY_POLICY_INVALID",
      "gateway must require the configured endpoint, an availability probe, exact models, and fail-on-unavailable behavior.",
    );
  }
  return {
    required: true,
    endpoint: gateway.endpoint,
    availabilityProbe: gateway.availabilityProbe,
    exactModelRequired: true,
    unavailableBehavior: "fail",
  };
}

function parsePolicies(raw: Record<string, unknown>): ModelRegistryPolicy {
  const policies = expectRecord(raw.policies, "policies");
  const fallbackChain = policies.fallback_chain;
  if (
    !nonEmptyString(policies.mainOrchestrator)
    || policies.assignmentSnapshot !== "immutable-per-run"
    || policies.requireConfiguredGateway !== true
    || policies.requireExactRequestedModel !== true
    || policies.rejectDispatchModelOverride !== true
    || policies.silentFallback !== false
    || policies.unavailableModel !== "fail-and-report"
    || (fallbackChain !== undefined && (!Array.isArray(fallbackChain) || fallbackChain.length !== 0))
  ) {
    registryError(
      "MODEL_POLICY_INVALID",
      "policies must require immutable exact assignments and contain no silent or ordered model fallback.",
    );
  }
  return {
    mainOrchestrator: policies.mainOrchestrator,
    assignmentSnapshot: "immutable-per-run",
    requireConfiguredGateway: true,
    requireExactRequestedModel: true,
    rejectDispatchModelOverride: true,
    silentFallback: false,
    unavailableModel: "fail-and-report",
  };
}

function parseTiers(raw: Record<string, unknown>): Map<BizarTier, Readonly<TierModelEntry>> {
  const rawTiers = expectRecord(raw.tiers, "tiers");
  const tiers = new Map<BizarTier, Readonly<TierModelEntry>>();
  for (const [name, value] of Object.entries(rawTiers)) {
    if (!isKnownTier(name)) registryError("CONFIG_INVALID", `Unknown model tier ${name}.`);
    const tier = expectRecord(value, `tiers.${name}`);
    if (
      !Array.isArray(tier.models)
      || tier.models.length !== 1
      || !nonEmptyString(tier.models[0])
      || !nonEmptyString(tier.purpose)
    ) {
      registryError("MODEL_POLICY_INVALID", `Tier ${name} must define exactly one model and a purpose.`);
    }
    tiers.set(name, Object.freeze({ tier: name, modelIds: [tier.models[0]] as [string], purpose: tier.purpose }));
  }
  if (tiers.size === 0) registryError("CONFIG_INVALID", "At least one model tier is required.");
  return tiers;
}

function parseAgents(
  raw: Record<string, unknown>,
  tiers: ReadonlyMap<BizarTier, Readonly<TierModelEntry>>,
): Map<string, Readonly<AgentModelEntry>> {
  const rawAgents = expectRecord(raw.agents, "agents");
  const agents = new Map<string, Readonly<AgentModelEntry>>();
  for (const [name, value] of Object.entries(rawAgents)) {
    if (!nonEmptyString(name)) registryError("CONFIG_INVALID", "Agent names must be non-empty.");
    const agent = expectRecord(value, `agents.${name}`);
    if (!nonEmptyString(agent.model) || !isKnownTier(agent.tier) || !nonEmptyString(agent.rationale)) {
      registryError("CONFIG_INVALID", `Agent ${name} must define an exact model, known tier, and rationale.`);
    }
    const tier = tiers.get(agent.tier);
    if (!tier || tier.modelIds[0] !== agent.model) {
      registryError("MODEL_POLICY_INVALID", `Agent ${name} model must exactly match tier ${agent.tier}.`);
    }
    agents.set(name, Object.freeze({ agent: name, modelId: agent.model, tier: agent.tier, rationale: agent.rationale }));
  }
  if (agents.size === 0) registryError("CONFIG_INVALID", "At least one agent assignment is required.");
  return agents;
}

/** Load and strictly validate the v2 registry. Missing or invalid input throws. */
export function loadModelRegistry(src: RegistrySource = {}): ModelRegistry {
  const configPath = src.configPath
    ? isAbsolute(src.configPath) ? src.configPath : resolve(src.configPath)
    : resolve(DEFAULT_CONFIG);

  let rawValue: unknown;
  try {
    rawValue = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error: unknown) {
    const code = isRecord(error) && error.code === "ENOENT" ? "CONFIG_NOT_FOUND" : "CONFIG_INVALID";
    const detail = error instanceof Error ? error.message : String(error);
    registryError(code, `Cannot load model registry at ${configPath}: ${detail}`);
  }

  const raw = expectRecord(rawValue, "model registry");
  if (!nonEmptyString(raw.version) || raw.$schema !== "https://bizar.dev/schema/model-router.v2.json") {
    registryError("CONFIG_INVALID", "The model registry must declare the v2 schema and a version.");
  }
  if (!nonEmptyString(raw.endpoint)) registryError("CONFIG_INVALID", "endpoint must be a non-empty string.");

  const gateway = parseGateway(raw, raw.endpoint);
  const policies = parsePolicies(raw);
  const tiers = parseTiers(raw);
  const agents = parseAgents(raw, tiers);
  if (!agents.has(policies.mainOrchestrator)) {
    registryError("MODEL_POLICY_INVALID", `Main orchestrator ${policies.mainOrchestrator} has no exact assignment.`);
  }

  const endpointOverride = src.endpoint
    ?? process.env.BIZAR_MODEL_ROUTER_URL
    ?? process.env.ANTHROPIC_BASE_URL;
  if (endpointOverride !== undefined && !nonEmptyString(endpointOverride)) {
    registryError("GATEWAY_POLICY_INVALID", "The endpoint override must be a non-empty string.");
  }

  return {
    version: raw.version,
    endpoint: endpointOverride ?? raw.endpoint,
    configuredEndpoint: raw.endpoint,
    gateway,
    policies,
    agents,
    tiers,
  };
}

/** Resolve a known agent. Unknown names are configuration errors, not hints. */
export function resolveAgentModel(agent: string, registry: ModelRegistry): ResolvedAgentModel {
  const entry = registry.agents.get(agent);
  if (!entry) registryError("UNKNOWN_AGENT", `No exact model assignment exists for agent ${agent}.`);
  return { ...entry, endpoint: registry.endpoint };
}

/** Resolve a known tier. Strict v2 tiers contain one model and no fallbacks. */
export function resolveTierModel(tier: BizarTier, registry: ModelRegistry): ResolvedTierModel {
  const entry = registry.tiers.get(tier);
  if (!entry) registryError("UNKNOWN_TIER", `No exact model assignment exists for tier ${tier}.`);
  return {
    tier,
    modelId: entry.modelIds[0],
    fallback: [],
    endpoint: registry.endpoint,
    purpose: entry.purpose,
  };
}

export function listAgentModels(registry: ModelRegistry): AgentModelEntry[] {
  return Array.from(registry.agents.values(), (entry) => ({ ...entry }));
}

/** Read the effective endpoint without inventing a default registry/model. */
export function getEndpoint(registry?: ModelRegistry): string {
  return registry?.endpoint ?? loadModelRegistry().endpoint;
}

/**
 * Snapshot exact assignments after a successful gateway availability probe.
 * The returned canonical schemaVersion 1 payload uses the same `model` key and
 * fingerprint algorithm as the CLI workflow snapshot. Every value is frozen.
 */
export function createRunAssignmentSnapshot({
  runId,
  registry,
  availableModelIds,
  agentNames,
  createdAt = new Date().toISOString(),
}: CreateRunAssignmentSnapshotInput): RunAssignmentSnapshot {
  if (!nonEmptyString(runId)) registryError("RUN_ID_REQUIRED", "A non-empty runId is required.");
  if (!availableModelIds || typeof availableModelIds[Symbol.iterator] !== "function") {
    registryError("GATEWAY_AVAILABILITY_REQUIRED", "Gateway model availability evidence is required.");
  }

  const available = new Set(availableModelIds);
  if (available.size === 0) {
    registryError("GATEWAY_AVAILABILITY_REQUIRED", "The configured gateway returned no available models.");
  }
  const requested = agentNames === undefined ? Array.from(registry.agents.keys()) : Array.from(agentNames);
  if (requested.length === 0) registryError("UNKNOWN_AGENT", "At least one agent assignment is required.");
  if (new Set(requested).size !== requested.length) {
    registryError("DUPLICATE_AGENT_ASSIGNMENT", "Each agent may appear only once in a run snapshot.");
  }

  const assignments: Record<string, { model: string; tier: BizarTier; rationale: string }> = {};
  for (const agent of requested) {
    const resolved = resolveAgentModel(agent, registry);
    if (!available.has(resolved.modelId)) {
      registryError(
        "REQUESTED_MODEL_UNAVAILABLE",
        `Configured model ${resolved.modelId} for agent ${agent} is unavailable; refusing silent fallback.`,
      );
    }
    assignments[agent] = {
      model: resolved.modelId,
      tier: resolved.tier,
      rationale: resolved.rationale,
    };
  }

  const payload = {
    schemaVersion: 1 as const,
    runId,
    createdAt,
    routerVersion: registry.version,
    gatewayEndpoint: registry.endpoint,
    availabilityProbe: registry.gateway.availabilityProbe,
    assignments,
  };
  const fingerprint = createHash("sha256").update(stableJson(payload)).digest("hex");
  return deepFreeze({ ...payload, fingerprint });
}

export function verifyRunAssignmentSnapshot(snapshot: RunAssignmentSnapshot): boolean {
  if (!snapshot || !nonEmptyString(snapshot.fingerprint)) return false;
  const { fingerprint, ...payload } = snapshot;
  const expected = createHash("sha256").update(stableJson(payload)).digest("hex");
  return fingerprint === expected;
}
