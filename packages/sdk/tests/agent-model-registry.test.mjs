import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ModelRegistryError,
  createRunAssignmentSnapshot,
  getEndpoint,
  listAgentModels,
  loadModelRegistry,
  resolveAgentModel,
  resolveTierModel,
  verifyRunAssignmentSnapshot,
} from '../src/router/agent-model-registry.ts';
import { createRunAssignmentSnapshot as createCliRunAssignmentSnapshot } from '../../../config/agents/model-assignment.mjs';

const SAMPLE = {
  $schema: 'https://bizar.dev/schema/model-router.v2.json',
  version: '11.0.0',
  endpoint: 'http://localhost:20128/v1',
  gateway: {
    required: true,
    endpoint: 'http://localhost:20128/v1',
    availabilityProbe: '/models',
    exactModelRequired: true,
    unavailableBehavior: 'fail',
  },
  tiers: {
    premium: { models: ['cx/gpt-5.6-sol'], purpose: 'Primary orchestration.' },
    mid: { models: ['bizar/MiniMax-M2.7'], purpose: 'Moderate implementation.' },
    budget: { models: ['bizar/MiniMax-M2.5'], purpose: 'Mechanical work.' },
  },
  agents: {
    mike: { model: 'cx/gpt-5.6-sol', tier: 'premium', rationale: 'single main orchestrator' },
    todd: { model: 'bizar/MiniMax-M2.7', tier: 'mid', rationale: 'moderate implementation' },
    pam: { model: 'bizar/MiniMax-M2.5', tier: 'budget', rationale: 'single-shot mechanical work' },
  },
  policies: {
    mainOrchestrator: 'mike',
    assignmentSnapshot: 'immutable-per-run',
    requireConfiguredGateway: true,
    requireExactRequestedModel: true,
    rejectDispatchModelOverride: true,
    silentFallback: false,
    unavailableModel: 'fail-and-report',
    fallback_chain: [],
  },
};

function clone(value) {
  return structuredClone(value);
}

function writeConfig(path, value = SAMPLE) {
  writeFileSync(path, JSON.stringify(value));
}

function expectRegistryError(fn, code) {
  try {
    fn();
    assert.fail('expected ModelRegistryError');
  } catch (error) {
    assert.ok(error instanceof ModelRegistryError);
    assert.equal(error.code, code);
  }
}

