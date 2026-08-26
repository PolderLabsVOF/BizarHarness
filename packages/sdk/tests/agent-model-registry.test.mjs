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
  userSelectedModelIds,
  verifyRunAssignmentSnapshot,
} from '../src/router/agent-model-registry.ts';
import { createRunAssignmentSnapshot as createCliRunAssignmentSnapshot, loadModelRouter } from '../../../config/agents/model-assignment.mjs';

const SAMPLE = {
  $schema: 'https://bizar.dev/schema/model-router.v3.json',
  version: '12.0.0',
  endpoint: 'http://localhost:20129/v1',
  gateway: { endpoint: 'http://localhost:20129/v1', availabilityProbe: '/models', unavailableBehavior: 'inherit-session' },
  tiers: {
    premium: { models: ['provider/premium-a', 'provider/premium-b'], purpose: 'hard work', effort: 'high' },
    default: { models: ['provider/default'], purpose: 'ordinary work', effort: 'medium' },
    mid: { models: ['provider/mid-a', 'provider/mid-b'], purpose: 'bounded work', effort: 'medium' },
  },
  roleDefaults: { mike: 'premium', greg: 'default', todd: 'mid' },
  policies: {
    mainOrchestrator: 'mike', selectionOwner: 'orchestrator', discoveryFailure: 'inherit-session',
    unavailableModel: 'inherit-session', retryModelAliases: false, maxDispatchModelAttempts: 1,
  },
};

let tmpDir;
let configPath;
let previousRouterEndpoint;
let previousAnthropicEndpoint;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'bizar-sdk-model-router-'));
  configPath = join(tmpDir, 'model-router.json');
  writeFileSync(configPath, JSON.stringify(SAMPLE));
  previousRouterEndpoint = process.env.BIZAR_MODEL_ROUTER_URL;
  previousAnthropicEndpoint = process.env.ANTHROPIC_BASE_URL;
  delete process.env.BIZAR_MODEL_ROUTER_URL;
  delete process.env.ANTHROPIC_BASE_URL;
});

afterEach(() => {
  if (previousRouterEndpoint === undefined) delete process.env.BIZAR_MODEL_ROUTER_URL;
  else process.env.BIZAR_MODEL_ROUTER_URL = previousRouterEndpoint;
  if (previousAnthropicEndpoint === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = previousAnthropicEndpoint;
  rmSync(tmpDir, { recursive: true, force: true });
});

function expectRegistryError(fn, code) {
  try { fn(); assert.fail('expected ModelRegistryError'); }
  catch (error) { assert.ok(error instanceof ModelRegistryError); assert.equal(error.code, code); }
}

describe('dynamic model registry', () => {
  it('loads tier candidates and role defaults', () => {
    const registry = loadModelRegistry({ configPath });
    assert.equal(registry.version, '12.0.0');
    assert.equal(registry.tiers.get('premium').modelIds.length, 2);
    assert.equal(registry.roleDefaults.get('mike'), 'premium');
    assert.equal(listAgentModels(registry).length, 3);
    assert.equal(getEndpoint(registry), SAMPLE.endpoint);
  });

  it('selects a live tier candidate and otherwise inherits the session', () => {
    const registry = loadModelRegistry({ configPath });
    const live = resolveAgentModel('mike', registry, ['provider/premium-b']);
    assert.equal(live.modelId, 'provider/premium-b');
    assert.equal(live.inheritSession, false);
    const inherited = resolveAgentModel('todd', registry);
    assert.equal(inherited.modelId, null);
    assert.equal(inherited.inheritSession, true);
    assert.equal(resolveAgentModel('unknown', registry).tier, 'default');
    assert.equal(resolveTierModel('mid', registry, []).inheritSession, true);
  });

  it('validates dynamic non-retrying policy', () => {
    expectRegistryError(() => loadModelRegistry({ configPath: join(tmpDir, 'missing.json') }), 'CONFIG_NOT_FOUND');
    writeFileSync(configPath, '{');
    expectRegistryError(() => loadModelRegistry({ configPath }), 'CONFIG_INVALID');
    writeFileSync(configPath, JSON.stringify({ ...SAMPLE, policies: { ...SAMPLE.policies, retryModelAliases: true } }));
    expectRegistryError(() => loadModelRegistry({ configPath }), 'MODEL_POLICY_INVALID');
  });

  it('creates integrity-protected dynamic decision snapshots', () => {
    const registry = loadModelRegistry({ configPath });
    const snapshot = createRunAssignmentSnapshot({ runId: 'run-1', agentNames: ['mike', 'todd'], availableModelIds: ['provider/premium-a'], registry, createdAt: '2026-08-25T00:00:00.000Z' });
    assert.equal(snapshot.decisions.mike.model, 'provider/premium-a');
    assert.equal(snapshot.decisions.todd.inheritSession, true);
    assert.equal(verifyRunAssignmentSnapshot(snapshot), true);
    const tampered = structuredClone(snapshot);
    tampered.decisions.mike.model = 'tampered/model';
    assert.equal(verifyRunAssignmentSnapshot(tampered), false);
  });

  it('matches the CLI snapshot contract for the canonical router', () => {
    const cliRegistry = loadModelRouter();
    const sdkRegistry = loadModelRegistry({ data: cliRegistry });
    const availableModelIds = Object.values(cliRegistry.tiers).flatMap((tier) => tier.models);
    const input = { runId: 'parity-run', agentNames: ['mike', 'todd'], availableModelIds, createdAt: '2026-08-25T00:00:00.000Z' };
    const cli = createCliRunAssignmentSnapshot({ ...input, registry: cliRegistry });
    const sdk = createRunAssignmentSnapshot({ ...input, registry: sdkRegistry });
    assert.deepEqual(sdk, cli);
  });

  it('loads userSelected block when present', () => {
    const routerWithPicks = {
      ...SAMPLE,
      userSelected: {
        models: ['claude-minimax/MiniMax-M3', 'claude-qwen/qwen3.8-max'],
        lastUpdated: '2026-08-26T19:00:00.000Z',
        source: 'live-pick',
        tierHints: { 'claude-minimax/MiniMax-M3': 'default', 'claude-qwen/qwen3.8-max': 'premium' },
      },
    };
    const registry = loadModelRegistry({ data: routerWithPicks });
    assert.ok(registry.userSelected, 'userSelected populated');
    assert.deepEqual(registry.userSelected.models, ['claude-minimax/MiniMax-M3', 'claude-qwen/qwen3.8-max']);
    assert.equal(registry.userSelected.source, 'live-pick');
    assert.equal(registry.userSelected.tierHints['claude-qwen/qwen3.8-max'], 'premium');
    assert.deepEqual(userSelectedModelIds(registry), ['claude-minimax/MiniMax-M3', 'claude-qwen/qwen3.8-max']);
  });

  it('omits userSelected when missing or empty', () => {
    const empty = loadModelRegistry({ data: SAMPLE });
    assert.equal(empty.userSelected, undefined);
    assert.deepEqual(userSelectedModelIds(empty), []);

    const blankModels = loadModelRegistry({ data: { ...SAMPLE, userSelected: { models: [] } } });
    assert.equal(blankModels.userSelected, undefined, 'empty models block is treated as absent');

    const whitespaceOnly = loadModelRegistry({ data: { ...SAMPLE, userSelected: { models: ['', '  '] } } });
    assert.equal(whitespaceOnly.userSelected, undefined, 'whitespace-only models block is treated as absent');
  });
});
