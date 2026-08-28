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
 *     bandit-learner thinks this task should be routed to one of the
 *     6 canonical tiers (`premium` / `high` / `mid-design` / `default`
 *     / `mid` / `budget`).
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
import { randomUUID } from "node:crypto";

import {
  detectCodemodIntent,
  type CodemodIntent,
  CODEMOD_CONFIDENCE_THRESHOLD,
} from "./codemod-intent.js";
import {
  ModelRouter,
  type RouteDecision,
} from "./model-router.js";
import type { BizarTier } from "./agent-model-registry.js";
import {
  selectDispatchModel,
  type ModelDecision,
  type TaskFeatures,
} from "./select-dispatch-model.js";
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
  /**
   * Optional role label passed through to `selectDispatchModel`. When
   * supplied, `decideAgentWith` runs the F-188 central selector after
   * the precedence chain so the result carries a deterministic
   * `routingDecisionId`. When omitted, the orchestrator falls back to
   * the legacy Tier-1 short-circuit / bandit chain (still returns a
   * `routingDecisionId` for audit traceability, but the selector's
   * eligible-pool / never-downgrade rules are inert).
   */
  role?: string;
  /** Forwarded to `selectDispatchModel` for the risk-keyed ladder. */
  risk?: "low" | "medium" | "high";
  /** Forwarded to `selectDispatchModel` for the exact-capability match. */
  capabilities?: readonly string[];
  /** Pre-validated operator-selected profiles (one per `userSelected` ID). */
  selectedProfiles?: readonly import("./select-dispatch-model.js").ModelCandidate[];
  /** Static tier defaults — metadata, never an exclusion. */
  staticProfiles?: readonly import("./select-dispatch-model.js").ModelCandidate[];
  /** Active session model — used only when the selected pool is empty. */
  activeSessionModel?: string;
  /** Provider health snapshot — failed providers are skipped. */
  health?: import("./select-dispatch-model.js").ProviderHealthMap;
  /** Per-role verified-outcome history (consumed by the selector tie-break). */
  history?: import("./select-dispatch-model.js").OutcomeHistory;
  /** Required when the F-188 selector is exercised; reused as the audit run id. */
  runId?: string;
  /**
   * IMP-020 / F-192 contextual outcome learner. When supplied, the
   * selector consumes `learner.ranking(role, candidates)` to order the
   * eligibility ladder, filters out quarantined models, and respects
   * NEVER_DOWNGRADE_ROLES. Threaded straight through to
   * `selectDispatchModel` — see `./outcome-learner.ts`.
   */
  outcomeLearner?: import("./outcome-learner.js").OutcomeLearner;
}

