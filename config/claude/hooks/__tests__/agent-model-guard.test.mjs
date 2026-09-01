import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModelRouter } from '../../../../config/agents/model-assignment.mjs';
import { guardAgentModel } from '../agent-model-guard.mjs';
import { selectEventChain } from '../../../../cli/commands/hook.mjs';

function decision(output) {
  return output.hookSpecificOutput?.permissionDecision;
}

const input = {
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_input: { subagent_type: 'greg' },
};

test('Agent model guard allows inherited session model without discovery', async () => {
  assert.deepEqual(await guardAgentModel(input), {});
  assert.deepEqual(await guardAgentModel({ ...input, tool_input: { ...input.tool_input, model: 'inherit' } }), {});
});

test('Agent model guard allows one configured live tier candidate', async () => {
  const registry = loadModelRouter();
  const model = registry.tiers.mid.models[0];
  assert.deepEqual(await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model },
  }, { registry, availableModelIds: [model] }), {});
});

test('Agent model guard rejects policy-forbidden and unavailable overrides without retrying', async () => {
  const registry = loadModelRouter();
  const denied = await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'unknown/provider-model' },
  }, { registry });
  assert.equal(decision(denied), 'allow');
  assert.ok(denied.hookSpecificOutput?.additionalContext, 'expected advisory additionalContext for policy-forbidden model');

  const model = registry.tiers.mid.models[0];
  const liveDenied = await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model },
  }, { registry, availableModelIds: [] });
  assert.equal(decision(liveDenied), 'allow');
  assert.ok(liveDenied.hookSpecificOutput?.additionalContext, 'expected advisory additionalContext for unavailable live-discovery model');
});

test('Agent model guard fails open when optional router loading fails', async () => {
  assert.deepEqual(await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'provider/model' },
  }, { routerPath: '/definitely/missing/model-router.json' }), {});
});

test('Agent model guard accepts a userSelected model without live-discovery', async () => {
  // Build a synthetic registry where the only valid model comes from
  // `userSelected` — the live-discovery list is empty.
  const registry = {
    tiers: {
      premium: { models: ['tier-premium/never'], purpose: 'p', effort: 'high' },
    },
    userSelected: {
      models: ['claude-minimax/MiniMax-M3', 'claude-qwen/qwen3.8-max'],
      tierHints: { 'claude-minimax/MiniMax-M3': 'default', 'claude-qwen/qwen3.8-max': 'premium' },
    },
  };
  // No `availableModelIds` provided at all → picker-only path. Must allow.
  assert.deepEqual(await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'claude-minimax/MiniMax-M3' },
  }, { registry }), {});

  // Even when `availableModelIds` is explicitly empty (defensive live probe),
  // userSelected bypasses the live check. The picker is the discovery.
  assert.deepEqual(await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'claude-qwen/qwen3.8-max' },
  }, { registry, availableModelIds: [] }), {});
});

test('Agent model guard still requires live-discovery for non-userSelected tier candidates', async () => {
  // A model that lives in `tiers.<x>.models` but NOT in `userSelected` and
  // NOT reported by live discovery must be denied (defensive against typos).
  const registry = {
    tiers: {
      premium: { models: ['tier-premium/only'], purpose: 'p', effort: 'high' },
    },
    userSelected: {
      models: ['user-selected/yes'],
    },
  };
  // `tier-premium/only` is in the tier but NOT in userSelected. Live
  // discovery says no. Must advise (F-176/F-182: deny was downgraded to
  // advisory additionalContext).
  const liveBlocked = await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'tier-premium/only' },
  }, { registry, availableModelIds: [] });
  assert.equal(decision(liveBlocked), 'allow');
  assert.ok(liveBlocked.hookSpecificOutput?.additionalContext, 'expected advisory additionalContext for live-discovery block');

  // `tier-premium/only` IS reported by live discovery. Must allow.
  assert.deepEqual(await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'tier-premium/only' },
  }, { registry, availableModelIds: ['tier-premium/only'] }), {});
});

test('Agent model guard rejects a model that is in neither userSelected nor any tier', async () => {
  const registry = {
    tiers: {
      premium: { models: ['tier/a'], purpose: 'p', effort: 'high' },
    },
    userSelected: { models: ['user/b'] },
  };
  const blocked = await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'stranger/c' },
  }, { registry });
  assert.equal(decision(blocked), 'allow');
  assert.ok(blocked.hookSpecificOutput?.additionalContext, 'expected advisory additionalContext for stranger model');
});

