/**
 * test/agent-model-registry.test.mjs
 *
 * v10.1.0 — Smoke test for the agent → model registry loader:
 *   - Reads .claude/model-router.json
 *   - Resolves an agent to its concrete modelId + endpoint
 *   - Falls back to defaults when the agent is unknown
 *   - Resolves a tier to its primary + fallback modelIds
 *   - Honors env overrides for the endpoint
 */
import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadModelRegistry,
  resolveAgentModel,
  resolveTierModel,
  listAgentModels,
  getEndpoint,
} from '../src/router/agent-model-registry.ts';

const SAMPLE = {
  endpoint: 'http://localhost:20128/v1',
  tiers: {
    premium: { models: ['cx/gpt-5.6-sol'], purpose: 'Top-tier reasoning.' },
    default: { models: ['bizar/MiniMax-M3'], purpose: 'Everyday default.' },
    budget: { models: ['oc/deepseek-v4-flash-free', 'oc/mimo-v2.5-free'], purpose: 'Cheap.' },
  },
  agents: {
    odin: { model: 'cx/gpt-5.6-terra', tier: 'high', rationale: 'routing' },
    thor: { model: 'bizar/MiniMax-M2.7', tier: 'mid', rationale: 'mid-impl' },
    quick: { model: 'oc/deepseek-v4-flash-free', tier: 'budget', rationale: 'tiny' },
    heimdall: { model: 'bizar/MiniMax-M3', tier: 'default', rationale: 'mech' },
  },
  policies: {
    fallback_chain: ['cx/gpt-5.6-sol', 'bizar/MiniMax-M3', 'oc/mimo-v2.5-free'],
    gpt_only_for: ['complex debugging', 'planning work', 'UI design language'],
    gpt_never_for: ['research', 'implementation', 'everyday tasks'],
  },
};

describe('agent-model-registry', () => {
  let tmpDir;
  let cfgPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bizar-registry-'));
    cfgPath = join(tmpDir, 'model-router.json');
    writeFileSync(cfgPath, JSON.stringify(SAMPLE));
  });

  it('loads the JSON and exposes endpoint + agents + tiers', () => {
    const reg = loadModelRegistry({ configPath: cfgPath });
    assert.equal(reg.endpoint, 'http://localhost:20128/v1');
    assert.equal(reg.agents.size, 4);
    assert.equal(reg.tiers.size, 3);
    assert.deepEqual(reg.fallbackChain, SAMPLE.policies.fallback_chain);
    assert.deepEqual(reg.gptOnlyFor, SAMPLE.policies.gpt_only_for);
    assert.deepEqual(reg.gptNeverFor, SAMPLE.policies.gpt_never_for);
  });

  it('resolves a known agent to its model + endpoint', () => {
    const reg = loadModelRegistry({ configPath: cfgPath });
    const r = resolveAgentModel('odin', reg);
    assert.equal(r.agent, 'odin');
    assert.equal(r.modelId, 'cx/gpt-5.6-terra');
    assert.equal(r.tier, 'high');
    assert.equal(r.endpoint, 'http://localhost:20128/v1');
    assert.match(r.rationale, /routing/);
  });

  it('falls back to the default agent on an unknown agent', () => {
    const reg = loadModelRegistry({ configPath: cfgPath });
    const r = resolveAgentModel('nonexistent', reg);
    // Falls back to "odin" if it exists, else "default" agent entry.
    assert.ok(r.modelId.length > 0);
    assert.ok(r.endpoint.startsWith('http'));
  });

  it('resolves a tier to its primary + fallback models', () => {
    const reg = loadModelRegistry({ configPath: cfgPath });
    const r = resolveTierModel('budget', reg);
    assert.equal(r.modelId, 'oc/deepseek-v4-flash-free');
    assert.deepEqual(r.fallback, ['oc/mimo-v2.5-free']);
    assert.equal(r.endpoint, 'http://localhost:20128/v1');
  });

  it('listAgentModels returns the full table', () => {
    const reg = loadModelRegistry({ configPath: cfgPath });
    const list = listAgentModels(reg);
    assert.equal(list.length, 4);
    const names = list.map((a) => a.agent);
    assert.ok(names.includes('odin'));
    assert.ok(names.includes('quick'));
  });

  it('env override on endpoint wins over the JSON', () => {
    process.env.BIZAR_MODEL_ROUTER_URL = 'http://custom:9000/v1';
    try {
      const reg = loadModelRegistry({ configPath: cfgPath });
      assert.equal(reg.endpoint, 'http://custom:9000/v1');
      const r = resolveAgentModel('quick', reg);
      assert.equal(r.endpoint, 'http://custom:9000/v1');
    } finally {
      delete process.env.BIZAR_MODEL_ROUTER_URL;
    }
  });

  it('missing config file does not throw', () => {
    // Don't make this depend on the real `.claude/model-router.json`.
    // Point at a path that we know doesn't exist.
    const reg = loadModelRegistry({ configPath: join(tmpDir, 'does-not-exist.json') });
    assert.ok(reg.endpoint.startsWith('http'));
    // Unknown agent → falls back gracefully (never throws).
    const r = resolveAgentModel('foo', reg);
    assert.ok(r.modelId.length > 0);
  });

  it('getEndpoint honors env without loading the registry', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://env:1234/v1';
    try {
      assert.equal(getEndpoint(), 'http://env:1234/v1');
    } finally {
      delete process.env.ANTHROPIC_BASE_URL;
    }
  });

  // cleanup
  it('teardown', () => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });
});