export interface RouteDecisionOutput {
  agent: string;
  modelTier: BizarTier;
  agentConfidence: number;
  modelConfidence: number;
  /** Null unless the prompt matched a Tier-1 codemod intent. */
  codemodIntent: CodemodIntent | null;
  /** `[CODEMOD_AVAILABLE] var-to-const` style surface for prompt pre-injection. */
  surfacedTags: string[];
  /**
   * Stable UUID anchored to the dispatch decision. Always populated —
   * either by `selectDispatchModel` (when role + profiles are
   * supplied) or by `decideAgentWith` itself for the legacy chains —
   * so the F-185 failover walker and downstream telemetry have a
   * consistent audit-trail key.
   */
  routingDecisionId: string;
  /**
   * Resolved model ID (or `null` for session inheritance). Only
   * populated when the F-188 selector runs end-to-end (i.e., when
   * `input.selectedProfiles` and `input.role` are both supplied).
   */
  modelId: string | null;
  /**
   * Human-readable ladder reason (e.g. `exact-capability`,
   * `next-stronger`, `strongest-healthy-risk-high`,
   * `cheapest-healthy-risk-low`, `strongest-healthy-never-downgrade`,
   * `session-inherit`, `no-eligible-selected`). `null` on the legacy
   * chains that don't invoke the selector.
   */
  selectorReason: string | null;
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
 *     tier="budget" ($0), confidence 1.0, surface `[CODEMOD_AVAILABLE]`.
 *  3. Q-learning agent pick (clamped to known agent names).
 *  4. F-188 `selectDispatchModel` runs when `input.role` and
 *     `input.selectedProfiles` are both supplied — its `modelTier`,
 *     `modelConfidence`, `modelId`, and `routingDecisionId` win
 *     against the Thompson-bandit fallback. The selector is the
 *     IMP-013 mandatory primitive and is the canonical source of
 *     `routingDecisionId`; the legacy bandit chain only contributes
 *     `routingDecisionId` as a placeholder for parity.
 *  5. Thompson-bandit model-tier pick (6-tier vocabulary).
 *  6. Defaults: agent="mike", tier="mid".
 *
 * `routingDecisionId` is always populated — either by the F-188
 * selector or by a stable UUID minted at the top of this function so
 * the F-185 audit trail has a single key across every chain.
 */
export function decideAgentWith(
  modelRouter: ModelRouter,
  qRouter: QLearningRouter,
  input: RouteInput,
): RouteDecisionOutput {
  const task = String(input?.task ?? "");
  const surfacedTags: string[] = [];
  const routingDecisionId = randomUUID();

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
      routingDecisionId,
      modelId: null,
      selectorReason: null,
    };
  }

  // 2. Codemod short-circuit (only when there's a task string).
  const cm = task ? detectCodemodIntent(task) : null;
  if (cm !== null) {
    surfacedTags.push(codemodTag(cm.intent, cm.confidence));
    // Tier-1 codemod: $0, model tier = "budget" (cheapest 6-tier value)
    // but the call is supposed to be skipped (deterministic). We still
    // set modelTier/Confidence so downstream telemetry has consistent
    // shape.
    surfacedTags.push(tierTag({ tier: "budget", confidence: 1.0 }));
    return {
      agent: "brenda",
      modelTier: "budget",
      agentConfidence: 1.0,
      modelConfidence: 1.0,
      codemodIntent: cm.intent,
      surfacedTags,
      routingDecisionId,
      modelId: null,
      selectorReason: null,
    };
  }

  // 3. Q-learning agent pick.
  const agentDecision: AgentRouteDecision = qRouter.selectAgent(task);

  // 4. F-188 central selector — when the orchestrator supplied both the
  // role and the selected/static profile list, the selector wins against
  // the bandit. The selector's `routingDecisionId` is authoritative;
  // for the case where the orchestrator did not supply profiles we still
  // mint a routingDecisionId at the top of the function so the F-185
  // audit trail has a stable key.
  const selectedProfiles = input.selectedProfiles ?? [];
  const staticProfiles = input.staticProfiles ?? [];
  const runId = input.runId ?? "ad-hoc";
  if (input.role !== undefined && (selectedProfiles.length > 0 || input.activeSessionModel !== undefined)) {
    const taskFeatures: TaskFeatures = {
      task,
      role: input.role,
      risk: input.risk,
      capabilities: input.capabilities ? [...input.capabilities] : undefined,
    };
    const decision: ModelDecision = selectDispatchModel({
      task: taskFeatures,
      selectedProfiles: [...selectedProfiles],
      staticProfiles: [...staticProfiles],
      activeSessionModel: input.activeSessionModel,
      budget: {},
      health: input.health ?? {},
      history: input.history,
      runId,
      outcomeLearner: input.outcomeLearner,
    });
    surfacedTags.push(tierTag({ tier: decision.tier, confidence: decision.confidence }));
    return {
      agent: agentDecision.agent,
      modelTier: decision.tier,
      agentConfidence: agentDecision.confidence,
      modelConfidence: decision.confidence,
      codemodIntent: null,
      surfacedTags,
      routingDecisionId: decision.routingDecisionId,
      modelId: decision.modelId,
      selectorReason: decision.reason,
    };
  }

  // 5. Thompson bandit for model tier (legacy fallback when the
  // orchestrator did not supply role + selected profiles).
  const tierDecision: RouteDecision = modelRouter.route(task);
  surfacedTags.push(tierTag(tierDecision));

  return {
    agent: agentDecision.agent,
    modelTier: tierDecision.tier,
    agentConfidence: agentDecision.confidence,
    modelConfidence: tierDecision.confidence,
    codemodIntent: null,
    surfacedTags,
    routingDecisionId,
    modelId: null,
    selectorReason: null,
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

// F-188 / IMP-013 central dispatch-model selector. Workflow wrappers,
// Agent tool callers, and team-member spawns MUST import `selectDispatchModel`
// from here rather than reaching into `evaluateRoleRequirements` or
// `pickFailover` directly — see the drift guard test
// (`packages/sdk/tests/select-dispatch-model-drift.test.mjs`).
export {
  selectDispatchModel,
  NEVER_DOWNGRADE_ROLES,
  REASON,
  TIER_STRENGTH,
  TIER_CHEAPNESS,
} from "./select-dispatch-model.js";
export type {
  ModelDecision,
  TaskFeatures,
  ModelCandidate,
  ProviderHealth,
  ProviderHealthMap,
  BudgetState,
  OutcomeHistory,
  SelectDispatchModelInput,
  AgentRole,
  WorkflowPhase,
  CapabilityToken,
} from "./select-dispatch-model.js";

export {
  ModelRouter,
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
  getAliasMap,
  mergeWithServing,
  createRunAssignmentSnapshot,
  verifyRunAssignmentSnapshot,
  ModelRegistryError,
  pickFailover,
  classifyError,
  TRANSPORT_OR_AVAILABILITY,
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
  type FailureReason,
  type FailoverVerdict,
  type FailoverChainEntry,
  type PickFailoverInput,
  type AliasMap,
  type AliasMapEntry,
  type ServingMetadata,
  type ServingMetadataEntry,
} from "./agent-model-registry.js";

// F-190 / IMP-017 discriminated ModelProfile schema.
export {
  type ModelProfile,
  type ModelProtocolCapabilities,
  type ModelMeasuredCapabilities,
  type ModelProfileProvenance,
  type ModelServingMetadata,
  type Modality,
  type ProfileSource,
  type ProfileMatchType,
  mergeProfile,
  isStale,
  needsRefresh,
  deriveExpiry,
  operatorExpiry,
  protocolMeets,
  measuredScore,
} from "./model-profile.js";

// F-192 / IMP-020 contextual outcome learner. The drift guard test
// `scripts/__tests__/router-contextual-outcome-guard.test.mjs` fails CI
// if `recordOutcome(success: boolean)` is reintroduced into the public
// surface — see that test for the rationale and the explicit migration
// shim whitelist.
export {
  createInMemoryOutcomeLearner,
  createFileOutcomeLearner,
  newRoutingDecisionId,
  OutcomeLearnerError,
  NEVER_DOWNGRADE_ROLES as OUTCOME_LEARNER_NEVER_DOWNGRADE_ROLES,
  POLICY_VERSION as OUTCOME_LEARNER_POLICY_VERSION,
  type ContextKey,
  type OutcomeSignal,
  type Posterior,
  type OutcomeLearnerState,
  type OutcomeLearner,
  type RecordResult,
  type OutcomeLearnerErrorCode,
} from "./outcome-learner.js";

// F-192 / IMP-020 contextual wrapper exported from the model router so
// dispatch wrappers have a single import point for record +
// recent-pick verification.
export {
  recordContextualOutcome,
  type ContextualOutcomeReceipt,
  type RecentPickRecord,
} from "./model-router.js";
