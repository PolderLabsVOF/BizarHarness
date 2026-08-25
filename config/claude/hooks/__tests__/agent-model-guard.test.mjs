import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadModelRouter } from '../../../config/agents/model-assignment.mjs';
import { resolveWorkflowPaths, startWorkflow } from '../../../cli/core/workflow-state.mjs';
import { guardAgentModel } from '../agent-model-guard.mjs';
import { selectEventChain } from '../../../cli/commands/hook.mjs';

function decision(output) {
  return output.hookSpecificOutput?.permissionDecision;
}

test('Agent model guard enforces the active immutable assignment snapshot', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-agent-model-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = loadModelRouter();
  const availableModelIds = [...new Set(Object.values(registry.agents).map((entry) => entry.model))];
  const state = startWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    goal: 'guard exact agent models',
    registry,
    availableModelIds,
  });
  const expected = state.assignmentSnapshot.assignments.greg.model;
  const base = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    session_id: 'session-1',
    cwd: root,
    tool_input: { subagent_type: 'greg' },
  };
  const options = {
    env: { ANTHROPIC_BASE_URL: registry.gateway.endpoint },
    registry,
    availableModelIds,
  };

  assert.deepEqual(await guardAgentModel(base, options), {});
  assert.deepEqual(await guardAgentModel({ ...base, tool_input: { ...base.tool_input, model: expected } }, options), {});
  assert.deepEqual(await guardAgentModel({
    ...base,
    tool_input: { subagent_type: 'bizar-harness:greg', model: expected },
  }, options), {});
  assert.equal(decision(await guardAgentModel({
    ...base,
    tool_input: { subagent_type: 'bizar-harness:greg', model: 'wrong/model' },
  }, options)), 'deny');
  assert.equal(decision(await guardAgentModel({ ...base, tool_input: { subagent_type: 'unknown' } }, options)), 'deny');
  assert.equal(decision(await guardAgentModel({ ...base, tool_input: { ...base.tool_input, model: 'wrong/model' } }, options)), 'deny');
  assert.equal(decision(await guardAgentModel(base, {
    ...options,
    env: {
      ANTHROPIC_BASE_URL: registry.gateway.endpoint,
      CLAUDE_CODE_SUBAGENT_MODEL: 'wrong/model',
    },
  })), 'deny');
  assert.deepEqual(selectEventChain('pre-tool-use', JSON.stringify({ tool_name: 'Agent' })), ['agent-model-guard']);
});

test('active guard reloads frozen gateway coordinates from workflow state without a canonical registry', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-agent-model-frozen-gateway-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const canonicalRegistry = loadModelRouter();
  const registry = structuredClone(canonicalRegistry);
  registry.endpoint = 'https://workflow-gateway.example/v2';
  registry.gateway.endpoint = registry.endpoint;
  registry.gateway.availabilityProbe = '/workflow-models';
  const availableModelIds = [...new Set(Object.values(registry.agents).map((entry) => entry.model))];
  const state = startWorkflow({
    projectRoot: root,
    sessionId: 'cross-process-session',
    goal: 'Use the frozen workflow gateway in a later hook process',
    registry,
    availableModelIds,
  });
  const expectedModel = state.assignmentSnapshot.assignments.greg.model;
  const requestedUrls = [];
  let reportedModels = [expectedModel];
  const fetchImpl = async (url) => {
    requestedUrls.push(String(url));
    return {
      ok: true,
      status: 200,
      async json() { return { data: reportedModels.map((id) => ({ id })) }; },
    };
  };
  const input = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    session_id: 'cross-process-session',
    cwd: root,
    tool_input: { subagent_type: 'greg', model: expectedModel },
  };

  const matchingEnv = {
    ANTHROPIC_BASE_URL: `${registry.gateway.endpoint}/`,
    BIZAR_MODEL_ROUTER_URL: registry.gateway.endpoint,
  };
  assert.deepEqual(await guardAgentModel(input, { env: matchingEnv, fetchImpl }), {});
  assert.deepEqual(requestedUrls, ['https://workflow-gateway.example/v2/workflow-models?limit=1000']);
  assert.equal(requestedUrls.some((url) => url.startsWith(canonicalRegistry.gateway.endpoint)), false);

  assert.equal(decision(await guardAgentModel(input, { env: {}, fetchImpl })), 'deny');
  assert.equal(decision(await guardAgentModel(input, {
    env: { ANTHROPIC_BASE_URL: canonicalRegistry.gateway.endpoint },
    fetchImpl,
  })), 'deny');
  assert.equal(decision(await guardAgentModel(input, {
    env: {
      ANTHROPIC_BASE_URL: registry.gateway.endpoint,
      BIZAR_MODEL_ROUTER_URL: canonicalRegistry.gateway.endpoint,
    },
    fetchImpl,
  })), 'deny');
  assert.equal(requestedUrls.length, 1, 'endpoint mismatches must deny before probing');

  reportedModels = [];
  const blocked = await guardAgentModel(input, { env: matchingEnv, fetchImpl });
  assert.equal(decision(blocked), 'deny');
  assert.match(blocked.hookSpecificOutput.permissionDecisionReason, new RegExp(expectedModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(requestedUrls[1], 'https://workflow-gateway.example/v2/workflow-models?limit=1000');
});

