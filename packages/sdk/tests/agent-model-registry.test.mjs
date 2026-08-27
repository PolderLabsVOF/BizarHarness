import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ModelRegistryError,
  compareRankedEntries,
  createRunAssignmentSnapshot,
  defaultTierHintForId,
  evaluateRoleRequirements,
  getEndpoint,
  listAgentModels,
  loadModelRegistry,
  rankUserSelectedForRole,
  resolveAgentModel,
  resolveTierModel,
  scoreCapabilityProfile,
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

// ─── F-184 selected-pool resolver (IMP-016) ────────────────────────────────

describe('selected-pool resolver (F-184)', () => {
  it('returns empty arrays when userSelected is missing', () => {
    const registry = loadModelRegistry({ data: SAMPLE });
    const { ranked, eligible } = rankUserSelectedForRole(registry, 'todd');
    assert.deepEqual(ranked, []);
    assert.deepEqual(eligible, []);
  });

  it('returns the original order when no profiles are present', () => {
    const registry = loadModelRegistry({
      data: {
        ...SAMPLE,
        userSelected: {
          models: ['claude-minimax/MiniMax-M3', 'claude-qwen/qwen3.8-max', 'claude/haiku-4-5'],
          tierHints: { 'claude-minimax/MiniMax-M3': 'default', 'claude-qwen/qwen3.8-max': 'premium', 'claude/haiku-4-5': 'high' },
        },
      },
    });
    const { ranked, eligible } = rankUserSelectedForRole(registry, 'todd');
    assert.equal(ranked.length, 3);
    assert.equal(ranked[0].id, 'claude-minimax/MiniMax-M3');
    assert.equal(ranked[1].id, 'claude-qwen/qwen3.8-max');
    assert.equal(ranked[2].id, 'claude/haiku-4-5');
    assert.equal(ranked[0].originalIndex, 0);
    assert.equal(ranked[0].hasProfile, false);
    assert.equal(ranked[0].eligible, true);
    assert.deepEqual(ranked[0].ineligibleReasons, []);
    assert.equal(eligible.length, 3);
  });

  it('ranks models with profiles ahead of models without profiles', () => {
    const registry = loadModelRegistry({
      data: {
        ...SAMPLE,
        userSelected: {
          models: ['claude/legacy', 'claude-modern/full'],
          profiles: {
            'claude-modern/full': {
              name: 'claude-modern/full',
              capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true },
              limits: { contextTokens: 200000, inputTokens: null, outputTokens: null },
            },
          },
        },
      },
    });
    const { ranked } = rankUserSelectedForRole(registry, 'todd');
    assert.equal(ranked[0].id, 'claude-modern/full', 'profile beats no-profile');
    assert.equal(ranked[0].hasProfile, true);
    assert.equal(ranked[0].capabilityScore > 0, true);
    assert.equal(ranked[1].id, 'claude/legacy');
    assert.equal(ranked[1].hasProfile, false);
  });

  it('ranks higher capability scores first across profiled candidates', () => {
    const registry = loadModelRegistry({
      data: {
        ...SAMPLE,
        userSelected: {
          models: ['claude/small', 'claude/large', 'claude/full'],
          profiles: {
            'claude/small': { capabilities: { reasoning: false, toolCall: true } },
            'claude/full': { capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true, inputModalities: ['text', 'image'] } },
            'claude/large': { capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true } },
          },
        },
      },
    });
    const { ranked } = rankUserSelectedForRole(registry, 'todd');
    const order = ranked.map((entry) => entry.id);
    assert.deepEqual(order, ['claude/full', 'claude/large', 'claude/small']);
    assert.equal(ranked[0].capabilityScore, Math.round((0.3 + 0.25 + 0.15 + 0.1 + 0.05 + 0.15) * 1e6) / 1e6);
  });

  it('filters by requirements.minContextTokens and reports the reason', () => {
    const registry = loadModelRegistry({
      data: {
        ...SAMPLE,
        userSelected: {
          models: ['claude/tiny', 'claude/huge'],
          profiles: {
            'claude/tiny': { capabilities: { reasoning: true }, limits: { contextTokens: 8000, inputTokens: null, outputTokens: null } },
            'claude/huge': { capabilities: { reasoning: true }, limits: { contextTokens: 200000, inputTokens: null, outputTokens: null } },
          },
        },
      },
    });
    const { ranked, eligible } = rankUserSelectedForRole(registry, 'karen', { minContextTokens: 32000 });
    assert.equal(eligible.length, 1, 'only the 200K model clears the 32K floor');
    assert.equal(eligible[0].id, 'claude/huge');
    const tiny = ranked.find((entry) => entry.id === 'claude/tiny');
    assert.equal(tiny.eligible, false);
    assert.deepEqual(tiny.ineligibleReasons, ['contextTokens 8000 < required 32000']);
  });

  it('parseUserSelected tolerates a corrupt profiles block and skips invalid entries', () => {
    const registry = loadModelRegistry({
      data: {
        ...SAMPLE,
        userSelected: {
          models: ['claude/ok', 'claude/broken', 'claude/wrong-types'],
          profiles: {
            'claude/ok': { capabilities: { reasoning: true }, limits: { contextTokens: 128000 } },
            'claude/broken': 'this should be an object',
            'claude/wrong-types': null,
            'claude/wrong-number': 42,
            'claude/array-value': ['not', 'an', 'object'],
            'claude/wrong-types': { capabilities: 'not-an-object', limits: { contextTokens: 'not-a-number' } },
          },
        },
      },
    });
    // Load must not throw even with a degenerate profiles block.
    assert.ok(registry.userSelected, 'userSelected block survives corrupt profiles');
    assert.deepEqual(registry.userSelected.models, ['claude/ok', 'claude/broken', 'claude/wrong-types']);
    assert.ok(registry.userSelected.profiles, 'valid profiles survive the defensive read');
    assert.ok(registry.userSelected.profiles['claude/ok'], 'good profile retained with its fields');
    assert.equal(registry.userSelected.profiles['claude/ok'].limits.contextTokens, 128000);
    assert.equal(registry.userSelected.profiles['claude/broken'], undefined, 'non-object entry dropped');
    assert.equal(registry.userSelected.profiles['claude/wrong-number'], undefined, 'number entry dropped');
    assert.equal(registry.userSelected.profiles['claude/array-value'], undefined, 'array entry dropped');
    // Object-shaped entry with bad nested types is kept but fields fall back to defaults.
    assert.ok(registry.userSelected.profiles['claude/wrong-types'], 'object entry with bad nested fields kept');
    assert.equal(registry.userSelected.profiles['claude/wrong-types'].capabilities.reasoning, false);
    assert.equal(registry.userSelected.profiles['claude/wrong-types'].limits.contextTokens, undefined);
  });

  it('defaultTierHintForId mirrors the picker heuristic ordering', () => {
    assert.equal(defaultTierHintForId('claude-haiku-4-5'), 'high');
    assert.equal(defaultTierHintForId('claude/haiku-4-x'), 'high');
    assert.equal(defaultTierHintForId('claude-haiku'), 'budget');
    assert.equal(defaultTierHintForId('claude-qwen/qwen3.8-max'), 'premium');
    assert.equal(defaultTierHintForId('claude-opus-4-1'), 'premium');
    assert.equal(defaultTierHintForId('claude-sonnet-4-5'), 'premium');
    assert.equal(defaultTierHintForId('claude-sonnet-3-7'), 'high');
    assert.equal(defaultTierHintForId('claude-sonnet'), 'default');
    assert.equal(defaultTierHintForId('claude-gpt-4o'), 'default');
    assert.equal(defaultTierHintForId('claude/gpt-5'), 'premium');
    assert.equal(defaultTierHintForId('claude/flash'), 'budget');
    assert.equal(defaultTierHintForId(''), 'default');
  });

  it('evaluateRoleRequirements returns ineligible list when multiple floors fail', () => {
    const profile = {
      capabilities: { reasoning: false, toolCall: true, structuredOutput: false },
      limits: { contextTokens: 4000, inputTokens: null, outputTokens: null },
    };
    const result = evaluateRoleRequirements(profile, { minContextTokens: 32000, requireReasoning: true, requireStructuredOutput: true }, 'mid');
    assert.equal(result.eligible, false);
    assert.equal(result.ineligibleReasons.length, 3);
    assert.ok(result.ineligibleReasons.includes('contextTokens 4000 < required 32000'));
    assert.ok(result.ineligibleReasons.includes('missing required reasoning capability'));
    assert.ok(result.ineligibleReasons.includes('missing required structured-output capability'));
  });

  it('scoreCapabilityProfile returns 0 for missing profiles and 1.0 for full-capability profiles', () => {
    assert.equal(scoreCapabilityProfile(undefined), 0);
    assert.equal(scoreCapabilityProfile({}), 0);
    assert.equal(scoreCapabilityProfile({ capabilities: {} }), 0);
    assert.equal(scoreCapabilityProfile({
      capabilities: {
        reasoning: true,
        toolCall: true,
        structuredOutput: true,
        attachment: true,
        temperature: true,
        inputModalities: ['text', 'image'],
      },
    }), Math.round(1.0 * 1e6) / 1e6);
  });

  it('compareRankedEntries orders eligible > ineligible and score > originalIndex', () => {
    const eligibleHigh = { id: 'a', tier: 'high', eligible: true, ineligibleReasons: [], capabilityScore: 0.5, hasProfile: true, originalIndex: 0 };
    const eligibleLow = { id: 'b', tier: 'high', eligible: true, ineligibleReasons: [], capabilityScore: 0.4, hasProfile: true, originalIndex: 1 };
    const ineligible = { id: 'c', tier: 'high', eligible: false, ineligibleReasons: ['x'], capabilityScore: 0.9, hasProfile: true, originalIndex: 2 };
    assert.equal(compareRankedEntries(eligibleHigh, eligibleLow) < 0, true, 'higher score wins');
    assert.equal(compareRankedEntries(eligibleHigh, ineligible) < 0, true, 'eligible wins even against higher score');
    assert.equal(compareRankedEntries(eligibleLow, eligibleLow), 0, 'equal entries sort stably');
  });
});