test('portable hook dispatcher retains the Agent model validator', () => {
  assert.ok(selectEventChain('pre-tool-use', JSON.stringify({ tool_name: 'Agent' })).includes('agent-model-guard'));
});

// ─── F-185 / IMP-019 health-aware failover contract ──────────────────────

test('Agent model guard accepts primary + user-selected fallback when routingDecisionId is set', async () => {
  // Two user-selected models; the orchestrator pins a primary and a
  // pre-computed failover. The guard must accept BOTH without re-probing
  // the gateway, since `pickFailover` already validated the failover.
  const registry = {
    tiers: {
      premium: { models: ['tier-premium/never'], purpose: 'p', effort: 'high' },
    },
    userSelected: {
      models: ['claude-minimax/MiniMax-M3', 'claude-qwen/qwen3.8-max'],
      tierHints: { 'claude-minimax/MiniMax-M3': 'default', 'claude-qwen/qwen3.8-max': 'premium' },
    },
  };
  assert.deepEqual(await guardAgentModel({
    ...input,
    tool_input: {
      ...input.tool_input,
      model: 'claude-minimax/MiniMax-M3',
      additionalContext: { routingDecisionId: 'r-2026-08-27-001', fallback: 'claude-qwen/qwen3.8-max' },
    },
  }, { registry }), {});
});

test('Agent model guard rejects an out-of-pool fallback even with routingDecisionId', async () => {
  const registry = {
    tiers: { mid: { models: ['tier/mid'], purpose: 'm', effort: 'medium' } },
    userSelected: { models: ['claude-minimax/MiniMax-M3'] },
  };
  const blocked = await guardAgentModel({
    ...input,
    tool_input: {
      ...input.tool_input,
      model: 'claude-minimax/MiniMax-M3',
      additionalContext: { routingDecisionId: 'r-2026-08-27-001', fallback: 'stranger/c' },
    },
  }, { registry });
  assert.equal(decision(blocked), 'allow', 'F-176 advisory path');
  assert.ok(blocked.hookSpecificOutput?.additionalContext, 'expected advisory additionalContext for out-of-pool fallback');
});

test('Agent model guard still requires primary to be in the pool when routingDecisionId is set', async () => {
  // The orchestrator's contract is both-or-neither: a valid fallback
  // does NOT launder an out-of-pool primary.
  const registry = {
    tiers: { premium: { models: ['tier/premium'], purpose: 'p', effort: 'high' } },
    userSelected: { models: ['claude-minimax/MiniMax-M3'] },
  };
  const blocked = await guardAgentModel({
    ...input,
    tool_input: {
      ...input.tool_input,
      model: 'stranger/primary',
      additionalContext: { routingDecisionId: 'r-2026-08-27-001', fallback: 'claude-minimax/MiniMax-M3' },
    },
  }, { registry });
  assert.equal(decision(blocked), 'allow', 'F-176 advisory path');
  assert.ok(blocked.hookSpecificOutput?.additionalContext, 'expected advisory additionalContext for out-of-pool primary');
});

test('Agent model guard ignores additionalContext.fallback when routingDecisionId is missing', async () => {
  // The contract is both-or-neither. Without routingDecisionId the
  // contract is not active and the existing flow (no live probe for
  // userSelected) applies.
  const registry = {
    tiers: { premium: { models: ['tier/never'], purpose: 'p', effort: 'high' } },
    userSelected: { models: ['claude-minimax/MiniMax-M3', 'claude-qwen/qwen3.8-max'] },
  };
  assert.deepEqual(await guardAgentModel({
    ...input,
    tool_input: {
      ...input.tool_input,
      model: 'claude-minimax/MiniMax-M3',
      additionalContext: { fallback: 'claude-qwen/qwen3.8-max' },
    },
  }, { registry }), {});
});

// ── 10.22.0 / Phase 4: disabled-providers filter contract ─────────────

test('Agent model guard denies disabled-provider overrides', async () => {
  const registry = {
    disabledProviders: ['anthropic'],
    tiers: { premium: { models: ['tier/never'], purpose: 'p', effort: 'high' } },
    userSelected: { models: ['anthropic/claude-3-5-sonnet', 'claude-minimax/MiniMax-M3'] },
  };
  const out = await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'anthropic/claude-3-5-sonnet' },
  }, { registry });
  assert.equal(decision(out), 'deny');
  assert.match(out.hookSpecificOutput?.permissionDecisionReason || '', /disabledProviders/);
  // A non-disabled user pick still passes.
  const out2 = await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'claude-minimax/MiniMax-M3' },
  }, { registry });
  assert.deepEqual(out2, {});
});
