/**
 * router/index.ts — orchestrator for Bizar's self-learning router.
 *
 * v6.4.0 — F-033. Composes the three sub-routers
 * (`codemod-intent`, `model-router`, `q-learning-router`) into a
 * single precedence chain:
 *
 *     explicit-route (caller-provided) >
 *       codemod-intent ($0 Tier-1 short-circuit) >
 *         q-learning-router (8-action agent pick) >
 *           model-router (Thompson bandit for tier) >
 *             default ("mike", "mid", confidence 0.5)
 *
 * The orchestrator is what the `hooks_route` MCP tool (and any
 * in-process caller such as the office-manager agent) calls to make a routing
 * decision. It surfaces two human-readable tags on `stdout`-equivalent
 * surfaces:
 *
 *   - `[CODEMOD_AVAILABLE] <intent>` — printed BEFORE the model call
 *     would happen, telling the model that a deterministic $0 codemod
 *     could short-circuit the work. Honoured by the office-manager prompt.
 *   - `[TASK_MODEL_RECOMMENDATION] <tier> (conf=<n>)` — appended to
 *     prompt-side telemetry so downstream model selection knows the
 *     bandit-learner thinks this task should be routed to `flash` /
 *     `mid` / `expensive`.
 *
 * Persistence: when constructed via `getRouter({ persist: true })`,
 * the orchestrator holds a single shared `ModelRouter` +
 * `QLearningRouter` whose state lives at `.harness/router-state.json`
 * and `.harness/q-router-state.json` respectively. Callers can also
 * pass `modelRouter` / `qRouter` for in-memory-only operation
 * (preferred in tests).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  detectCodemodIntent,
  type CodemodIntent,
  CODEMOD_CONFIDENCE_THRESHOLD,
} from "./codemod-intent.js";
import {
  ModelRouter,
  type ModelTier,
  type RouteDecision,
} from "./model-router.js";
import {
  QLearningRouter,
  AGENT_ACTIONS,
  type AgentRouteDecision,
} from "./q-learning-router.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RouteInput {
  task: string;
  /** Caller-provided explicit override for the agent (highest precedence). */
  explicitAgent?: string;
  /** Optional embedding — currently ignored (reserved for future ANN
   *  lookup that could refine the state bucket). */
  embedding?: number[];
}

export interface RouteDecisionOutput {
  agent: string;
  modelTier: ModelTier;
  agentConfidence: number;
  modelConfidence: number;
  /** Null unless the prompt matched a Tier-1 codemod intent. */
  codemodIntent: CodemodIntent | null;
  /** `[CODEMOD_AVAILABLE] var-to-const` style surface for prompt pre-injection. */
  surfacedTags: string[];
}

