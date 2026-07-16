/**
 * router/agent-model-registry.ts — resolve agent → concrete model ID.
 *
 * v10.1.0 — Reads `.claude/model-router.json` (the Bizar model registry)
 * and exposes:
 *
 *   - resolveAgentModel(agent)         → { modelId, tier, endpoint, rationale }
 *   - listAgentModels()                → Array<{ agent, modelId, tier, ... }>
 *   - resolveTierModel(tier)           → { modelId, endpoint, fallback[] }
 *   - getEndpoint()                    → endpoint URL (env override honored)
 *
 * The router decides which tier; this registry decides which concrete
 * model ID lives at that tier and which endpoint URL to call. Together
 * they form the dispatch contract the MCP `route_agent` tool surfaces.
 *
 * Why a separate module: the Thompson-bandit model-router.ts doesn't
 * know about model IDs (it only reasons about `flash / mid / expensive`
 * priors). The agent-registry.ts knows about agent types but not about
 * concrete models. This module is the bridge.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type BizarTier =
  | "premium"
  | "high"
  | "mid-design"
  | "default"
  | "mid"
  | "budget";

export interface AgentModelEntry {
  agent: string;
  modelId: string;
  tier: BizarTier;
  rationale: string;
}

export interface TierModelEntry {
  tier: BizarTier;
  modelIds: string[];
  purpose: string;
}

export interface ResolvedAgentModel {
  agent: string;
  modelId: string;
  tier: BizarTier;
  endpoint: string;
  rationale: string;
}

export interface ResolvedTierModel {
  tier: BizarTier;
  modelId: string;
  fallback: string[];
  endpoint: string;
  purpose: string;
}

export interface ModelRegistry {
  endpoint: string;
  agents: Map<string, AgentModelEntry>;
  tiers: Map<BizarTier, TierModelEntry>;
  fallbackChain: string[];
  gptOnlyFor: string[];
  gptNeverFor: string[];
}

export interface RegistrySource {
  /** Path to `model-router.json`. Default: `.claude/model-router.json`. */
  configPath?: string;
  /** Override the endpoint URL (otherwise read from the JSON). */
  endpoint?: string;
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

function isKnownTier(t: unknown): t is BizarTier {
  return typeof t === "string" && (KNOWN_TIERS as readonly string[]).includes(t);
}

/**
 * Read the registry from disk. Tolerates a missing/corrupt file by
 * returning a minimal registry pointing at the local router default —
 * agents can still operate, just without the per-agent rationale data.
 */
export function loadModelRegistry(src: RegistrySource = {}): ModelRegistry {
  const fp = src.configPath
    ? isAbsolute(src.configPath) ? src.configPath : resolve(src.configPath)
    : resolve(DEFAULT_CONFIG);

  let raw: Partial<ModelRegistryJson> = {};
  if (existsSync(fp)) {
    try {
      raw = JSON.parse(readFileSync(fp, "utf8")) as Partial<ModelRegistryJson>;
    } catch {
      raw = {};
    }
  }

  const endpoint = src.endpoint
    ?? process.env.BIZAR_MODEL_ROUTER_URL
    ?? process.env.ANTHROPIC_BASE_URL
    ?? raw.endpoint
    ?? "http://localhost:20128/v1";

  const agents = new Map<string, AgentModelEntry>();
  if (raw.agents && typeof raw.agents === "object") {
    for (const [name, def] of Object.entries(raw.agents)) {
      if (!def || typeof def !== "object") continue;
      const modelId = typeof def.model === "string" ? def.model : "bizar/MiniMax-M3";
      const tier = isKnownTier(def.tier) ? def.tier : "default";
      const rationale = typeof def.rationale === "string" ? def.rationale : "";
      agents.set(name, { agent: name, modelId, tier, rationale });
    }
  }

  const tiers = new Map<BizarTier, TierModelEntry>();
  if (raw.tiers && typeof raw.tiers === "object") {
    for (const [name, def] of Object.entries(raw.tiers)) {
      if (!def || typeof def !== "object") continue;
      if (!isKnownTier(name)) continue;
      const ids = Array.isArray(def.models) ? def.models.filter((m): m is string => typeof m === "string") : [];
      const purpose = typeof def.purpose === "string" ? def.purpose : "";
      tiers.set(name, { tier: name, modelIds: ids, purpose });
    }
  }

  const fallbackChain = Array.isArray(raw.policies?.fallback_chain)
    ? raw.policies.fallback_chain.filter((m): m is string => typeof m === "string")
    : [];

  const gptOnlyFor = Array.isArray(raw.policies?.gpt_only_for)
    ? raw.policies.gpt_only_for.filter((s): s is string => typeof s === "string")
    : [];

  const gptNeverFor = Array.isArray(raw.policies?.gpt_never_for)
    ? raw.policies.gpt_never_for.filter((s): s is string => typeof s === "string")
    : [];

  return { endpoint, agents, tiers, fallbackChain, gptOnlyFor, gptNeverFor };
}

/**
 * Resolve the concrete model + endpoint for a named agent.
 * Falls back to the default agent entry (or a hard-coded `bizar/MiniMax-M3`
 * if even the default is missing) so a call always returns something
 * usable. Never throws.
 */
export function resolveAgentModel(
  agent: string,
  reg: ModelRegistry,
): ResolvedAgentModel {
  const entry = reg.agents.get(agent)
    ?? reg.agents.get("odin")
    ?? { agent: "odin", modelId: "bizar/MiniMax-M3", tier: "default" as const, rationale: "fallback" };
  return {
    agent: entry.agent,
    modelId: entry.modelId,
    tier: entry.tier,
    endpoint: reg.endpoint,
    rationale: entry.rationale,
  };
}

/**
 * Resolve a tier to its primary model ID + the fallback chain. Always
 * returns at least one model ID.
 */
export function resolveTierModel(tier: BizarTier, reg: ModelRegistry): ResolvedTierModel {
  const entry = reg.tiers.get(tier);
  const primary = entry?.modelIds[0] ?? "bizar/MiniMax-M3";
  const fallback = entry?.modelIds.slice(1) ?? [];
  return {
    tier,
    modelId: primary,
    fallback,
    endpoint: reg.endpoint,
    purpose: entry?.purpose ?? "",
  };
}

/**
 * Return the full agent → model table. Stable order: insertion order from
 * the JSON (preserves whatever order the operator wrote).
 */
export function listAgentModels(reg: ModelRegistry): AgentModelEntry[] {
  return Array.from(reg.agents.values());
}

/**
 * Convenience: read the endpoint from the registry / env. Useful in
 * scripts that don't want to load the full registry just for a URL.
 */
export function getEndpoint(reg?: ModelRegistry): string {
  if (reg) return reg.endpoint;
  return process.env.BIZAR_MODEL_ROUTER_URL
    ?? process.env.ANTHROPIC_BASE_URL
    ?? "http://localhost:20128/v1";
}

interface ModelRegistryJson {
  endpoint?: string;
  tiers?: Partial<Record<BizarTier, { models?: string[]; purpose?: string }>>;
  agents?: Record<string, { model?: string; tier?: string; rationale?: string }>;
  policies?: {
    fallback_chain?: string[];
    gpt_only_for?: string[];
    gpt_never_for?: string[];
    [k: string]: unknown;
  };
}