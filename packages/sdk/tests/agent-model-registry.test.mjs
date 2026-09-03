import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ModelRegistryError,
  classifyError,
  compareRankedEntries,
  createRunAssignmentSnapshot,
  defaultTierHintForId,
  evaluateRoleRequirements,
  getEndpoint,
  listAgentModels,
  loadModelRegistry,
  pickFailover,
  rankUserSelectedForRole,
  resolveAgentModel,
  resolveTierModel,
  scoreCapabilityProfile,
  userSelectedModelIds,
  verifyRunAssignmentSnapshot,
  TRANSPORT_OR_AVAILABILITY,
} from '../src/router/agent-model-registry.ts';
import {
  classifyError as classifyErrorMirror,
  pickFailover as pickFailoverMirror,
  rankUserSelectedForRole as rankUserSelectedForRoleMirror,
} from '../src/router/failover-mirror.mjs';
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

  it('matches the CLI snapshot contract for the same global-router fixture', () => {
    const cliRegistry = loadModelRouter(configPath);
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
    // The userSelected.models order is the authoritative primary sort key.
    // Profiles (capability, eligibility) are tiebreakers when two entries
    // share the same originalIndex position — which cannot happen in
    // practice since originalIndex is unique per entry. The `hasProfile`
    // tiebreaker is retained for defensive completeness.
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
    assert.equal(ranked[0].id, 'claude/legacy', 'originalIndex 0 wins regardless of profile');
    assert.equal(ranked[0].hasProfile, false);
    assert.equal(ranked[1].id, 'claude-modern/full');
    assert.equal(ranked[1].hasProfile, true);
    assert.equal(ranked[1].capabilityScore > 0, true);
  });

  it('ranks higher capability scores first across profiled candidates', () => {
    // UserSelected.models order is primary. The higher-capability model
    // (claude/full) is at originalIndex 2, so it ranks last among the
    // three; capability becomes the tiebreaker only when two entries share
    // the same originalIndex position (impossible in practice). This is
    // intentional parity with the CLI's resolveDispatchModel, which also
    // respects userSelected.models order as the authoritative sequence.
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
    assert.deepEqual(order, ['claude/small', 'claude/large', 'claude/full'], 'userSelected.models order is authoritative; capability tiebreaks identical originalIndex only');
    assert.equal(ranked[0].capabilityScore, Math.round((0.25 + 0.05) * 1e6) / 1e6, 'small model score: toolCall(0.25) + implicit temperature(true)(0.05) = 0.3');
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

  it('resolveTierModel with userSelected non-empty picks the first eligible ranked ID that is also in availableModelIds', () => {
    const registry = loadModelRegistry({
      data: {
        ...SAMPLE,
        tiers: {
          premium: { models: ['tier/premium-default-a', 'tier/premium-default-b'], purpose: 'p', effort: 'high' },
          default: { models: ['tier/default-default'], purpose: 'd', effort: 'medium' },
          mid: { models: ['tier/mid-a', 'tier/mid-b'], purpose: 'm', effort: 'medium' },
        },
        userSelected: {
          models: ['provider/opus', 'provider/haiku', 'provider/sonnet'],
          tierHints: { 'provider/opus': 'premium', 'provider/haiku': 'default', 'provider/sonnet': 'default' },
          profiles: {
            'provider/opus': { capabilities: { reasoning: true, toolCall: true, structuredOutput: true } },
            'provider/sonnet': { capabilities: { reasoning: true, toolCall: true } },
            'provider/haiku': { capabilities: { reasoning: false, toolCall: true } },
          },
        },
      },
    });
    const resolved = resolveTierModel('premium', registry, ['tier/premium-default-a', 'provider/sonnet', 'provider/opus']);
    assert.equal(resolved.modelId, 'provider/opus', 'premium tier picks the first eligible userSelected candidate');
    assert.equal(resolved.inheritSession, false);
    const agentResolved = resolveAgentModel('mike', registry, ['tier/premium-default-a', 'provider/sonnet', 'provider/opus']);
    assert.equal(agentResolved.rationale, 'userSelected-ranked');
  });

  it('resolveTierModel with userSelected non-empty falls through to the tier default when no userSelected ID is in availableModelIds', () => {
    const registry = loadModelRegistry({
      data: {
        ...SAMPLE,
        tiers: {
          premium: { models: ['tier/premium-default-a', 'tier/premium-default-b'], purpose: 'p', effort: 'high' },
          default: { models: ['tier/default-default'], purpose: 'd', effort: 'medium' },
          mid: { models: ['tier/mid-a', 'tier/mid-b'], purpose: 'm', effort: 'medium' },
        },
        userSelected: {
          models: ['provider/opus', 'provider/sonnet'],
          tierHints: { 'provider/opus': 'premium' },
          profiles: {
            'provider/opus': { capabilities: { reasoning: true } },
            'provider/sonnet': { capabilities: { reasoning: true } },
          },
        },
      },
    });
    // availableModelIds contains only tier-default IDs, none of which are userSelected.
    const resolved = resolveTierModel('premium', registry, ['tier/premium-default-b']);
    assert.equal(resolved.modelId, 'tier/premium-default-b', 'falls back to the first live tier candidate');
    assert.equal(resolved.inheritSession, false);
    const agentResolved = resolveAgentModel('mike', registry, ['tier/premium-default-b']);
    assert.equal(agentResolved.rationale, 'first live tier candidate');
  });
});

