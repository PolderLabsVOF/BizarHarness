/**
 * packages/sdk/tests/e2e/_fixtures/dispatch-context.mjs —
 * Wire the three IMP-022 stubs (agent-tool, provider, team-spawn) plus
 * a real `selectDispatchModel` and `dispatchAgent` into a single
 * `createE2EHarness({ ... })` factory (IMP-022 / F-192).
 *
 * The harness is the one place the E2E tests interact with the
 * selector, the workflow dispatch wrapper, and the stubs. It is the
 * dispatch surface IMP-014 + IMP-018 + IMP-022 all converge on. Calling
 * `harness.dispatch(role, prompt, opts)`:
 *
 *   1. Loads the dispatch context (selected + static profiles, budget,
 *      health, active session model).
 *   2. Runs `selectDispatchModel` to mint a `ModelDecision` + UUID.
 *   3. Appends the decision to the in-memory `EvidenceStore` BEFORE
 *      invoking the agent (proves the audit row exists at the moment
 *      the stub sees the dispatch).
 *   4. Sends the augmented payload through the Agent tool stub.
 *   5. Calls the provider stub with the resolved model + decision ID
 *      so the matrix test can prove `decision === resolvedModel`.
 *   6. On success, attaches `outcome: { status: 'success' }` to the
 *      evidence row. On typed transport failure, attaches
 *      `{ status: 'transport' }` automatically.
 *
 * The harness is intentionally synchronous-friendly: every `await` is
 * only on the stubs. The selector and the dispatch wrapper remain pure.
 */

import { createAgentToolStub } from './agent-tool-stub.mjs';
import { createProviderStub } from './provider-stub.mjs';
import { createTeamSpawnStub } from './team-spawn-stub.mjs';
import { createInMemoryEvidenceStore } from './evidence-store-stub.mjs';

import { selectDispatchModel, REASON } from '../../../src/router/select-dispatch-model.ts';
import { dispatchAgent } from '../../../../../config/workflows/lib/dispatch.js';

/**
 * @typedef {{
 *   id: string,
 *   tier?: 'budget'|'mid'|'default'|'mid-design'|'high'|'premium',
 *   profile?: object,
 *   discriminatedProfile?: object,
 * }} ModelCandidate
 *
 * @typedef {{
 *   selectedProfiles?: ModelCandidate[],
 *   staticProfiles?: ModelCandidate[],
 *   activeSessionModel?: string,
 *   budget?: { remainingUsd?: number, maxUsdPerCall?: number },
 *   health?: Record<string, { status?: 'healthy'|'degraded'|'unhealthy', recentFailureCount?: number }>,
 *   history?: object,
 *   runId?: string,
 * }} DispatchContextOverrides
 */

/**
 * Canonical 2-model fixture: a budget model and a high-tier model. The
 * matrix test uses this to verify the budget-vs-strong ladder without
 * standing up a real profile catalog.
 */
export function defaultProfiles() {
  return [
    {
      id: 'provider/cheap',
      tier: 'budget',
      profile: {
        capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true },
        limits: { contextTokens: 32000, inputTokens: null, outputTokens: null },
      },
    },
    {
      id: 'provider/strong',
      tier: 'high',
      profile: {
        capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true },
        limits: { contextTokens: 200000, inputTokens: null, outputTokens: null },
      },
    },
  ];
}

/**
 * Canonical 3-model fixture: budget + design-capable + high.
 */
export function defaultProfilesWithDesign() {
  return [
    {
      id: 'provider/cheap',
      tier: 'budget',
      profile: {
        capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true },
        limits: { contextTokens: 32000, inputTokens: null, outputTokens: null },
      },
    },
    {
      id: 'provider/design',
      tier: 'mid-design',
      profile: {
        capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true, vision: true },
        limits: { contextTokens: 128000, inputTokens: null, outputTokens: null },
      },
    },
    {
      id: 'provider/strong',
      tier: 'high',
      profile: {
        capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true },
        limits: { contextTokens: 200000, inputTokens: null, outputTokens: null },
      },
    },
  ];
}

/**
 * Build the `selectDispatchModel` input shape from a profile list +
 * context overrides.
 */
export function buildSelectorInput(profiles, ctx, taskFeatures) {
  return {
    task: taskFeatures,
    selectedProfiles: ctx.selectedProfiles ?? profiles,
    staticProfiles: ctx.staticProfiles ?? [],
    activeSessionModel: ctx.activeSessionModel,
    budget: ctx.budget ?? {},
    health: ctx.health ?? {},
    history: ctx.history,
    runId: ctx.runId ?? 'e2e-run',
  };
}

