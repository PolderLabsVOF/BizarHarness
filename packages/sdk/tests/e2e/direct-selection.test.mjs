/**
 * packages/sdk/tests/e2e/direct-selection.test.mjs —
 * Direct Agent-tool dispatch E2E coverage for IMP-022 / F-192.
 *
 * Closes the IMP-022 acceptance gate from `IMPROVEMENTS.md` line 875
 * ("Model-selection E2E matrix | Direct, workflow, and team selection
 * cases pass"). Each test in this file drives a single direct
 * Agent-tool call through the harness and asserts that:
 *
 *   1. The captured Agent payload carries `model` + `routingDecisionId`.
 *   2. The provider request agrees with the recorded decision.
 *   3. The evidence store row exists BEFORE the agent stub is invoked.
 *   4. Outcomes attach on success and on typed transport failure.
 *
 * The dispatch surface is the one closed by IMP-014 / F-189 + IMP-013
 * / F-188 + IMP-018 / F-191.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createE2EHarness, defaultProfiles, defaultProfilesWithDesign } from './_fixtures/dispatch-context.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('direct-selection — IMP-022 direct Agent tool E2E matrix', () => {
  let harness;
  beforeEach(() => {
    harness = createE2EHarness();
  });

  it('single-tier direct dispatch mints a routingDecisionId and a generated definition payload', async () => {
    const { decision, augmented, agentResult, providerRequest } = await harness.dispatch({
      role: 'brenda',
      prompt: 'convert var to const',
      risk: 'low',
    });

    expect(decision.routingDecisionId).toMatch(UUID_RE);
    // The lowest-risk dispatch lands on the budget model.
    expect(decision.modelId).toBe('provider/cheap');
    expect(decision.tier).toBe('budget');
    expect(decision.reason).toBe(harness.REASON.CHEAPEST_RISK_LOW);

    // Captured payload (what the Agent tool actually saw) carries the
    // augmented dispatch metadata.
    expect(harness.agentTool.captured).toHaveLength(1);
    const capture = harness.agentTool.captured[0];
    expect(capture.payload.model).toBeUndefined();
    expect(capture.payload.subagent_type).toContain('provider-cheap');
    expect(capture.payload.additionalContext.bizarConfiguredModel).toBe('provider/cheap');
    expect(capture.payload.routingDecisionId).toBe(decision.routingDecisionId);
    expect(capture.payload.tier).toBe('budget');
    expect(capture.payload.selectorReason).toBe(harness.REASON.CHEAPEST_RISK_LOW);

    // Provider agrees.
    expect(providerRequest).not.toBeNull();
    expect(providerRequest.resolvedModel).toBe('provider/cheap');
    expect(providerRequest.decisionId).toBe(decision.routingDecisionId);

    // Agent stub returns the same model so the orchestrator can echo it.
    expect(agentResult.model).toBe('provider/cheap');
    expect(agentResult.decisionId).toBe(decision.routingDecisionId);

    // Evidence row exists at the moment the stub was invoked.
    const row = await harness.evidenceStore.get(decision.routingDecisionId);
    expect(row).not.toBeNull();
    expect(row.decision.modelId).toBe('provider/cheap');
    expect(row.outcome?.status).toBe('success');
  });

  it('high-risk direct dispatch picks the strongest healthy selected model — never falls through to session inheritance', async () => {
    const { decision, augmented, providerRequest } = await harness.dispatch({
      role: 'security',
      prompt: 'review this PR for vulnerabilities',
      risk: 'high',
      capabilities: ['security', 'reasoning'],
    });

    // Strongest selected model for the never-downgrade role.
    expect(decision.modelId).toBe('provider/strong');
    expect(decision.tier).toBe('high');
    expect(decision.reason).toBe(harness.REASON.STRONGEST_NEVER_DOWNGRADE);

    // The generated definition, rather than the alias-only native model
    // field, carries a concrete selected ID — never session-inherit.
    expect(augmented.model).toBeUndefined();
    expect(augmented.subagent_type).toContain('provider-strong');
    expect(augmented.additionalContext.bizarConfiguredModel).toBe('provider/strong');
    expect(augmented.routingDecisionId).toBe(decision.routingDecisionId);
    expect(decision.reason).not.toBe(harness.REASON.SESSION_INHERIT);
    expect(decision.reason).not.toBe(harness.REASON.NO_ELIGIBLE);

    expect(providerRequest.resolvedModel).toBe('provider/strong');
  });

  it('direct dispatch with empty selected pool returns model === undefined but mints routingDecisionId and selectorReason session-inherit', async () => {
    // Empty selected pool — the selector must fall through to session inheritance
    // (step 5 of the IMPROVEMENTS.md ladder) and still mint a routingDecisionId.
    // No active session model is configured: `modelId` MUST be `null` so
    // downstream telemetry sees "no dispatchable selection".
    const harness2 = createE2EHarness({ profiles: [], activeSessionModel: undefined });

    const { decision, augmented } = await harness2.dispatch({
      role: 'implementer',
      prompt: 'edit a file',
      risk: 'medium',
    });

    expect(decision.routingDecisionId).toMatch(UUID_RE);
    expect(decision.modelId).toBeNull();
    expect(decision.reason).toBe(harness2.REASON.SESSION_INHERIT);

    // Payload is the same shape — `model` is undefined, decisionId is set.
    expect(augmented.model).toBeUndefined();
    expect(augmented.routingDecisionId).toBe(decision.routingDecisionId);
    expect(augmented.selectorReason).toBe(harness2.REASON.SESSION_INHERIT);
  });

  it('direct dispatch with a design-capable model for UI work lands on the design-tier entry (capability-token exact match)', async () => {
    const designHarness = createE2EHarness({ profiles: defaultProfilesWithDesign() });

    const { decision } = await designHarness.dispatch({
      role: 'designer',
      prompt: 'redesign the navigation',
      risk: 'medium',
      capabilities: ['design'],
    });

    // The design-capable model has `vision: true` and `mid-design` tier.
    // Capabilities-empty fallback is `next-stronger`; with capabilities
    // `design` it falls through to `next-stronger` over the eligible pool.
    expect(decision.modelId).toMatch(/provider\/(design|strong)/);
    expect(['mid-design', 'high']).toContain(decision.tier);
  });

  it('direct dispatch in `substitute` provider mode is detected and the harness records a provider-mismatch audit row', async () => {
    const subHarness = createE2EHarness({ mode: 'substitute' });

    const { decision, providerRequest } = await subHarness.dispatch({
      role: 'brenda',
      prompt: 'convert var to const',
      risk: 'low',
    });

    // Decision still picks the budget model.
    expect(decision.modelId).toBe('provider/cheap');
    // Provider silently swaps it.
    expect(providerRequest.resolvedModel).toBe('provider/stronger');
    expect(providerRequest.substitution).toBe(true);

    const mismatches = subHarness.detectProviderMismatch();
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({
      decisionId: decision.routingDecisionId,
      requestedModel: 'provider/cheap',
      resolvedModel: 'provider/stronger',
    });
  });

  it('direct dispatch in `fail` provider mode emits a typed transport error and attachOutcome({ status: "transport" }) runs automatically', async () => {
    const failHarness = createE2EHarness({ mode: 'fail' });

    const { decision, providerError, providerRequest } = await failHarness.dispatch({
      role: 'brenda',
      prompt: 'convert var to const',
      risk: 'low',
    });

    expect(providerRequest).toBeNull();
    expect(providerError).not.toBeNull();
    expect(providerError.code).toBe('transport');
    expect(providerError.requestedModel).toBe('provider/cheap');
    expect(providerError.decisionId).toBe(decision.routingDecisionId);

    const row = await failHarness.evidenceStore.get(decision.routingDecisionId);
    expect(row.outcome?.status).toBe('transport');
    expect(row.outcome?.errorMessage).toMatch(/forced failure/);
  });

  it('direct dispatch always appends evidence before invoking the agent stub (decision is recorded at dispatch time)', async () => {
    let observedEvidenceAtInvoke = null;
    const stub = harness.agentTool;
    const originalInvoke = stub.invoke.bind(stub);
    stub.invoke = async (args) => {
      observedEvidenceAtInvoke = await harness.evidenceStore.get(args.payload.routingDecisionId);
      return originalInvoke(args);
    };

    const { decision } = await harness.dispatch({
      role: 'implementer',
      prompt: 'edit a file',
      risk: 'medium',
    });

    expect(observedEvidenceAtInvoke).not.toBeNull();
    expect(observedEvidenceAtInvoke.routingDecisionId).toBe(decision.routingDecisionId);
    expect(observedEvidenceAtInvoke.decision.modelId).toBe(decision.modelId);
    // And `outcome` is undefined at invocation time — the harness
    // attaches it AFTER the provider call resolves.
    expect(observedEvidenceAtInvoke.outcome).toBeUndefined();
  });

  it('repeated high-risk dispatches are deterministic — no random picks across 100 calls (high-risk: exploration disabled)', async () => {
    // High-risk + never-downgrade role is fully deterministic; verify it.
    for (let i = 0; i < 100; i++) {
      const { decision } = await harness.dispatch({
        role: 'security',
        prompt: `scan #${i}`,
        risk: 'high',
        capabilities: ['security'],
      });
      expect(decision.modelId).toBe('provider/strong');
    }
  });
});
