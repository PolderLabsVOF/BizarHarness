import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  createRunAssignmentSnapshot,
  loadModelRouter,
  resolveDispatchModel,
  verifyRunAssignmentSnapshot,
} from '../config/agents/model-assignment.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const AGENTS_DIR = join(ROOT, 'config', 'claude', 'agents');
const ROUTER_PATH = join(ROOT, 'config', 'claude', 'model-router.json');

function readAgents() {
  return readdirSync(AGENTS_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ name, body: readFileSync(join(AGENTS_DIR, name), 'utf8') }));
}

describe('dynamic model router', () => {
  it('keeps custom agent roles model-agnostic', () => {
    for (const agent of readAgents()) {
      assert.doesNotMatch(agent.body, /^model:/m, `${agent.name} must inherit or receive an orchestrator-selected model`);
    }
  });

  it('defines orchestrator-owned dynamic tiers and bounded failure behavior', () => {
    const registry = loadModelRouter(ROUTER_PATH);
    assert.equal(registry.policies.selectionOwner, 'orchestrator');
    assert.equal(registry.policies.discoveryFailure, 'configured-tier-fallback');
    assert.equal(registry.policies.unavailableModel, 'configured-tier-fallback');
    assert.equal(registry.policies.retryModelAliases, false);
    assert.equal(registry.policies.maxDispatchModelAttempts, 1);
    assert.ok(Object.keys(registry.tiers).length >= 3);
  });

  it('selects the first live candidate from the chosen tier', () => {
    const registry = loadModelRouter(ROUTER_PATH);
    const second = registry.tiers.mid.models[1];
    const decision = resolveDispatchModel({ agent: 'todd', availableModelIds: [second], registry });
    assert.equal(decision.tier, 'mid');
    assert.equal(decision.model, second);
    assert.equal(decision.inheritSession, false);
  });

  it('retains an explicit configured model when discovery is unavailable', () => {
    const registry = loadModelRouter(ROUTER_PATH);
    assert.equal(resolveDispatchModel({ agent: 'greg', registry }).inheritSession, false);
    assert.equal(resolveDispatchModel({ agent: 'greg', availableModelIds: [], registry }).inheritSession, false);
    assert.equal(resolveDispatchModel({ agent: 'unknown', availableModelIds: [], registry }).tier, 'default');
  });

  it('snapshots only requested dispatch decisions and protects integrity', () => {
    const registry = loadModelRouter(ROUTER_PATH);
    const availableModelIds = Object.values(registry.tiers).flatMap((tier) => tier.models);
    const snapshot = createRunAssignmentSnapshot({
      runId: 'run-123',
      agentNames: ['mike', 'todd'],
      availableModelIds,
      registry,
      createdAt: '2026-08-25T00:00:00.000Z',
    });
    assert.deepEqual(Object.keys(snapshot.decisions), ['mike', 'todd']);
    assert.equal(snapshot.decisions.mike.tier, 'premium');
    assert.equal(snapshot.decisions.todd.tier, 'mid');
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(verifyRunAssignmentSnapshot(snapshot), true);
    const tampered = JSON.parse(JSON.stringify(snapshot));
    tampered.decisions.mike.model = 'tampered/model';
    assert.equal(verifyRunAssignmentSnapshot(tampered), false);
  });
});