describe('strict agent-model-registry v2', () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bizar-registry-'));
    configPath = join(tmpDir, 'model-router.json');
    writeConfig(configPath);
  });

  afterEach(() => {
    delete process.env.BIZAR_MODEL_ROUTER_URL;
    delete process.env.ANTHROPIC_BASE_URL;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads exact assignments, policies, and single-model tiers', () => {
    const registry = loadModelRegistry({ configPath });
    assert.equal(registry.version, '11.0.0');
    assert.equal(registry.endpoint, SAMPLE.endpoint);
    assert.equal(registry.configuredEndpoint, SAMPLE.endpoint);
    assert.equal(registry.agents.size, 3);
    assert.equal(registry.tiers.size, 3);
    assert.equal(registry.policies.mainOrchestrator, 'mike');
    assert.equal(registry.policies.silentFallback, false);

    const mike = resolveAgentModel('mike', registry);
    assert.equal(mike.modelId, 'cx/gpt-5.6-sol');
    assert.equal(mike.tier, 'premium');
    assert.equal(mike.endpoint, SAMPLE.endpoint);

    const budget = resolveTierModel('budget', registry);
    assert.equal(budget.modelId, 'bizar/MiniMax-M2.5');
    assert.deepEqual(budget.fallback, []);
    assert.equal(listAgentModels(registry).length, 3);
    assert.equal(getEndpoint(registry), SAMPLE.endpoint);
  });

  it('allows endpoint-only override without changing agent/model identity', () => {
    process.env.BIZAR_MODEL_ROUTER_URL = 'http://configured-gateway:9000/v1';
    const registry = loadModelRegistry({ configPath });
    const resolved = resolveAgentModel('pam', registry);
    assert.equal(registry.endpoint, 'http://configured-gateway:9000/v1');
    assert.equal(registry.configuredEndpoint, SAMPLE.endpoint);
    assert.equal(resolved.modelId, SAMPLE.agents.pam.model);
    assert.equal(resolved.tier, SAMPLE.agents.pam.tier);
  });

  it('throws typed errors for missing, corrupt, or v1 configuration', () => {
    expectRegistryError(
      () => loadModelRegistry({ configPath: join(tmpDir, 'missing.json') }),
      'CONFIG_NOT_FOUND',
    );

    writeFileSync(configPath, '{not json');
    expectRegistryError(() => loadModelRegistry({ configPath }), 'CONFIG_INVALID');

    const legacy = clone(SAMPLE);
    legacy.$schema = 'https://bizar.dev/schema/model-router.v1.json';
    writeConfig(configPath, legacy);
    expectRegistryError(() => loadModelRegistry({ configPath }), 'CONFIG_INVALID');
  });

  it('rejects missing gateway guarantees, model overrides, and every fallback list', () => {
    const fallback = clone(SAMPLE);
    fallback.policies.fallback_chain = ['bizar/MiniMax-M2.5'];
    writeConfig(configPath, fallback);
    expectRegistryError(() => loadModelRegistry({ configPath }), 'MODEL_POLICY_INVALID');

    const multiModelTier = clone(SAMPLE);
    multiModelTier.tiers.budget.models.push('bizar/MiniMax-M2.7');
    writeConfig(configPath, multiModelTier);
    expectRegistryError(() => loadModelRegistry({ configPath }), 'MODEL_POLICY_INVALID');

    const permissiveOverride = clone(SAMPLE);
    permissiveOverride.policies.rejectDispatchModelOverride = false;
    writeConfig(configPath, permissiveOverride);
    expectRegistryError(() => loadModelRegistry({ configPath }), 'MODEL_POLICY_INVALID');

    const gatewayDrift = clone(SAMPLE);
    gatewayDrift.gateway.endpoint = 'http://different-gateway/v1';
    writeConfig(configPath, gatewayDrift);
    expectRegistryError(() => loadModelRegistry({ configPath }), 'GATEWAY_POLICY_INVALID');
  });

  it('rejects assignment/tier drift and unknown agent or tier resolution', () => {
    const drifted = clone(SAMPLE);
    drifted.agents.todd.model = 'bizar/MiniMax-M2.5';
    writeConfig(configPath, drifted);
    expectRegistryError(() => loadModelRegistry({ configPath }), 'MODEL_POLICY_INVALID');

    writeConfig(configPath);
    const registry = loadModelRegistry({ configPath });
    expectRegistryError(() => resolveAgentModel('unknown', registry), 'UNKNOWN_AGENT');
    expectRegistryError(() => resolveTierModel('high', registry), 'UNKNOWN_TIER');
  });

  it('creates an immutable, verifiable exact-assignment snapshot', () => {
    const registry = loadModelRegistry({ configPath });
    const snapshot = createRunAssignmentSnapshot({
      runId: 'run-123',
      registry,
      agentNames: ['mike', 'todd'],
      availableModelIds: ['cx/gpt-5.6-sol', 'bizar/MiniMax-M2.7'],
      createdAt: '2026-08-02T00:00:00.000Z',
    });

    assert.equal(snapshot.assignments.mike.model, 'cx/gpt-5.6-sol');
    assert.equal(snapshot.assignments.todd.model, 'bizar/MiniMax-M2.7');
    assert.equal(snapshot.gatewayEndpoint, registry.endpoint);
    assert.equal(snapshot.availabilityProbe, registry.gateway.availabilityProbe);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.assignments), true);
    assert.equal(Object.isFrozen(snapshot.assignments.mike), true);
    assert.equal(verifyRunAssignmentSnapshot(snapshot), true);
    assert.equal(verifyRunAssignmentSnapshot({ ...snapshot, availabilityProbe: '/other-models' }), false);
    assert.throws(() => { snapshot.assignments.mike.model = 'bizar/MiniMax-M2.5'; }, TypeError);
  });

  it('produces the exact canonical schemaVersion 1 payload and fingerprint as the CLI snapshot', () => {
    const registry = loadModelRegistry({ configPath });
    const input = {
      runId: 'parity-run-1',
      agentNames: ['mike', 'todd'],
      availableModelIds: ['cx/gpt-5.6-sol', 'bizar/MiniMax-M2.7'],
      createdAt: '2026-08-02T12:00:00.000Z',
    };
    const sdkSnapshot = createRunAssignmentSnapshot({ ...input, registry });
    const cliSnapshot = createCliRunAssignmentSnapshot({
      ...input,
      registry: clone(SAMPLE),
    });

    assert.deepEqual(sdkSnapshot, cliSnapshot);
  });

  it('fails snapshots when gateway evidence or the exact requested model is absent', () => {
    const registry = loadModelRegistry({ configPath });
    expectRegistryError(
      () => createRunAssignmentSnapshot({
        runId: 'run-124',
        registry,
        agentNames: ['mike'],
        availableModelIds: [],
      }),
      'GATEWAY_AVAILABILITY_REQUIRED',
    );
    expectRegistryError(
      () => createRunAssignmentSnapshot({
        runId: 'run-125',
        registry,
        agentNames: ['mike'],
        availableModelIds: ['bizar/MiniMax-M2.5'],
      }),
      'REQUESTED_MODEL_UNAVAILABLE',
    );
    expectRegistryError(
      () => createRunAssignmentSnapshot({
        runId: 'run-126',
        registry,
        agentNames: ['unknown'],
        availableModelIds: ['cx/gpt-5.6-sol'],
      }),
      'UNKNOWN_AGENT',
    );
  });
});