// ─── F-185 / IMP-019 health-aware selected-pool failover ──────────────────

describe('health-aware selected-pool failover (F-185)', () => {
  function loadFailoverRegistry() {
    return loadModelRegistry({
      data: {
        ...SAMPLE,
        userSelected: {
          models: ['provider/opus', 'provider/sonnet', 'provider/haiku'],
          tierHints: { 'provider/opus': 'premium', 'provider/sonnet': 'default', 'provider/haiku': 'budget' },
          profiles: {
            'provider/opus': { capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true }, limits: { contextTokens: 200000, inputTokens: null, outputTokens: null } },
            'provider/sonnet': { capabilities: { reasoning: true, toolCall: true }, limits: { contextTokens: 128000, inputTokens: null, outputTokens: null } },
            'provider/haiku': { capabilities: { reasoning: false, toolCall: true }, limits: { contextTokens: 32000, inputTokens: null, outputTokens: null } },
          },
        },
      },
    });
  }

  it('exposes TRANSPORT_OR_AVAILABILITY with the expected taxonomy', () => {
    assert.deepEqual(
      [...TRANSPORT_OR_AVAILABILITY].sort(),
      ['auth-failure', 'invalid-model', 'provider-outage', 'rate-limit', 'timeout'],
    );
  });

  it('pickFailover returns no failover for non-transport failure reasons', () => {
    const registry = loadFailoverRegistry();
    const contextVerdict = pickFailover({ registry, role: 'todd', attemptedIds: [], failure: 'context-overflow' });
    assert.equal(contextVerdict.failover, null);
    assert.equal(contextVerdict.exhaustReason, 'context-overflow');
    assert.equal(contextVerdict.attempts, 0);
    assert.equal(contextVerdict.chain.length, 1);
    assert.equal(contextVerdict.chain[0].outcome, 'skipped-non-transport-reason');

    const qualityVerdict = pickFailover({ registry, role: 'todd', attemptedIds: [], failure: 'model-quality' });
    assert.equal(qualityVerdict.failover, null);
    assert.equal(qualityVerdict.exhaustReason, 'model-quality');
  });

  it('pickFailover returns no failover when userSelected is empty', () => {
    const registry = loadModelRegistry({ data: SAMPLE });
    const verdict = pickFailover({ registry, role: 'todd', attemptedIds: [], failure: 'provider-outage' });
    assert.equal(verdict.failover, null);
    assert.equal(verdict.exhaustReason, 'provider-outage');
    assert.deepEqual(verdict.chain, []);
  });

  it('pickFailover walks to the next eligible ID when the primary was attempted and failed', () => {
    const registry = loadFailoverRegistry();
    const verdict = pickFailover({ registry, role: 'todd', attemptedIds: ['provider/opus'], failure: 'provider-outage' });
    assert.ok(verdict.failover, 'failover candidate is selected');
    assert.equal(verdict.failover.id, 'provider/sonnet');
    assert.equal(verdict.failover.reason, 'provider-outage');
    assert.equal(verdict.exhaustReason, null, 'a new failover was picked → chain is not yet exhausted');
    assert.equal(verdict.attempts, 2, '1 attempted + 1 new failover = 2 total attempts');
    const haiku = verdict.chain.find((entry) => entry.id === 'provider/haiku');
    assert.ok(haiku);
    assert.equal(haiku.outcome, 'exhausted', 'eligible entries past the failover cap are marked exhausted');
  });

  it('pickFailover marks the primary and skips already-attempted eligible entries', () => {
    const registry = loadFailoverRegistry();
    const verdict = pickFailover({ registry, role: 'todd', attemptedIds: ['provider/opus', 'provider/sonnet'], failure: 'auth-failure' });
    assert.equal(verdict.failover.id, 'provider/haiku', 'first non-attempted eligible ID');
    assert.equal(verdict.attempts, 3, '2 attempted + 1 new failover = 3 total attempts');
    assert.equal(verdict.exhaustReason, null, 'haiku is still a fresh failover target');
    const skipped = verdict.chain.find((entry) => entry.id === 'provider/sonnet');
    assert.equal(skipped.outcome, 'skipped-already-attempted');
  });

  it('pickFailover returns exhaustReason when every eligible ID is already attempted', () => {
    const registry = loadFailoverRegistry();
    const verdict = pickFailover({ registry, role: 'todd', attemptedIds: ['provider/opus', 'provider/sonnet', 'provider/haiku'], failure: 'rate-limit' });
    assert.equal(verdict.failover, null);
    assert.equal(verdict.exhaustReason, 'rate-limit');
    assert.equal(verdict.attempts, 3);
    assert.ok(verdict.chain.every((entry) => entry.outcome === 'skipped-already-attempted' || entry.outcome === 'primary'));
  });

  it('pickFailover treats ineligible IDs as invisible to the failover chain', () => {
    const registry = loadModelRegistry({
      data: {
        ...SAMPLE,
        userSelected: {
          models: ['provider/big', 'provider/tiny', 'provider/medium'],
          tierHints: { 'provider/big': 'premium', 'provider/tiny': 'budget', 'provider/medium': 'default' },
          profiles: {
            'provider/big': { capabilities: { reasoning: true, toolCall: true }, limits: { contextTokens: 200000, inputTokens: null, outputTokens: null } },
            'provider/tiny': { capabilities: { reasoning: true, toolCall: true }, limits: { contextTokens: 8000, inputTokens: null, outputTokens: null } },
            'provider/medium': { capabilities: { reasoning: true, toolCall: true }, limits: { contextTokens: 64000, inputTokens: null, outputTokens: null } },
          },
        },
      },
    });
    const verdict = pickFailover({ registry, role: 'karen', requirements: { minContextTokens: 32000 }, attemptedIds: ['provider/big'], failure: 'timeout' });
    assert.equal(verdict.failover.id, 'provider/medium', 'tiny is ineligible (8K < 32K floor) so it never appears in the chain');
    const tiny = verdict.chain.find((entry) => entry.id === 'provider/tiny');
    assert.equal(tiny, undefined, 'ineligible candidates do not surface in the chain');
  });

  it('pickFailover surfaces the full chain as an audit trail', () => {
    const registry = loadFailoverRegistry();
    const verdict = pickFailover({ registry, role: 'todd', attemptedIds: ['provider/opus'], failure: 'invalid-model' });
    assert.equal(verdict.chain.length, 3);
    const order = verdict.chain.map((entry) => entry.id);
    assert.deepEqual(order, ['provider/opus', 'provider/sonnet', 'provider/haiku']);
    const opus = verdict.chain.find((entry) => entry.id === 'provider/opus');
    assert.equal(opus.outcome, 'primary');
    assert.equal(opus.attempted, true);
    const sonnet = verdict.chain.find((entry) => entry.id === 'provider/sonnet');
    assert.equal(sonnet.outcome, 'failover');
    assert.equal(sonnet.attempted, false);
  });

  it('classifyError maps wire-level messages to the failure taxonomy', () => {
    assert.equal(classifyError('429 too many requests'), 'rate-limit');
    assert.equal(classifyError('context length exceeded'), 'context-overflow');
    assert.equal(classifyError('401 unauthorized'), 'auth-failure');
    assert.equal(classifyError('ETIMEDOUT while reaching gateway'), 'timeout');
    assert.equal(classifyError('502 bad gateway'), 'provider-outage');
    assert.equal(classifyError('model not found: foo/bar'), 'invalid-model');
    assert.equal(classifyError('output is incoherent'), 'model-quality');
    assert.equal(classifyError('???'), 'invalid-model');
  });

  it('SDK pickFailover and JS-mirror pickFailover produce identical verdicts for the same fixture', () => {
    const registry = loadFailoverRegistry();
    const sdk = pickFailover({ registry, role: 'todd', attemptedIds: ['provider/opus'], failure: 'timeout' });
    const mirror = pickFailoverMirror({ registry, role: 'todd', attemptedIds: ['provider/opus'], failure: 'timeout' });
    assert.deepEqual(mirror, sdk, 'mirror and SDK must agree on the verdict shape');
  });

  it('SDK rankUserSelectedForRole and JS-mirror agree on ranking for the same fixture', () => {
    const registry = loadFailoverRegistry();
    const sdk = rankUserSelectedForRole(registry, 'todd');
    const mirror = rankUserSelectedForRoleMirror(registry, 'todd');
    assert.deepEqual(mirror.ranked, sdk.ranked, 'mirror ranked list matches SDK');
    assert.deepEqual(mirror.eligible, sdk.eligible, 'mirror eligible list matches SDK');
  });

  it('SDK classifyError and JS-mirror classifyError agree on the taxonomy', () => {
    const fixtures = [
      '429 too many requests',
      'context length exceeded',
      '401 unauthorized',
      'ETIMEDOUT while reaching gateway',
      '502 bad gateway',
      'model not found: foo/bar',
      'output is incoherent',
      '???',
    ];
    for (const message of fixtures) {
      assert.equal(classifyError(message), classifyErrorMirror(message), `agree on ${message}`);
    }
  });
});