/**
 * @param {{
 *   mode?: 'agree'|'substitute'|'fail',
 *   profiles?: ModelCandidate[],
 *   role?: string,
 *   phase?: string,
 *   risk?: 'low'|'medium'|'high',
 *   capabilities?: string[],
 *   activeSessionModel?: string,
 *   budget?: { remainingUsd?: number, maxUsdPerCall?: number },
 *   health?: Record<string, object>,
 *   history?: object,
 *   runId?: string,
 *   substitutionMap?: Record<string,string>,
 * }} [opts]
 */
export function createE2EHarness(opts = {}) {
  const profiles = opts.profiles ?? defaultProfiles();
  const evidenceStore = createInMemoryEvidenceStore();
  const agentTool = createAgentToolStub();
  const provider = createProviderStub({ mode: opts.mode ?? 'agree', substitutionMap: opts.substitutionMap });
  const team = createTeamSpawnStub();

  const ctx = {
    selectedProfiles: profiles,
    staticProfiles: [],
    activeSessionModel: Object.prototype.hasOwnProperty.call(opts, 'activeSessionModel') ? opts.activeSessionModel : 'session/inherit',
    budget: opts.budget ?? {},
    health: opts.health ?? {},
    history: opts.history,
    runId: opts.runId ?? evidenceStore._mintRunId(),
  };

  /**
   * Resolve a `ModelDecision` for the supplied task features. Pure —
   * does not touch the stubs or the evidence store.
   */
  function decide(taskFeatures = {}) {
    const input = buildSelectorInput(profiles, ctx, {
      task: 'e2e',
      ...taskFeatures,
    });
    return selectDispatchModel(input);
  }

  /**
   * Run one dispatch: select -> append evidence -> agent stub ->
   * provider stub -> attachOutcome. Returns the captured payload +
   * result so tests can assert.
   *
   * @param {object} call
   * @param {string} call.role - Bizar role label (e.g. 'implementer').
   * @param {string} [call.agentName] - logical agent name (defaults to role).
   * @param {string} call.prompt - prompt text.
   * @param {'low'|'medium'|'high'} [call.risk]
   * @param {string[]} [call.capabilities]
   * @param {string} [call.phase]
   */
  async function dispatch(call) {
    if (!call || typeof call !== 'object') throw new TypeError('dispatch requires a call object');
    const role = call.role;
    if (typeof role !== 'string' || !role) throw new TypeError('dispatch.role must be a non-empty string');
    const agentName = call.agentName ?? role;

    const taskFeatures = {
      task: call.prompt ?? '',
      role,
      risk: call.risk ?? opts.risk,
      capabilities: call.capabilities ?? opts.capabilities,
      phase: call.phase ?? opts.phase,
      minContextTokens: call.minContextTokens,
      requireReasoning: call.requireReasoning,
      requireToolCall: call.requireToolCall,
      requireStructuredOutput: call.requireStructuredOutput,
      requireImageInput: call.requireImageInput,
    };

    const decision = selectDispatchModel(buildSelectorInput(profiles, ctx, taskFeatures));

    // Append BEFORE invoking the agent — the matrix test proves the
    // audit row exists at the moment the stub is invoked.
    await evidenceStore.append({
      routingDecisionId: decision.routingDecisionId,
      decision,
      taskFeatures,
      runId: ctx.runId,
      agentName,
      workflowPhase: call.phase ?? opts.phase,
      selectedProfiles: profiles,
      staticProfiles: [],
      activeSessionModel: ctx.activeSessionModel,
      budget: ctx.budget,
      health: ctx.health,
    });

    // Build the augmented payload the workflow would have produced.
    const augmented = {
      ...(call.extraOpts ?? {}),
      role,
      risk: taskFeatures.risk,
      capabilities: taskFeatures.capabilities,
      phase: taskFeatures.phase,
      model: decision.modelId ?? undefined,
      routingDecisionId: decision.routingDecisionId,
      tier: decision.tier,
      selectorReason: decision.reason,
      fallbackChain: decision.fallbackChain,
      routedAgent: agentName,
    };

    // Send through the agent stub.
    const agentResult = await agentTool.invoke({ prompt: call.prompt ?? '', payload: augmented });

    // Send through the provider stub — the matrix test asserts the
    // resolved model agrees with the recorded decision.
    let providerRequest = null;
    let providerError = null;
    try {
      providerRequest = await provider.call({
        requestedModel: decision.modelId ?? '',
        decisionId: decision.routingDecisionId,
      });
      await evidenceStore.attachOutcome(decision.routingDecisionId, {
        status: 'success',
        actualProviderModel: providerRequest.model,
      });
    } catch (err) {
      providerError = err;
      const status = err?.code === 'auth' ? 'auth' : 'transport';
      await evidenceStore.attachOutcome(decision.routingDecisionId, {
        status,
        errorMessage: err?.message ?? String(err),
      });
    }

    return {
      decision,
      augmented,
      agentResult,
      providerRequest,
      providerError,
    };
  }

  /**
   * Drive a workflow script through the captured dispatch wrapper.
   * Reuses the existing `dispatchAgent` capture hook so the workflow's
   * augmented payloads land in `agentTool.captured` (and the evidence
   * store).
   */
  async function dispatchViaWorkflow(agentFn, agentName, prompt, dispatchOpts = {}) {
    return dispatchAgent(agentFn, agentName, prompt, dispatchOpts, {
      selectedProfiles: profiles,
      staticProfiles: [],
      activeSessionModel: ctx.activeSessionModel,
      budget: ctx.budget,
      health: ctx.health,
      history: ctx.history,
      runId: ctx.runId,
    });
  }

  /**
   * Spawn a team member with the supplied role + payload. Mirrors the
   * team-spawn surface; the harness runs the selector for each spawn
   * and threads `model` + `routingDecisionId` into the captured
   * member's payload.
   */
  async function spawnTeamMember(role, payload = {}, spawnCtx = {}) {
    const decision = selectDispatchModel(buildSelectorInput(profiles, ctx, {
      task: payload?.prompt ?? `team-spawn:${role}`,
      role,
      risk: payload?.risk,
      capabilities: payload?.capabilities,
      phase: payload?.phase,
      minContextTokens: payload?.minContextTokens,
      requireReasoning: payload?.requireReasoning,
      requireToolCall: payload?.requireToolCall,
      requireStructuredOutput: payload?.requireStructuredOutput,
      requireImageInput: payload?.requireImageInput,
    }));

    await evidenceStore.append({
      routingDecisionId: decision.routingDecisionId,
      decision,
      taskFeatures: {
        task: payload?.prompt ?? `team-spawn:${role}`,
        role,
        risk: payload?.risk,
        capabilities: payload?.capabilities,
        phase: payload?.phase,
        minContextTokens: payload?.minContextTokens,
      },
      runId: ctx.runId,
      agentName: role,
      workflowPhase: payload?.phase,
      selectedProfiles: profiles,
      staticProfiles: [],
      activeSessionModel: ctx.activeSessionModel,
      budget: ctx.budget,
      health: ctx.health,
    });

    const augmentedPayload = {
      ...payload,
      model: decision.modelId ?? undefined,
      routingDecisionId: decision.routingDecisionId,
      tier: decision.tier,
      selectorReason: decision.reason,
    };

    const member = await team.spawn(role, augmentedPayload, spawnCtx);

    // The provider stub always agrees for team dispatches in tests —
    // a failed provider on a team spawn would have surfaced via the
    // dispatch() path already.
    try {
      const providerRequest = await provider.call({
        requestedModel: decision.modelId ?? '',
        decisionId: decision.routingDecisionId,
      });
      await evidenceStore.attachOutcome(decision.routingDecisionId, {
        status: 'success',
        actualProviderModel: providerRequest.model,
      });
      member.outcome = { status: 'success', providerModel: providerRequest.model };
    } catch (err) {
      const status = err?.code === 'auth' ? 'auth' : 'transport';
      await evidenceStore.attachOutcome(decision.routingDecisionId, {
        status,
        errorMessage: err?.message ?? String(err),
      });
      member.outcome = { status, error: err?.message ?? String(err) };
    }

    return { member, decision, payload: member.payload };
  }

  /**
   * Detect provider-substitution (silent model swap) and emit an audit
   * row. The matrix test asserts every captured provider request
   * satisfies `resolvedModel === decision.modelId`.
   */
  function detectProviderMismatch() {
    const mismatches = [];
    for (const req of provider.requests) {
      if (req.resolvedModel !== req.requestedModel) {
        mismatches.push({ decisionId: req.decisionId, requestedModel: req.requestedModel, resolvedModel: req.resolvedModel });
      }
    }
    return mismatches;
  }

  function reset() {
    agentTool.reset();
    provider.reset();
    team.reset();
  }

  return {
    evidenceStore,
    agentTool,
    provider,
    team,
    ctx,
    profiles,
    decide,
    dispatch,
    dispatchViaWorkflow,
    spawnTeamMember,
    detectProviderMismatch,
    reset,
    REASON,
  };
}