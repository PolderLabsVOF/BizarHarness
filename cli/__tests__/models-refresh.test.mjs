/**
 * cli/__tests__/models-refresh.test.mjs
 *
 * F-190 / IMP-017 `bizar models --refresh` + `bizar models explain`
 * regression coverage.
 *
 * The refresh path is exposed through `applyRefresh` for unit tests;
 * the subprocess tests cover the actual CLI binary. Network failures
 * are exercised against a stub HTTP server that returns 500.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CWD = process.cwd();
const BIN = join(CWD, 'cli', 'bin.mjs');

// Imports from the CLI module — these are the canonical test surface.
// `applyRefresh` is the pure function that writes the router file.
const modelsCmd = await import('../../cli/commands/models.mjs');
const { applyRefresh, explainSelection, fetchModelsDevCatalog } = modelsCmd;

function makeCwd() {
  return mkdtempSync(join(tmpdir(), 'bizar-models-refresh-'));
}

function writeRouter(cwd, userSelected) {
  const path = join(cwd, 'model-router.json');
  writeFileSync(path, JSON.stringify({
    version: '13.0.0',
    endpoint: 'http://stub/v1',
    tiers: { premium: { models: ['stub/p'], purpose: 'x', effort: 'high' } },
    policies: { selectionOwner: 'orchestrator', discoveryFailure: 'inherit-session', unavailableModel: 'inherit-session', retryModelAliases: false, maxDispatchModelAttempts: 1 },
    userSelected,
  }, null, 2));
  return path;
}

function makeCatalog() {
  return {
    'anthropic/claude-haiku': {
      name: 'Claude Haiku',
      reasoning: true,
      tool_call: true,
      limit: { context: 200000, output: 8192 },
      modalities: { input: ['text', 'image'], output: ['text'] },
    },
    'anthropic/claude-opus': {
      name: 'Claude Opus',
      reasoning: true,
      tool_call: true,
      limit: { context: 200000, output: 8192 },
      modalities: { input: ['text', 'image'], output: ['text'] },
    },
  };
}

test('applyRefresh: updates profiles whose expiresAt < now, leaves fresh ones untouched', () => {
  const cwd = makeCwd();
  try {
    const routerPath = writeRouter(cwd, {
      models: ['anthropic/claude-haiku', 'anthropic/claude-opus'],
      tierHints: { 'anthropic/claude-haiku': 'high', 'anthropic/claude-opus': 'premium' },
      profiles: {
        'anthropic/claude-haiku': {
          gatewayId: 'anthropic/claude-haiku',
          baseModel: 'anthropic/claude-haiku',
          name: 'Claude Haiku (stale)',
          capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true, inputModalities: ['text'] },
          limits: { contextTokens: 4096, inputTokens: null, outputTokens: null },
          metadata: { source: 'models.dev', retrievedAt: '2026-01-01T00:00:00.000Z', matchType: 'exact-id', confidence: 0.9 },
          provenance: { source: 'models.dev', retrievedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-08T00:00:00.000Z', refreshRequiredAfter: '2026-01-07T00:00:00.000Z', matchType: 'exact-id', confidence: 0.9 },
        },
        'anthropic/claude-opus': {
          gatewayId: 'anthropic/claude-opus',
          baseModel: 'anthropic/claude-opus',
          name: 'Claude Opus (fresh)',
          capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true, inputModalities: ['text'] },
          limits: { contextTokens: 200000, inputTokens: null, outputTokens: 8192 },
          metadata: { source: 'models.dev', retrievedAt: '2026-08-26T00:00:00.000Z', matchType: 'exact-id', confidence: 0.9 },
          provenance: { source: 'models.dev', retrievedAt: '2026-08-26T00:00:00.000Z', expiresAt: '2026-09-02T00:00:00.000Z', refreshRequiredAfter: '2026-09-01T00:00:00.000Z', matchType: 'exact-id', confidence: 0.9 },
        },
      },
    });
    const summary = applyRefresh({
      routerPath,
      candidates: [
        { id: 'anthropic/claude-haiku' },
        { id: 'anthropic/claude-opus' },
      ],
      catalog: makeCatalog(),
      now: new Date('2026-08-26T12:00:00.000Z'),
    });
    assert.deepEqual(summary.refreshed, ['anthropic/claude-haiku']);
    assert.ok(summary.skippedFresh.includes('anthropic/claude-opus'), `opus should be skipped; got skippedFresh=${JSON.stringify(summary.skippedFresh)}`);
    assert.deepEqual(summary.preservedOperator, []);
    const after = JSON.parse(readFileSync(routerPath, 'utf8')).userSelected;
    // Haiku was refreshed — provenance moved forward, context widened.
    const haiku = after.profiles['anthropic/claude-haiku'];
    assert.ok(haiku.provenance.retrievedAt >= '2026-08-26T12:00:00.000Z');
    assert.equal(haiku.limits.contextTokens, 200000);
    // Opus was NOT refreshed — provenance unchanged.
    const opus = after.profiles['anthropic/claude-opus'];
    assert.equal(opus.provenance.retrievedAt, '2026-08-26T00:00:00.000Z');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyRefresh: operator overrides survive a refresh that would otherwise overwrite them', () => {
  const cwd = makeCwd();
  try {
    const routerPath = writeRouter(cwd, {
      models: ['anthropic/claude-haiku'],
      tierHints: { 'anthropic/claude-haiku': 'high' },
      profiles: {
        'anthropic/claude-haiku': {
          gatewayId: 'anthropic/claude-haiku',
          baseModel: 'anthropic/claude-haiku',
          capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true, inputModalities: ['text'] },
          limits: { contextTokens: 200000, inputTokens: null, outputTokens: 8192 },
          metadata: { source: 'models.dev', retrievedAt: '2026-01-01T00:00:00.000Z', matchType: 'exact-id', confidence: 0.9 },
          provenance: { source: 'models.dev', retrievedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-08T00:00:00.000Z', refreshRequiredAfter: '2026-01-07T00:00:00.000Z', matchType: 'exact-id', confidence: 0.9 },
          operatorOverrides: {
            contextTokens: 200000,
            reasoning: true,
          },
        },
      },
    });
    const summary = applyRefresh({
      routerPath,
      candidates: [{ id: 'anthropic/claude-haiku' }],
      catalog: makeCatalog(),
      now: new Date('2026-08-26T12:00:00.000Z'),
    });
    assert.deepEqual(summary.refreshed, ['anthropic/claude-haiku']);
    const after = JSON.parse(readFileSync(routerPath, 'utf8')).userSelected;
    const haiku = after.profiles['anthropic/claude-haiku'];
    // Operator override survives: contextTokens is 200000.
    assert.equal(haiku.limits.contextTokens, 200000);
    assert.equal(haiku.operatorOverrides.contextTokens, 200000);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('bizar models --refresh: network failure leaves existing profiles intact, exits non-zero', async () => {
  const srv = await new Promise((resolveP) => {
    const s = createServer((req, res) => {
      if (req.url && req.url.startsWith('/models.json')) {
        res.writeHead(500).end('upstream down');
        return;
      }
      res.writeHead(404).end();
    });
    s.listen(0, '127.0.0.1', () => resolveP(s));
  });
  try {
    const port = srv.address().port;
    const cwd = makeCwd();
    try {
      const routerPath = writeRouter(cwd, {
        models: ['anthropic/claude-haiku'],
        tierHints: {},
        profiles: {
          'anthropic/claude-haiku': {
            capabilities: { reasoning: true, toolCall: true },
            metadata: { source: 'models.dev' },
            provenance: { source: 'models.dev', retrievedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-08T00:00:00.000Z', refreshRequiredAfter: '2026-01-07T00:00:00.000Z', matchType: 'exact-id', confidence: 0.9 },
          },
        },
      });
      const original = readFileSync(routerPath, 'utf8');
      const child = spawn(process.execPath, [BIN, 'models', '--refresh'], {
        cwd,
        env: {
          ...process.env,
          BIZAR_SKIP_BUILD: '1',
          BIZAR_MODEL_ROUTER_CONFIG: routerPath,
          BIZAR_MODEL_ROUTER_URL: `http://127.0.0.1:${port}/v1`,
          BIZAR_MODELS_DEV_URL: `http://127.0.0.1:${port}/models.json`,
          ANTHROPIC_AUTH_TOKEN: 'tok',
          HOME: cwd,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += String(d); });
      const code = await new Promise((resolveP) => child.on('exit', resolveP));
      assert.notEqual(code, 0, 'exit non-zero on network failure');
      assert.match(stderr, /refresh failed|Models\.dev|upstream/i);
      // Existing profile is untouched.
      const after = readFileSync(routerPath, 'utf8');
      assert.equal(after, original);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  } finally {
    await new Promise((resolveP) => srv.close(resolveP));
  }
});

test('explainSelection: surfaces reasons: [...] for ineligible discriminated profiles', () => {
  const cwd = makeCwd();
  try {
    const routerPath = writeRouter(cwd, {
      models: ['anthropic/claude-haiku', 'anthropic/claude-opus'],
      tierHints: { 'anthropic/claude-haiku': 'high', 'anthropic/claude-opus': 'premium' },
      profiles: {},
      discriminatedProfiles: {
        'anthropic/claude-haiku': {
          id: 'anthropic/claude-haiku',
          provider: 'anthropic',
          enabled: true,
          protocol: {
            toolUse: true,
            reasoning: true,
            modalities: ['text'],
            structuredOutput: true,
            contextTokens: 4096,
            maxOutputTokens: 1024,
          },
          measured: { coding: 0.7, debugging: 0.6 },
          provenance: { source: 'models.dev', retrievedAt: '2026-08-20T00:00:00.000Z', expiresAt: '2026-08-27T00:00:00.000Z', refreshRequiredAfter: '2026-08-26T00:00:00.000Z', matchType: 'exact', confidence: 0.9 },
        },
        'anthropic/claude-opus': {
          id: 'anthropic/claude-opus',
          provider: 'anthropic',
          enabled: true,
          protocol: {
            toolUse: true,
            reasoning: true,
            modalities: ['text', 'image'],
            structuredOutput: true,
            contextTokens: 200000,
            maxOutputTokens: 8192,
          },
          measured: { coding: 0.92, debugging: 0.88 },
          provenance: { source: 'models.dev', retrievedAt: '2026-08-20T00:00:00.000Z', expiresAt: '2026-08-27T00:00:00.000Z', refreshRequiredAfter: '2026-08-26T00:00:00.000Z', matchType: 'exact', confidence: 0.9 },
        },
      },
    });
    const verdict = explainSelection({
      routerPath,
      role: 'todd',
      requirements: { minContextTokens: 32000, requireImageInput: true },
    });
    const haiku = verdict.ranked.find((e) => e.id === 'anthropic/claude-haiku');
    assert.ok(haiku, 'haiku entry present');
    assert.equal(haiku.eligible, false);
    assert.ok(Array.isArray(haiku.reasons));
    assert.ok(haiku.reasons.some((r) => r.includes('context-too-small: 4096 < 32000')));
    assert.ok(haiku.reasons.some((r) => r.includes('no-image-input')));
    assert.deepEqual(haiku.measured, { coding: 0.7, debugging: 0.6 });
    assert.equal(haiku.provenance.source, 'models.dev');
    assert.equal(haiku.provenance.expiresAt, '2026-08-27T00:00:00.000Z');
    const opus = verdict.ranked.find((e) => e.id === 'anthropic/claude-opus');
    assert.equal(opus.eligible, true);
    assert.ok(Array.isArray(opus.reasons));
    assert.equal(opus.reasons.length, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('fetchModelsDevCatalog: stub server 200 returns parsed JSON body', async () => {
  const srv = await new Promise((resolveP) => {
    const s = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ 'anthropic/claude-haiku': { tool_call: true } }));
    });
    s.listen(0, '127.0.0.1', () => resolveP(s));
  });
  try {
    const port = srv.address().port;
    const body = await fetchModelsDevCatalog({ url: `http://127.0.0.1:${port}/models.json` });
    assert.equal(body['anthropic/claude-haiku'].tool_call, true);
  } finally {
    await new Promise((resolveP) => srv.close(resolveP));
  }
});