export interface RouterBundle {
  modelRouter: ModelRouter;
  qRouter: QLearningRouter;
  decideAgent(input: RouteInput): RouteDecisionOutput;
  /** Persist both routers to `path`'s sibling state files. */
  saveTo(path: string): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface GetRouterOpts {
  /** When provided, the orchestrator attempts to load priors + Q-table
   *  from `<basePath>.{model,q}` if those files exist; missing files
   *  fall back to defaults. */
  basePath?: string;
  /** In-memory overrides — useful for tests. */
  modelRouter?: ModelRouter;
  qRouter?: QLearningRouter;
}

/** Default state-file paths (kept beside the orchestrator's caller). */
export const DEFAULT_MODEL_STATE_PATH = ".harness/router-state.json";
export const DEFAULT_Q_STATE_PATH = ".harness/q-router-state.json";

/**
 * Build (or rehydrate) a router bundle.
 *
 * Default state files are stored under `.harness/` in the current
 * working directory. Tests typically pass `modelRouter` / `qRouter`
 * to keep things in-process.
 */
export function getRouter(opts: GetRouterOpts = {}): RouterBundle {
  const basePath = opts.basePath ?? join(process.cwd(), ".harness", "router-state");
  const modelPath = `${basePath}.model`;
  const qPath = `${basePath}.q`;

  const modelRouter =
    opts.modelRouter ??
    (existsSync(modelPath) ? ModelRouter.loadFrom(modelPath) : new ModelRouter());
  const qRouter =
    opts.qRouter ??
    (existsSync(qPath) ? QLearningRouter.loadFrom(qPath) : new QLearningRouter());

  return {
    modelRouter,
    qRouter,
    decideAgent(input: RouteInput): RouteDecisionOutput {
      return decideAgentWith(modelRouter, qRouter, input);
    },
    saveTo(path: string): void {
      const fp = isAbsolute(path) ? path : resolve(path);
      mkdirSync(dirname(fp), { recursive: true });
      modelRouter.saveTo(modelPath);
      qRouter.saveTo(qPath);
      // And a tiny pointer file for callers that only know the bundle name.
      writeFileSync(
        fp,
        JSON.stringify({ modelPath, qPath, version: 1 }, null, 2),
        "utf-8",
      );
    },
  };
}

/**
 * Pure, testable entry point — the actual precedence chain.
 *
 * Order:
 *  1. caller-supplied `explicitAgent` wins outright.
 *  2. Tier-1 codemod intent → agent="brenda" (routine implementation),
 *     tier="flash" ($0), confidence 1.0, surface `[CODEMOD_AVAILABLE]`.
 *  3. Q-learning agent pick (clamped to known agent names).
 *  4. Thompson-bandit model-tier pick.
 *  5. Defaults: agent="mike", tier="mid".
 */
export function decideAgentWith(
  modelRouter: ModelRouter,
  qRouter: QLearningRouter,
  input: RouteInput,
): RouteDecisionOutput {
  const task = String(input?.task ?? "");
  const surfacedTags: string[] = [];

  // 1. Explicit override — highest precedence.
  if (input.explicitAgent && AGENT_ACTIONS.includes(input.explicitAgent)) {
    // Still pick a model tier (bandit) so we can surface
    // [TASK_MODEL_RECOMMENDATION] downstream.
    const tier: RouteDecision = modelRouter.route(task);
    surfacedTags.push(tierTag(tier));
    return {
      agent: input.explicitAgent,
      modelTier: tier.tier,
      agentConfidence: 1.0,
      modelConfidence: tier.confidence,
      codemodIntent: null,
      surfacedTags,
    };
  }

  // 2. Codemod short-circuit (only when there's a task string).
  const cm = task ? detectCodemodIntent(task) : null;
  if (cm !== null) {
    surfacedTags.push(codemodTag(cm.intent, cm.confidence));
    // Tier-1 codemod: $0, model tier = "flash" but the call is
    // supposed to be skipped (deterministic). We still set
    // modelTier/Confidence so downstream telemetry has consistent
    // shape.
    surfacedTags.push(tierTag({ tier: "flash", confidence: 1.0 }));
    return {
      agent: "brenda",
      modelTier: "flash",
      agentConfidence: 1.0,
      modelConfidence: 1.0,
      codemodIntent: cm.intent,
      surfacedTags,
    };
  }

  // 3. Q-learning agent pick.
  const agentDecision: AgentRouteDecision = qRouter.selectAgent(task);
  // 4. Thompson bandit for model tier.
  const tierDecision: RouteDecision = modelRouter.route(task);
  surfacedTags.push(tierTag(tierDecision));

  return {
    agent: agentDecision.agent,
    modelTier: tierDecision.tier,
    agentConfidence: agentDecision.confidence,
    modelConfidence: tierDecision.confidence,
    codemodIntent: null,
    surfacedTags,
  };
}

// ---------------------------------------------------------------------------
// Tag formatters — the strings the spec asks us to surface to the prompt.
// ---------------------------------------------------------------------------

export function codemodTag(intent: CodemodIntent, confidence: number): string {
  return `[CODEMOD_AVAILABLE] ${intent} (conf=${confidence.toFixed(2)} >= ${CODEMOD_CONFIDENCE_THRESHOLD.toFixed(2)})`;
}

export function tierTag(decision: RouteDecision): string {
  return `[TASK_MODEL_RECOMMENDATION] ${decision.tier} (conf=${decision.confidence.toFixed(2)})`;
}

// ---------------------------------------------------------------------------
// Convenience re-exports so callers can `import { ... } from "..."/router"
// ---------------------------------------------------------------------------

export {
  detectCodemodIntent,
  CODEMOD_CONFIDENCE_THRESHOLD,
} from "./codemod-intent.js";
export type { CodemodIntent, CodemodIntentHit } from "./codemod-intent.js";

export {
  ModelRouter,
  type ModelTier,
  type RouteDecision,
} from "./model-router.js";

export {
  QLearningRouter,
  AGENT_ACTIONS,
  type AgentName,
  type AgentRouteDecision,
} from "./q-learning-router.js";

export {
  loadModelRegistry,
  resolveAgentModel,
  resolveTierModel,
  rankUserSelectedForRole,
  defaultTierHintForId,
  compareRankedEntries,
  evaluateRoleRequirements,
  scoreCapabilityProfile,
  listAgentModels,
  userSelectedModelIds,
  getEndpoint,
  createRunAssignmentSnapshot,
  verifyRunAssignmentSnapshot,
  ModelRegistryError,
  type ModelRegistry,
  type ModelRegistryPolicy,
  type ModelRegistryErrorCode,
  type GatewayPolicy,
  type RunAssignmentSnapshot,
  type CreateRunAssignmentSnapshotInput,
  type ResolvedAgentModel,
  type ResolvedTierModel,
  type AgentModelEntry,
  type TierModelEntry,
  type UserSelectedModels,
  type ModelCapabilityProfile,
  type RoleRequirements,
  type RankedUserSelectedEntry,
  type BizarTier,
} from "./agent-model-registry.js";
