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

test('portable hook dispatcher retains the Agent model validator', () => {
  assert.ok(selectEventChain('pre-tool-use', JSON.stringify({ tool_name: 'Agent' })).includes('agent-model-guard'));
});
