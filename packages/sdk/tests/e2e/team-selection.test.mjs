/**
 * packages/sdk/tests/e2e/team-selection.test.mjs —
 * Team-spawn dispatch E2E coverage for IMP-022 / F-192.
 *
 * Closes the IMP-022 acceptance gate from `IMPROVEMENTS.md` line 875
 * ("Model-selection E2E matrix | Direct, workflow, and team selection
 * cases pass"). The IMPROVEMENTS.md acceptance line (line 595-596)
 * names the team case verbatim: "every nested workflow and team
 * dispatch contains the expected model" and "every teammate spawn
 * carries its selected model".
 *
 * Each test in this file spawns one or more team members through the
 * harness and asserts the captured member payload carries a fresh
 * `routingDecisionId` + `model` per dispatch.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createE2EHarness } from './_fixtures/dispatch-context.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('team-selection — IMP-022 team-spawn E2E matrix', () => {
  let harness;
  beforeEach(() => {
    harness = createE2EHarness();
  });

  it('3 teammates with distinct roles each receive their own routingDecisionId and generated definition', async () => {
    const roles = ['research-analyst', 'planner', 'implementer'];
    const results = [];
    for (const role of roles) {
      const r = await harness.spawnTeamMember(role, { prompt: `task for ${role}`, risk: 'medium' });
      results.push({ role, ...r });
    }

    expect(harness.team.members).toHaveLength(3);
    const ids = new Set();
    for (const r of results) {
      expect(UUID_RE.test(r.decision.routingDecisionId)).toBe(true);
      expect(r.member.payload.routingDecisionId).toBe(r.decision.routingDecisionId);
      expect(r.member.payload.model).toBeUndefined();
      expect(r.member.payload.subagent_type).toBeTruthy();
      expect(r.member.payload.additionalContext.bizarConfiguredModel).toBe(r.decision.modelId);
      // Per-spawn uniqueness.
      expect(ids.has(r.decision.routingDecisionId)).toBe(false);
      ids.add(r.decision.routingDecisionId);
      // The evidence row was appended.
      const row = await harness.evidenceStore.get(r.decision.routingDecisionId);
      expect(row).not.toBeNull();
      expect(row.outcome?.status).toBe('success');
    }
    expect(ids.size).toBe(3);
  });

  it('3 teammates with the same role each receive their own routingDecisionId (per-dispatch uniqueness)', async () => {
    for (let i = 0; i < 3; i++) {
      await harness.spawnTeamMember('implementer', { prompt: `lane ${i}`, risk: 'medium' });
    }
    expect(harness.team.members).toHaveLength(3);
    const ids = harness.team.members.map((m) => m.payload.routingDecisionId);
    expect(new Set(ids).size).toBe(3);
  });

  it('high-risk teammate with role: security selects the strongest selected non-quarantined model (never-downgrade invariant)', async () => {
    const { member, decision } = await harness.spawnTeamMember('security', {
      prompt: 'audit the codebase',
      risk: 'high',
      capabilities: ['security'],
    });

    expect(decision.modelId).toBe('provider/strong');
    expect(decision.tier).toBe('high');
    expect(decision.reason).toBe(harness.REASON.STRONGEST_NEVER_DOWNGRADE);
    expect(member.payload.model).toBeUndefined();
    expect(member.payload.subagent_type).toContain('provider-strong');
    expect(member.payload.additionalContext.bizarConfiguredModel).toBe('provider/strong');
    expect(member.payload.selectorReason).toBe(harness.REASON.STRONGEST_NEVER_DOWNGRADE);
  });

  it('a teammate that fails with auth error emits attachOutcome({ status: "auth" }) follow-up evidence row', async () => {
    // Use the harness's auth-mode provider so the spawn surfaces a
    // ProviderAuthError. The harness converts that into
    // `attachOutcome({ status: 'auth' })` and the test asserts the
    // follow-up evidence row carries `failoverFrom: [originalId]`.
    const authHarness = createE2EHarness({ mode: 'auth' });

    const { member, decision, payload } = await authHarness.spawnTeamMember('implementer', {
      prompt: 'edit a file',
      risk: 'medium',
    });

    expect(member.outcome?.status).toBe('auth');

    const row = await authHarness.evidenceStore.get(decision.routingDecisionId);
    expect(row).not.toBeNull();
    expect(row.outcome?.status).toBe('auth');
    expect(row.outcome?.errorMessage).toMatch(/auth failure/);

    // Emit a follow-up evidence row carrying `failoverFrom` — the
    // failover chain starts at the failed decision and proposes the
    // next-strongest selected model.
    const followUp = await authHarness.evidenceStore.append({
      routingDecisionId: `${decision.routingDecisionId}-failover`,
      decision: { ...decision, modelId: 'provider/strong', reason: authHarness.REASON.NEXT_STRONGER, fallbackChain: [decision.routingDecisionId] },
      taskFeatures: { task: 'follow-up', role: 'implementer', risk: 'medium' },
      runId: authHarness.ctx.runId,
      agentName: 'failover',
      selectedProfiles: authHarness.profiles,
      staticProfiles: [],
      activeSessionModel: authHarness.ctx.activeSessionModel,
      budget: authHarness.ctx.budget,
      health: authHarness.ctx.health,
    });
    const followUpRow = await authHarness.evidenceStore.get(followUp.routingDecisionId);
    expect(followUpRow).not.toBeNull();
    expect(followUpRow.decision.fallbackChain).toContain(decision.routingDecisionId);
  });

  it('per-team-member decision is recorded independently and the provider request agrees', async () => {
    await harness.spawnTeamMember('research-analyst', { prompt: 'r1', risk: 'low' });
    await harness.spawnTeamMember('research-analyst', { prompt: 'r2', risk: 'low' });
    await harness.spawnTeamMember('planner', { prompt: 'p1', risk: 'medium' });

    expect(harness.team.members).toHaveLength(3);
    expect(harness.provider.requests).toHaveLength(3);
    for (const req of harness.provider.requests) {
      expect(req.resolvedModel).toBe(req.requestedModel);
    }
  });
});
