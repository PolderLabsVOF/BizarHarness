import test from 'node:test';
import assert from 'node:assert/strict';

import { guardAgentModel } from '../agent-model-guard.mjs';
import { selectEventChain } from '../../../../cli/commands/hook.mjs';

function decision(output) {
  return output.hookSpecificOutput?.permissionDecision;
}

function configuredRegistry() {
  return {
    policies: { selectionOwner: 'orchestrator', discoveryFailure: 'configured-tier-fallback', unavailableModel: 'configured-tier-fallback', retryModelAliases: false, maxDispatchModelAttempts: 1 },
    tiers: { mid: { models: ['test/tier-model'] } },
    userSelected: { models: [] },
  };
}

const input = {
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_input: { subagent_type: 'greg' },
};

test('Agent model guard denies omitted and inherited models', async () => {
  assert.equal(decision(await guardAgentModel(input)), 'deny');
  assert.equal(decision(await guardAgentModel({ ...input, tool_input: { ...input.tool_input, model: 'inherit' } })), 'deny');
});

test('Agent model guard allows one configured live tier candidate', async () => {
  const registry = configuredRegistry();
  const model = registry.tiers.mid.models[0];
  assert.deepEqual(await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model },
  }, { registry, availableModelIds: [model] }), {});
});

test('Agent model guard accepts a synchronized native alias for its audited custom gateway ID', async () => {
  const registry = { tiers: { default: { models: [] } }, userSelected: { models: ['glm/glm-5.3'] } };
  assert.deepEqual(await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'sonnet', additionalContext: { bizarConfiguredModel: 'glm/glm-5.3' } },
  }, { registry, modelOverrides: { 'claude-sonnet-5': 'glm/glm-5.3' } }), {});
});

test('Agent model guard rejects a stale or mismatched native alias mapping', async () => {
  const registry = { tiers: { default: { models: [] } }, userSelected: { models: ['glm/glm-5.3'] } };
  const denied = await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'sonnet', additionalContext: { bizarConfiguredModel: 'glm/glm-5.3' } },
  }, { registry, modelOverrides: { 'claude-sonnet-5': 'minimax/MiniMax-M3' } });
  assert.equal(decision(denied), 'deny');
});

test('Agent model guard rejects policy-forbidden and unavailable overrides without retrying', async () => {
  const registry = configuredRegistry();
  const denied = await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'unknown/provider-model' },
  }, { registry });
  assert.equal(decision(denied), 'deny');

  const model = registry.tiers.mid.models[0];
  const liveDenied = await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model },
  }, { registry, availableModelIds: [] });
  assert.equal(decision(liveDenied), 'deny');
});

test('Agent model guard fails closed when the global router cannot be loaded', async () => {
  assert.equal(decision(await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'provider/model' },
  }, { routerPath: '/definitely/missing/model-router.json' })), 'deny');
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
  // Discovery says no. Model routing is fail-closed even though ordinary
  // reversible tool permissions remain advisory under F-176.
  const liveBlocked = await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'tier-premium/only' },
  }, { registry, availableModelIds: [] });
  assert.equal(decision(liveBlocked), 'deny');

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
  assert.equal(decision(blocked), 'deny');
});

test('portable hook dispatcher retains the Agent model validator', () => {
  assert.ok(selectEventChain('pre-tool-use', JSON.stringify({ tool_name: 'Agent' })).includes('agent-model-guard'));
});

// ─── F-201 transport compatibility (native Agent inheritance) ────────────────

test('Agent model guard allows inherit when bizarConfiguredModel equals global parent model and is a user pick', async () => {
  // The native Claude Code Agent tool rejects arbitrary gateway IDs in its
  // enum-limited `model` field. Workflows therefore omit `model` (or set it
  // to 'inherit') and carry the Bizar selection under
  // additionalContext.bizarConfiguredModel. The guard allows this ONLY when
  // the configured Bizar ID matches the actual global Claude parent model
  // AND is in the user-selected pool.
  const registry = {
    tiers: { mid: { models: ['never/used'] } },
    userSelected: { models: ['configured-parent-model'] },
  };
  assert.deepEqual(await guardAgentModel({
    ...input,
    tool_input: {
      ...input.tool_input,
      // model omitted — native Agent inherits from session
      additionalContext: { bizarConfiguredModel: 'configured-parent-model' },
    },
  }, { registry, parentModel: 'configured-parent-model' }), {});
});

test('Agent model guard still denies inherit when additionalContext.bizarConfiguredModel is missing', async () => {
  const registry = {
    tiers: { mid: { models: ['x'] } },
    userSelected: { models: ['configured-parent-model'] },
  };
  const blocked = await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'inherit' },
  }, { registry, parentModel: 'configured-parent-model' });
  assert.equal(decision(blocked), 'deny');
});

test('Agent model guard denies inherit when configured ID differs from the global parent model', async () => {
  const registry = {
    tiers: { mid: { models: ['x'] } },
    userSelected: { models: ['bizar-pick', 'configured-parent-model'] },
  };
  const blocked = await guardAgentModel({
    ...input,
    tool_input: {
      ...input.tool_input,
      additionalContext: { bizarConfiguredModel: 'bizar-pick' },
    },
  }, { registry, parentModel: 'configured-parent-model' });
  assert.equal(decision(blocked), 'deny');
});

test('Agent model guard denies inherit when configured ID is not a user pick', async () => {
  // Operator-selected parent matches the Bizar pick, but the Bizar pick
  // is a tier-only candidate that was never promoted to userSelected.
  // Fail closed so an unconfigured tier model cannot dispatch.
  const registry = {
    tiers: { mid: { models: ['tier-only'] } },
    userSelected: { models: [] },
  };
  const blocked = await guardAgentModel({
    ...input,
    tool_input: {
      ...input.tool_input,
      additionalContext: { bizarConfiguredModel: 'tier-only' },
    },
  }, { registry, parentModel: 'tier-only' });
  assert.equal(decision(blocked), 'deny');
});

test('Agent model guard fails closed when global settings.json cannot be read and no override is supplied', async () => {
  const registry = {
    tiers: { mid: { models: ['x'] } },
    userSelected: { models: ['configured-parent-model'] },
  };
  // No `parentModel` override and no readable settings.json on disk — the
  // guard must deny because it cannot prove the inherited model is a
  // Bizar-selected ID.
  const blocked = await guardAgentModel({
    ...input,
    tool_input: {
      ...input.tool_input,
      additionalContext: { bizarConfiguredModel: 'configured-parent-model' },
    },
  }, { registry, settingsPath: '/nonexistent/settings.json' });
  assert.equal(decision(blocked), 'deny');
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
  assert.equal(decision(blocked), 'deny');
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
  assert.equal(decision(blocked), 'deny');
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
