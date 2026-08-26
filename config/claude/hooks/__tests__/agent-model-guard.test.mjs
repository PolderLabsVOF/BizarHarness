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
  assert.equal(decision(await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'unknown/provider-model' },
  }, { registry })), 'deny');

  const model = registry.tiers.mid.models[0];
  assert.equal(decision(await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model },
  }, { registry, availableModelIds: [] })), 'deny');
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
  // discovery says no. Must deny.
  assert.equal(decision(await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'tier-premium/only' },
  }, { registry, availableModelIds: [] })), 'deny');

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
  assert.equal(decision(await guardAgentModel({
    ...input,
    tool_input: { ...input.tool_input, model: 'stranger/c' },
  }, { registry })), 'deny');
});

test('portable hook dispatcher retains the Agent model validator', () => {
  assert.ok(selectEventChain('pre-tool-use', JSON.stringify({ tool_name: 'Agent' })).includes('agent-model-guard'));
});
