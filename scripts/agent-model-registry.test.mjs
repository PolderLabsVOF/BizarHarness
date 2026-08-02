import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  createRunAssignmentSnapshot,
  loadModelRouter,
  verifyRunAssignmentSnapshot,
} from '../config/agents/model-assignment.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const AGENTS_DIR = join(ROOT, '.claude', 'agents');
const ROUTER_PATH = join(ROOT, '.claude', 'model-router.json');
const ALLOWED_MODELS = new Set([
  'cx/gpt-5.6-sol',
  'cx/gpt-5.6-terra',
  'cx/gpt-5.6-luna',
  'bizar/MiniMax-M3',
  'bizar/MiniMax-M2.7',
  'bizar/MiniMax-M2.5',
]);

function readAgents() {
  return readdirSync(AGENTS_DIR)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => {
      const text = readFileSync(join(AGENTS_DIR, file), 'utf8');
      const frontmatter = text.startsWith('---') ? text.split('---', 3)[1] : '';
      const field = (name) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(frontmatter)?.[1].trim();
      return { file, text, name: field('name'), model: field('model'), tools: field('tools') };
    });
}

describe('canonical Bizar agent/model registry', () => {
  const registry = loadModelRouter(ROUTER_PATH);
  const agents = readAgents();

  it('enumerates all 16 shipped agents with exact supported models and WebSearch', () => {
    assert.equal(agents.length, 16);
    assert.equal(new Set(agents.map(({ name }) => name)).size, agents.length);
    for (const agent of agents) {
      assert.ok(agent.name, `${agent.file} must declare a name`);
      assert.ok(ALLOWED_MODELS.has(agent.model), `${agent.name} has unsupported model ${agent.model}`);
      assert.match(agent.tools ?? '', /(?:^|,\s*)WebSearch(?:,|$)/, `${agent.name} must retain WebSearch`);
    }
    assert.deepEqual(new Set(agents.map(({ model }) => model)), ALLOWED_MODELS, 'the six requested GPT/MiniMax models should all be used');
  });

  it('keeps Mike as the unique primary orchestrator on GPT-5.6 Sol', () => {
    assert.equal(registry.policies.mainOrchestrator, 'mike');
    assert.deepEqual(registry.roleRouting.orchestration.agents, ['mike']);
    const orchestrationMemberships = Object.entries(registry.roleRouting)
      .filter(([, route]) => route.agents.includes('mike'))
      .map(([role]) => role);
    assert.deepEqual(orchestrationMemberships, ['orchestration']);

    const mike = agents.find(({ name }) => name === 'mike');
    assert.equal(mike?.model, 'cx/gpt-5.6-sol');
    assert.match(mike?.text ?? '', /single main orchestrator/i);
  });

  it('separates role selection from complexity tiers and covers each agent once', () => {
    const roleMembers = Object.values(registry.roleRouting).flatMap(({ agents: names }) => names);
    assert.equal(roleMembers.length, agents.length);
    assert.equal(new Set(roleMembers).size, roleMembers.length, 'each specialist must have exactly one primary role');
    assert.deepEqual(new Set(roleMembers), new Set(agents.map(({ name }) => name)));

    for (const [role, route] of Object.entries(registry.roleRouting)) {
      assert.ok(route.purpose, `${role} needs a routing rationale`);
      assert.ok(Array.isArray(route.agents) && route.agents.length > 0, `${role} needs agents`);
    }
    for (const [tier, definition] of Object.entries(registry.tiers)) {
      assert.ok(definition.purpose, `${tier} needs a complexity rationale`);
      assert.equal(definition.models.length, 1, `${tier} must resolve to one exact model, not a fallback list`);
    }
  });

  it('detects router/frontmatter drift and requires a rationale for every assignment', () => {
    assert.deepEqual(new Set(Object.keys(registry.agents)), new Set(agents.map(({ name }) => name)));
    for (const agent of agents) {
      const assignment = registry.agents[agent.name];
      assert.equal(assignment.model, agent.model, `${agent.name} frontmatter drifted from the router`);
      assert.ok(assignment.rationale?.length >= 40, `${agent.name} needs a substantive assignment rationale`);
      assert.ok(registry.tiers[assignment.tier], `${agent.name} uses unknown tier ${assignment.tier}`);
      assert.deepEqual(registry.tiers[assignment.tier].models, [assignment.model]);
    }
  });

  it('requires the configured gateway and forbids every silent fallback path', () => {
    assert.equal(registry.gateway.required, true);
    assert.equal(registry.gateway.endpoint, registry.endpoint);
    assert.equal(registry.gateway.exactModelRequired, true);
    assert.equal(registry.gateway.unavailableBehavior, 'fail');
    assert.equal(registry.policies.requireConfiguredGateway, true);
    assert.equal(registry.policies.requireExactRequestedModel, true);
    assert.equal(registry.policies.rejectDispatchModelOverride, true);
    assert.equal(registry.policies.silentFallback, false);
    assert.deepEqual(registry.policies.fallback_chain, []);
    assert.equal(Object.hasOwn(registry.policies, 'gpt_never_for'), false, 'role-level GPT prohibitions contradict complexity routing');
  });
});

describe('per-run model assignment snapshot', () => {
  const registry = loadModelRouter(ROUTER_PATH);
  const availableModelIds = [...ALLOWED_MODELS];

  it('freezes exact assignments and verifies their fingerprint', () => {
    const snapshot = createRunAssignmentSnapshot({
      runId: 'run-123',
      agentNames: ['mike', 'todd', 'ria'],
      availableModelIds,
      registry,
      createdAt: '2026-08-02T00:00:00.000Z',
    });

    assert.equal(snapshot.assignments.mike.model, 'cx/gpt-5.6-sol');
    assert.equal(snapshot.assignments.todd.model, 'bizar/MiniMax-M2.7');
    assert.equal(snapshot.assignments.ria.model, 'cx/gpt-5.6-luna');
    assert.equal(snapshot.gatewayEndpoint, registry.gateway.endpoint);
    assert.equal(snapshot.availabilityProbe, registry.gateway.availabilityProbe);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.assignments), true);
    assert.equal(Object.isFrozen(snapshot.assignments.mike), true);
    assert.equal(verifyRunAssignmentSnapshot(snapshot), true);
    assert.throws(() => { snapshot.assignments.mike.model = 'bizar/MiniMax-M2.5'; }, TypeError);
  });

  it('fails rather than substituting an unavailable or unknown assignment', () => {
    assert.throws(
      () => createRunAssignmentSnapshot({ runId: 'run-124', agentNames: ['mike'], availableModelIds: ['bizar/MiniMax-M3'], registry }),
      (error) => error.code === 'REQUESTED_MODEL_UNAVAILABLE' && /refusing silent fallback/.test(error.message),
    );
    assert.throws(
      () => createRunAssignmentSnapshot({ runId: 'run-125', agentNames: ['unknown'], availableModelIds, registry }),
      (error) => error.code === 'UNKNOWN_AGENT',
    );
    assert.throws(
      () => createRunAssignmentSnapshot({ runId: 'run-126', agentNames: ['mike'], registry }),
      (error) => error.code === 'GATEWAY_AVAILABILITY_REQUIRED',
    );
  });
});