test('Agent model guard enforces canonical routing without state and denies integrity-invalid state', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-agent-model-invalid-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    session_id: 'session-1',
    cwd: root,
    tool_input: { subagent_type: 'greg' },
  };
  const registry = loadModelRouter();
  const availableModelIds = [...new Set(Object.values(registry.agents).map((entry) => entry.model))];
  const options = { env: {}, registry, availableModelIds };
  assert.deepEqual(await guardAgentModel(input, options), {});
  assert.equal(decision(await guardAgentModel({
    ...input,
    tool_input: { subagent_type: 'greg', model: 'wrong/model' },
  }, options)), 'deny');
  assert.equal(decision(await guardAgentModel(input, {
    ...options,
    env: { CLAUDE_CODE_SUBAGENT_MODEL: 'wrong/model' },
  })), 'deny');
  const expected = registry.agents.greg.model;
  assert.deepEqual(await guardAgentModel({
    ...input,
    tool_input: { subagent_type: 'bizar-harness:greg', model: expected },
  }, options), {});
  assert.equal(decision(await guardAgentModel({
    ...input,
    tool_input: { subagent_type: 'bizar-harness:greg', model: 'wrong/model' },
  }, options)), 'deny');
  assert.deepEqual(await guardAgentModel({
    ...input,
    tool_input: { subagent_type: 'Explore', model: 'builtin-choice' },
  }, { env: { CLAUDE_CODE_SUBAGENT_MODEL: 'builtin-choice' } }), {});
  assert.equal(decision(await guardAgentModel({
    ...input,
    tool_input: { subagent_type: 'bizar-harness:missing' },
  }, options)), 'deny');
  assert.equal(decision(await guardAgentModel(input, {
    env: {},
    routerPath: join(root, 'missing-router.json'),
    availableModelIds,
  })), 'deny');
  assert.equal(decision(await guardAgentModel(input, {
    env: {},
    registry,
    availableModelIds: [],
  })), 'deny');

  startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'tamper test', registry, availableModelIds });
  const { statePath } = resolveWorkflowPaths({ projectRoot: root, sessionId: 'session-1' });
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.assignmentSnapshot.assignments.greg.model = 'tampered/model';
  writeFileSync(statePath, `${JSON.stringify(state)}\n`);
  const blocked = await guardAgentModel(input, options);
  assert.equal(decision(blocked), 'deny');
  assert.match(blocked.hookSpecificOutput.permissionDecisionReason, /integrity/i);
});
