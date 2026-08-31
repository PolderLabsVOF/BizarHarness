/**
 * cli/__tests__/models-picker.test.mjs
 *
 * Unit tests for `cli/commands/models.mjs`:
 *   - listModels: stubbed fetch → parsed + sorted
 *   - listModels: 401 surfaces a clear, actionable error
 *   - pickModels: simulated stdin toggles picks and respects Enter to confirm
 *   - applyModels: persists userSelected block, preserves other fields, defaults tierHints
 *   - defaultTierHint: heuristic classification
 *   - resolveEndpoint: env > settings.json > router.json > default
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import {
  listModels,
  fetchModelsDevCatalog,
  enrichModelsWithCapabilities,
  pickModels,
  applyModels,
  applyModelOverrides,
  applyModelPicker,
  defaultTierHint,
  resolveEndpoint,
  resolveRouterPath,
  currentSelection,
  explainSelection,
  classifyPickStatus,
  renderPickStatusScreen,
  run as runModelsCommand,
} from '../commands/models.mjs';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'bizar-models-'));
}

function makeInput(lines) {
  // Simulate stdin: emits one line per chunk, ends after the last.
  const r = new Readable({ read() {} });
  for (const line of lines) r.push(`${line}\n`);
  r.push(null);
  return r;
}

function makeOutput() {
  let buf = '';
  const w = new Writable({
    write(chunk, _enc, cb) { buf += String(chunk); cb(); },
  });
  w.buffer = () => buf;
  return w;
}

test('listModels: 200 response is parsed and sorted', async () => {
  const fakeFetch = async (url) => {
    assert.ok(url.endsWith('/models?limit=1000'), `unexpected url ${url}`);
    return new Response(JSON.stringify({
      data: [
        { id: 'zeta/zzz', owned_by: 'zeta' },
        { id: 'alpha/a1', owned_by: 'alpha' },
        { id: 'mid/m1', owned_by: 'mid' },
      ],
    }), { status: 200 });
  };
  const out = await listModels({ endpoint: 'http://g/v1', authToken: 'tok', fetchFn: fakeFetch });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((m) => m.id), ['alpha/a1', 'mid/m1', 'zeta/zzz']);
  assert.equal(out[0].kind, 'other');
});

test('listModels: 401 surfaces actionable error', async () => {
  const fakeFetch = async () => new Response('{"error":"unauthorized"}', { status: 401 });
  await assert.rejects(
    () => listModels({ endpoint: 'http://g/v1', authToken: 'bad', fetchFn: fakeFetch }),
    /check ANTHROPIC_AUTH_TOKEN or BIZAR_MODEL_ROUTER_URL.*401/,
  );
});

test('listModels: 403 is treated like 401 (auth error)', async () => {
  const fakeFetch = async () => new Response('forbidden', { status: 403 });
  await assert.rejects(
    () => listModels({ endpoint: 'http://g/v1', authToken: 'bad', fetchFn: fakeFetch }),
    /check ANTHROPIC_AUTH_TOKEN or BIZAR_MODEL_ROUTER_URL/,
  );
});

test('listModels: with retryWithoutAuth, retries unauthenticated after 401', async () => {
  let calls = 0;
  const fakeFetch = async (url, opts = {}) => {
    calls++;
    if (calls === 1 && opts.headers && opts.headers.Authorization) {
      return new Response('{"error":"unauthorized"}', { status: 401 });
    }
    return new Response(JSON.stringify({ data: [{ id: 'a/1' }] }), { status: 200 });
  };
  const out = await listModels({ endpoint: 'http://g/v1', authToken: 'tok', fetchFn: fakeFetch, retryWithoutAuth: true });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'a/1');
  assert.equal(calls, 2, 'two attempts: auth then unauth');
});

test('listModels: non-2xx surfaces status text', async () => {
  const fakeFetch = async () => new Response('boom', { status: 500, statusText: 'Internal Server Error' });
  await assert.rejects(
    () => listModels({ endpoint: 'http://g/v1', authToken: 'tok', fetchFn: fakeFetch }),
    /gateway returned 500/,
  );
});

test('listModels: strips trailing slash before appending /models', async () => {
  let captured = '';
  const fakeFetch = async (url) => { captured = url; return new Response('{"data":[]}', { status: 200 }); };
  await listModels({ endpoint: 'http://g/v1/', authToken: null, fetchFn: fakeFetch });
  assert.equal(captured, 'http://g/v1/models?limit=1000');
});

test('pickModels: Enter on empty input confirms current picks', async () => {
  const stdin = makeInput(['']);
  const stdout = makeOutput();
  const picked = await pickModels({
    candidates: [{ id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' }],
    current: ['b/2'],
    stdin, stdout,
  });
  assert.deepEqual(picked, ['b/2']);
});

test('pickModels: toggles a model by index, returns in selection order', async () => {
  const stdin = makeInput(['3', '']); // toggle c/3 on, then confirm
  const stdout = makeOutput();
  const picked = await pickModels({
    candidates: [{ id: 'a/1' }, { id: 'b/2' }, { id: 'c/3' }],
    current: ['a/1'],
    stdin, stdout,
  });
  assert.deepEqual(picked, ['a/1', 'c/3']);
});

test('pickModels: `all` selects every candidate', async () => {
  const stdin = makeInput(['all', '']);
  const stdout = makeOutput();
  const picked = await pickModels({
    candidates: [{ id: 'a/1' }, { id: 'b/2' }],
    current: [],
    stdin, stdout,
  });
  assert.deepEqual(picked, ['a/1', 'b/2']);
});

test('pickModels: `none` clears the selection', async () => {
  const stdin = makeInput(['none', '']);
  const stdout = makeOutput();
  const picked = await pickModels({
    candidates: [{ id: 'a/1' }, { id: 'b/2' }],
    current: ['a/1', 'b/2'],
    stdin, stdout,
  });
  assert.deepEqual(picked, []);
});

test('pickModels: duplicate toggles net to empty for that id', async () => {
  const stdin = makeInput(['1', '1', '']); // toggle a/1 on, then off
  const stdout = makeOutput();
  const picked = await pickModels({
    candidates: [{ id: 'a/1' }, { id: 'b/2' }],
    current: [],
    stdin, stdout,
  });
  assert.deepEqual(picked, []);
});

test('pickModels: throws on empty candidate list', async () => {
  const stdin = makeInput(['']);
  const stdout = makeOutput();
  await assert.rejects(
    () => pickModels({ candidates: [], stdin, stdout }),
    /at least one candidate/,
  );
});

test('applyModels: persists userSelected block and preserves other fields', () => {
  const dir = tmpDir();
  try {
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(routerPath, JSON.stringify({
      version: '12.0.0',
      endpoint: 'http://localhost:20129/v1',
      tiers: { premium: { models: ['claude-qwen/qwen3.8-max'], purpose: 'x', effort: 'high' } },
      policies: { selectionOwner: 'orchestrator' },
    }, null, 2));

    const block = applyModels({
      routerPath,
      models: ['claude-minimax/MiniMax-M3', 'claude-qwen/qwen3.8-max'],
      source: 'live-pick',
    });
    assert.deepEqual(block.models, ['claude-minimax/MiniMax-M3', 'claude-qwen/qwen3.8-max']);
    assert.equal(block.source, 'live-pick');
    assert.equal(block.tierHints['claude-minimax/MiniMax-M3'], 'default');
    assert.equal(block.tierHints['claude-qwen/qwen3.8-max'], 'premium');

    const after = JSON.parse(readFileSync(routerPath, 'utf8'));
    assert.equal(after.version, '12.0.0', 'other fields preserved');
    assert.deepEqual(after.tiers.premium.models, ['claude-qwen/qwen3.8-max']);
    assert.equal(after.policies.selectionOwner, 'orchestrator');
    assert.ok(after.userSelected, 'userSelected block written');
    assert.equal(after.userSelected.models.length, 2);
    assert.ok(after.userSelected.lastUpdated, 'lastUpdated stamped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyModels: empty models list still writes the block', () => {
  const dir = tmpDir();
  try {
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(routerPath, JSON.stringify({ version: '12.0.0' }));
    const block = applyModels({ routerPath, models: [], source: 'live-pick' });
    assert.deepEqual(block.models, []);
    const after = JSON.parse(readFileSync(routerPath, 'utf8'));
    assert.deepEqual(after.userSelected.models, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyModels: drops blank model entries', () => {
  const dir = tmpDir();
  try {
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(routerPath, JSON.stringify({ version: '12.0.0' }));
    const block = applyModels({ routerPath, models: ['a/1', '', '   ', 'b/2'], source: 'cli-set' });
    assert.deepEqual(block.models, ['a/1', 'b/2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 10.22.0 / Phase 4: `disabledProviders` filter contract ────────────────

test('applyModels: disabledProviders strips banned ids before persisting', () => {
  const dir = tmpDir();
  try {
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(routerPath, JSON.stringify({ version: '12.0.0' }));
    // Operator disabled `anthropic` — every `anthropic/*` id must be
    // stripped, but `claude-minimax/*` survives.
    const block = applyModels({
      routerPath,
      models: ['anthropic/claude-3-5-sonnet', 'claude-minimax/MiniMax-M3', 'anthropic/claude-opus-4'],
      source: 'cli-set',
      disabledProviders: ['anthropic'],
    });
    assert.deepEqual(block.models, ['claude-minimax/MiniMax-M3']);
    const after = JSON.parse(readFileSync(routerPath, 'utf8'));
    assert.deepEqual(after.userSelected.models, ['claude-minimax/MiniMax-M3']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyModelPicker: skippedDisabled returned in result shape', () => {
  // The /model picker sync must report what was dropped, not silently
  // swallow it. The disabled ids stay in the result's `skippedDisabled`
  // so the operator sees them in the interactive summary.
  const dir = tmpDir();
  try {
    const settingsJsonPath = join(dir, 'settings.json');
    writeFileSync(settingsJsonPath, JSON.stringify({}));
    const result = applyModelPicker({
      settingsJsonPath,
      pickedIds: ['anthropic/claude-3-5-sonnet', 'claude-minimax/MiniMax-M3'],
      disabledProviders: ['anthropic'],
    });
    assert.deepEqual(result.options.map((o) => o.model), ['claude-minimax/MiniMax-M3']);
    assert.deepEqual(result.skippedDisabled, ['anthropic/claude-3-5-sonnet']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('defaultTierHint: premium / high / default / mid / budget heuristics', () => {
  assert.equal(defaultTierHint('claude-qwen/qwen3.8-max'), 'premium');
  assert.equal(defaultTierHint('cx/gpt-5.6-terra'), 'premium');
  assert.equal(defaultTierHint('claude-opus-4-7'), 'premium');
  assert.equal(defaultTierHint('claude-sonnet-4-20250514'), 'premium');
  assert.equal(defaultTierHint('claude-haiku-4-5-20251001'), 'high');
  assert.equal(defaultTierHint('claude-sonnet-3-7'), 'high');
  assert.equal(defaultTierHint('claude-sonnet-3-5'), 'default');
  assert.equal(defaultTierHint('claude-minimax/MiniMax-M3'), 'default');
  assert.equal(defaultTierHint('claude-haiku'), 'budget', 'bare haiku is budget');
  assert.equal(defaultTierHint('claude-haiku-3-5'), 'budget', 'haiku-3 is the older budget family');
  assert.equal(defaultTierHint('cx/gpt-4.1'), 'default');
  assert.equal(defaultTierHint('claude-flash'), 'budget');
});

test('currentSelection: parses userSelected block', () => {
  const router = {
    userSelected: {
      models: ['a/1', 'b/2'],
      tierHints: { 'a/1': 'default', 'b/2': 'premium' },
    },
  };
  const sel = currentSelection(router);
  assert.deepEqual(sel.models, ['a/1', 'b/2']);
  assert.deepEqual(sel.tierHints, { 'a/1': 'default', 'b/2': 'premium' });
});

test('currentSelection: missing userSelected returns empty', () => {
  assert.deepEqual(currentSelection({}).models, []);
  assert.deepEqual(currentSelection(null).models, []);
});

test('resolveRouterPath: honors BIZAR_MODEL_ROUTER_CONFIG override', () => {
  const dir = tmpDir();
  try {
    const customPath = join(dir, 'my-router.json');
    writeFileSync(customPath, '{}');
    process.env.BIZAR_MODEL_ROUTER_CONFIG = customPath;
    try {
      assert.equal(resolveRouterPath(dir), customPath);
    } finally {
      delete process.env.BIZAR_MODEL_ROUTER_CONFIG;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveEndpoint: env wins over settings.json and router.json', () => {
  const dir = tmpDir();
  try {
    const settingsPath = join(dir, 'settings.json');
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(settingsPath, JSON.stringify({
      env: { BIZAR_MODEL_ROUTER_URL: 'https://settings.example/v1', ANTHROPIC_AUTH_TOKEN: 'stok' },
    }));
    writeFileSync(routerPath, JSON.stringify({ endpoint: 'https://router.example/v1' }));
    const r = resolveEndpoint({
      cwd: dir,
      env: { BIZAR_MODEL_ROUTER_URL: 'https://env.example/v1', ANTHROPIC_AUTH_TOKEN: 'etok' },
      settingsJsonPath: settingsPath,
      routerPath,
    });
    assert.equal(r.endpoint, 'https://env.example/v1');
    assert.equal(r.authToken, 'etok');
    assert.equal(r.source, 'env');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveEndpoint: settings.json wins over router.json when env missing', () => {
  const dir = tmpDir();
  try {
    const settingsPath = join(dir, 'settings.json');
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(settingsPath, JSON.stringify({
      env: { BIZAR_MODEL_ROUTER_URL: 'https://settings.example/v1' },
    }));
    writeFileSync(routerPath, JSON.stringify({ endpoint: 'https://router.example/v1' }));
    const r = resolveEndpoint({ cwd: dir, env: {}, settingsJsonPath: settingsPath, routerPath });
    assert.equal(r.endpoint, 'https://settings.example/v1');
    assert.equal(r.source, 'settings.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveEndpoint: router.json wins over default', () => {
  const dir = tmpDir();
  try {
    // Tests pass an explicit `routerPath` so they don't have to write into
    // the real BIZAR_HOME. The runtime resolver anchors the default on
    // BIZAR_HOME — see `resolveRouterPath`.
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(routerPath, JSON.stringify({ endpoint: 'https://router.example/v1' }));
    const r = resolveEndpoint({ cwd: dir, env: {}, settingsJsonPath: join(dir, 'nope.json'), routerPath });
    assert.equal(r.endpoint, 'https://router.example/v1');
    assert.equal(r.source, 'model-router.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveEndpoint: returns unconfigured when no source is set', () => {
  const dir = tmpDir();
  const r = resolveEndpoint({ cwd: dir, env: {}, settingsJsonPath: join(dir, 'nope.json'), routerPath: join(dir, 'nope-router.json') });
  assert.equal(r.endpoint, null);
  assert.equal(r.source, 'unconfigured');
});

test('fetchModelsDevCatalog: loads provider-agnostic Models.dev metadata', async () => {
  const catalog = await fetchModelsDevCatalog({
    fetchFn: async (url, options) => {
      assert.equal(url, 'https://models.dev/models.json');
      assert.equal(options.headers.Accept, 'application/json');
      return {
        ok: true,
        json: async () => ({
          'minimax/minimax-m3': {
            name: 'MiniMax M3',
            reasoning: true,
            tool_call: true,
            structured_output: true,
            limit: { context: 200000, output: 32000 },
            modalities: { input: ['text'], output: ['text'] },
          },
        }),
      };
    },
  });
  assert.equal(catalog['minimax/minimax-m3'].tool_call, true);
});

test('fetchModelsDevCatalog: rejects an unsuccessful metadata response', async () => {
  await assert.rejects(
    () => fetchModelsDevCatalog({
      fetchFn: async () => ({ ok: false, status: 503, statusText: 'Unavailable' }),
    }),
    /Models\.dev returned 503/,
  );
});

test('enrichModelsWithCapabilities: exact IDs receive capability profiles', () => {
  const candidates = [{ id: 'anthropic/claude-test', owned_by: 'anthropic' }];
  const catalog = {
    'anthropic/claude-test': {
      name: 'Claude Test',
      reasoning: true,
      tool_call: true,
      structured_output: true,
      limit: { context: 123000, input: 120000, output: 3000 },
      modalities: { input: ['text', 'image'], output: ['text'] },
      release_date: '2026-01-01',
    },
  };
  const [model] = enrichModelsWithCapabilities(candidates, catalog);
  assert.equal(model.profile.baseModel, 'anthropic/claude-test');
  assert.equal(model.profile.metadata.matchType, 'exact-id');
  assert.equal(model.profile.metadata.confidence, 0.9);
  assert.equal(model.profile.capabilities.toolCall, true);
  assert.deepEqual(model.profile.capabilities.inputModalities, ['text', 'image']);
  assert.equal(model.profile.limits.contextTokens, 123000);
  assert.equal(model.contextWindow, 123000, 'top-level contextWindow mirrors profile.limits.contextTokens');
});

test('enrichModelsWithCapabilities: unique gateway wrapper IDs are normalized', () => {
  const [model] = enrichModelsWithCapabilities(
    [{ id: 'claude-minimax/MiniMax-M3' }],
    {
      'minimax/minimax-m3': {
        name: 'MiniMax M3',
        reasoning: true,
        tool_call: true,
        limit: { context: 200000 },
        modalities: { input: ['text'], output: ['text'] },
      },
    },
  );
  assert.equal(model.profile.baseModel, 'minimax/minimax-m3');
  assert.equal(model.profile.metadata.matchType, 'unique-normalized-id');
  assert.equal(model.profile.metadata.confidence, 0.7);
  assert.equal(model.contextWindow, 200000);
});

test('enrichModelsWithCapabilities: MiniMax-M3 1M context window flows through contextWindow field', () => {
  // models.dev reports limit.context: 1048576 for MiniMax-M3. The new
  // contextWindow field must surface that exact value (1M), not a rounded
  // approximation, so applyModelPickerToSettings can map → [1m].
  const [model] = enrichModelsWithCapabilities(
    [{ id: 'claude-minimax/MiniMax-M3' }],
    {
      'minimax/MiniMax-M3': {
        name: 'MiniMax M3',
        reasoning: true,
        tool_call: true,
        limit: { context: 1048576, output: 512000 },
        modalities: { input: ['text'], output: ['text'] },
      },
    },
  );
  assert.equal(model.contextWindow, 1048576);
  assert.equal(model.profile.limits.contextTokens, 1048576);
});

test('enrichModelsWithCapabilities: ambiguous aliases remain unmatched', () => {
  const [model] = enrichModelsWithCapabilities(
    [{ id: 'gateway/shared-model' }],
    {
      'provider-a/shared-model': { name: 'A', tool_call: true },
      'provider-b/shared-model': { name: 'B', tool_call: false },
    },
  );
  assert.equal(model.profile, null);
  assert.equal(model.contextWindow, null);
});

test('applyModels: persists profiles only for selected models', () => {
  const dir = tmpDir();
  try {
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(routerPath, JSON.stringify({ version: '13.0.0' }));
    const block = applyModels({
      routerPath,
      models: ['a/one'],
      profiles: {
        'a/one': { baseModel: 'base/one', metadata: { source: 'models.dev' } },
        'b/two': { baseModel: 'base/two', metadata: { source: 'models.dev' } },
      },
    });
    assert.deepEqual(Object.keys(block.profiles), ['a/one']);
    const saved = JSON.parse(readFileSync(routerPath, 'utf8'));
    assert.equal(saved.userSelected.profiles['a/one'].baseModel, 'base/one');
    assert.equal(saved.userSelected.profiles['b/two'], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── F-185 / IMP-019 `bizar models explain` ────────────────────────────────

test('explainSelection: rejects missing role argument', () => {
  const dir = tmpDir();
  try {
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(routerPath, JSON.stringify({ version: '13.0.0' }));
    assert.throws(() => explainSelection({ routerPath }), /role is required/);
    assert.throws(() => explainSelection({ routerPath, role: '' }), /role is required/);
    assert.throws(() => explainSelection({ role: 'todd' }), /routerPath is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explainSelection: ranks 3 user-selected candidates by capability profile', () => {
  const dir = tmpDir();
  try {
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(routerPath, JSON.stringify({
      version: '13.0.0',
      userSelected: {
        models: ['claude-minimax/MiniMax-M3', 'claude-qwen/qwen3.8-max', 'claude/haiku-4-5'],
        tierHints: { 'claude-minimax/MiniMax-M3': 'default', 'claude-qwen/qwen3.8-max': 'premium', 'claude/haiku-4-5': 'high' },
        profiles: {
          'claude-minimax/MiniMax-M3': { capabilities: { reasoning: true, toolCall: true } },
          'claude-qwen/qwen3.8-max': { capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true, inputModalities: ['text', 'image'] } },
        },
      },
    }));
    const verdict = explainSelection({ routerPath, role: 'todd' });
    assert.deepEqual(verdict, {
      ranked: [
        { id: 'claude-qwen/qwen3.8-max', tier: 'premium', eligible: true, ineligibleReasons: [], capabilityScore: 1, hasProfile: true },
        { id: 'claude-minimax/MiniMax-M3', tier: 'default', eligible: true, ineligibleReasons: [], capabilityScore: 0.55, hasProfile: true },
        { id: 'claude/haiku-4-5', tier: 'high', eligible: true, ineligibleReasons: [], capabilityScore: 0, hasProfile: false },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explainSelection: empty userSelected returns empty ranked list', () => {
  const dir = tmpDir();
  try {
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(routerPath, JSON.stringify({ version: '13.0.0', userSelected: { models: [] } }));
    const verdict = explainSelection({ routerPath, role: 'todd' });
    assert.deepEqual(verdict, { ranked: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explainSelection: surfaces ineligibleReasons when requirements filter candidates', () => {
  const dir = tmpDir();
  try {
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(routerPath, JSON.stringify({
      version: '13.0.0',
      userSelected: {
        models: ['claude-minimax/MiniMax-M3', 'claude/haiku-4-5'],
        tierHints: { 'claude-minimax/MiniMax-M3': 'default', 'claude/haiku-4-5': 'high' },
        profiles: {
          'claude-minimax/MiniMax-M3': { capabilities: { reasoning: true }, limits: { contextTokens: 128000, inputTokens: null, outputTokens: null } },
          'claude/haiku-4-5': { capabilities: { reasoning: true }, limits: { contextTokens: 8000, inputTokens: null, outputTokens: null } },
        },
      },
    }));
    const verdict = explainSelection({ routerPath, role: 'karen', requirements: { minContextTokens: 32000 } });
    const haiku = verdict.ranked.find((entry) => entry.id === 'claude/haiku-4-5');
    assert.equal(haiku.eligible, false);
    assert.deepEqual(haiku.ineligibleReasons, ['contextTokens 8000 < required 32000']);
    const minimax = verdict.ranked.find((entry) => entry.id === 'claude-minimax/MiniMax-M3');
    assert.equal(minimax.eligible, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explainSelection: missing router file degrades to empty userSelected without crashing', () => {
  const dir = tmpDir();
  const routerPath = join(dir, 'does-not-exist.json');
  const verdict = explainSelection({ routerPath, role: 'todd' });
  assert.deepEqual(verdict, { ranked: [] });
  rmSync(dir, { recursive: true, force: true });
});

// ── 10.19.8 Phase 2: lazy Models.dev fetch deferral ───────────────────────

test('run(): interactive picker defers fetchModelsDevCatalog until after confirmation', async () => {
  // Phase 2 (10.19.8) regression: `bizar models` (interactive) used to call
  // `fetchModelsDevCatalog` BEFORE the picker opened, paying the round-trip
  // on every `bizar models --list` and `--set` invocation that never even
  // looked at the catalog. After Phase 2 the catalog fetch is gated behind
  // picker confirmation.
  //
  // We pin the order by feeding both hooks a monotonic counter and
  // asserting `pickerEnd <= catalogEnd` — i.e. the catalog fetch started
  // AFTER the picker returned.
  const dir = tmpDir();
  const order = [];
  let orderCounter = 0;

  const stubListModels = async () => {
    order.push({ step: 'listModels', n: ++orderCounter });
    // The injected listModels bypasses the real `normalizeModels`, so
    // we return the normalized candidate shape directly.
    return [
      { id: 'minimax/MiniMax-M3', owned_by: 'minimax', kind: 'minimax' },
      { id: 'codex/gpt-5.6-sol', owned_by: 'codex', kind: 'codex' },
    ];
  };

  const stubFetchModelsDevCatalog = async () => {
    order.push({ step: 'fetchModelsDevCatalog', n: ++orderCounter });
    return {
      'minimax/MiniMax-M3': {
        name: 'MiniMax M3',
        tool_call: true,
        limit: { context: 200000 },
      },
    };
  };

  const stubPickModels = async ({ candidates }) => {
    order.push({ step: 'pickModels:start', n: ++orderCounter });
    // Yield once so the event loop has a chance to schedule any work
    // the picker would have done — keeps the counter ordering honest.
    await new Promise((resolveP) => setImmediate(resolveP));
    order.push({ step: 'pickModels:end', n: ++orderCounter });
    return [candidates[0].id];
  };

  const prevRouterEnv = process.env.BIZAR_MODEL_ROUTER_CONFIG;
  const prevUrlEnv = process.env.BIZAR_MODEL_ROUTER_URL;
  const prevTokenEnv = process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    const routerPath = join(dir, 'model-router.json');
    writeFileSync(routerPath, JSON.stringify({ version: '13.0.0' }));
    process.env.BIZAR_MODEL_ROUTER_CONFIG = routerPath;
    process.env.BIZAR_MODEL_ROUTER_URL = 'http://stub-gw.invalid/v1';
    process.env.ANTHROPIC_AUTH_TOKEN = 'tok';
    await runModelsCommand('models', [], false, {
      listModels: stubListModels,
      pickModels: stubPickModels,
      fetchModelsDevCatalog: stubFetchModelsDevCatalog,
    });

    const listStep = order.find((e) => e.step === 'listModels');
    const pickerStart = order.find((e) => e.step === 'pickModels:start');
    const pickerEnd = order.find((e) => e.step === 'pickModels:end');
    const catalogStep = order.find((e) => e.step === 'fetchModelsDevCatalog');
    assert.ok(listStep, 'listModels was called');
    assert.ok(pickerStart, 'picker started');
    assert.ok(pickerEnd, 'picker ended');
    assert.ok(catalogStep, 'catalog fetch happened');

    // Phase 2 invariant: listModels runs first, picker runs second, and
    // the catalog fetch happens AFTER the picker returns. This is the
    // exact ordering that the deferred-fetch plan (10.19.8) requires.
    assert.ok(
      listStep.n < pickerStart.n,
      `listModels (n=${listStep.n}) must precede picker:start (n=${pickerStart.n})`,
    );
    assert.ok(
      pickerStart.n < pickerEnd.n,
      `picker:start (n=${pickerStart.n}) must precede picker:end (n=${pickerEnd.n})`,
    );
    assert.ok(
      pickerEnd.n < catalogStep.n,
      `catalog fetch (n=${catalogStep.n}) must run AFTER picker:end (n=${pickerEnd.n}) — that is the Phase 2 deferral`,
    );
  } finally {
    if (prevRouterEnv === undefined) delete process.env.BIZAR_MODEL_ROUTER_CONFIG;
    else process.env.BIZAR_MODEL_ROUTER_CONFIG = prevRouterEnv;
    if (prevUrlEnv === undefined) delete process.env.BIZAR_MODEL_ROUTER_URL;
    else process.env.BIZAR_MODEL_ROUTER_URL = prevUrlEnv;
    if (prevTokenEnv === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = prevTokenEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 10.19.9 Phase 3: post-confirm status screen ──────────────────────────────
//
// Five unit tests for renderPickStatusScreen / classifyPickStatus. Pin the
// per-row ✔ / ✖ / ⤳ contract, the non-TTY single-line collapse, and the
// exit-code propagation (0 when any ✔; 2 when every row is ✖). The
// subprocess coverage for `--json` status.perPick lives in
// cli/__tests__/models-namespace-sync.test.mjs.

test('renderPickStatusScreen: ✔ for every pick with profile.name', () => {
  // Fresh Models.dev profile → ✔. Two picks, both with metadata.source =
  // 'models.dev'. Assert two ✔ rows + a footer `2 passed, 0 failed, 0 skipped`.
  const out = makeOutput();
  const result = renderPickStatusScreen({
    picked: ['anthropic/claude-3-5-sonnet', 'minimax/MiniMax-M3'],
    profiles: {
      'anthropic/claude-3-5-sonnet': { name: 'Claude 3.5 Sonnet', metadata: { source: 'models.dev' } },
      'minimax/MiniMax-M3': { name: 'MiniMax M3', metadata: { source: 'models.dev' } },
    },
    preExisting: new Set(),
    out,
    isTTY: true,
  });
  const buf = out.buffer();
  // Per-row ✔ lines, one per picked id.
  assert.match(buf, /✔ anthropic\/claude-3-5-sonnet.*Claude 3\.5 Sonnet/);
  assert.match(buf, /✔ minimax\/MiniMax-M3.*MiniMax M3/);
  // Footer count line.
  assert.match(buf, /2 passed, 0 failed, 0 skipped/);
  // Returned totals + perPick shape.
  assert.deepEqual(result.totals, { passed: 2, failed: 0, skipped: 0 });
  assert.deepEqual(result.perPick, [
    { id: 'anthropic/claude-3-5-sonnet', status: 'fresh', hasProfile: true },
    { id: 'minimax/MiniMax-M3', status: 'fresh', hasProfile: true },
  ]);
  // Exit code 0 when at least one ✔.
  assert.equal(result.exitCode, 0);
});

test('renderPickStatusScreen: ✖ when profile === null AND no _gateway.name fallback', () => {
  // Unknown id with no profile, no _gateway.name → ✖. Assert the row
  // contains ✖ + the id, and the footer reads `0 passed, 1 failed, 0 skipped`.
  const out = makeOutput();
  const result = renderPickStatusScreen({
    picked: ['unknown/x'],
    profiles: {},
    preExisting: new Set(),
    out,
    isTTY: true,
  });
  const buf = out.buffer();
  assert.match(buf, /✖ unknown\/x/);
  assert.match(buf, /0 passed, 1 failed, 0 skipped/);
  assert.deepEqual(result.totals, { passed: 0, failed: 1, skipped: 0 });
  // Every row is ✖ → exit code 2.
  assert.equal(result.exitCode, 2);
  assert.equal(result.perPick[0].status, 'unavailable');
  assert.equal(result.perPick[0].hasProfile, false);
});

test('renderPickStatusScreen: ⤳ when pick already existed in userSelected.models', () => {
  // The preExisting Set captures userSelected.models BEFORE applyModels
  // overwrites the block. A re-confirmed pick is reported as ⤳ even when
  // its Phase 2 profile is fresh — preexisting always wins.
  const out = makeOutput();
  const result = renderPickStatusScreen({
    picked: ['a/1'],
    profiles: { 'a/1': { name: 'A', metadata: { source: 'models.dev' } } },
    preExisting: new Set(['a/1']),
    out,
    isTTY: true,
  });
  const buf = out.buffer();
  assert.match(buf, /⤳ a\/1/);
  assert.match(buf, /0 passed, 0 failed, 1 skipped/);
  assert.deepEqual(result.totals, { passed: 0, failed: 0, skipped: 1 });
  assert.equal(result.perPick[0].status, 'preexisting');
  assert.equal(result.perPick[0].hasProfile, true);
});

test('renderPickStatusScreen: non-TTY single-line collapse (no per-row output)', () => {
  // When stdout is piped (isTTY=false), the screen collapses to one line
  // appended to the existing "Saved" block. No ✔ rows leak into the pipe.
  const out = makeOutput();
  const result = renderPickStatusScreen({
    picked: ['anthropic/claude-3-5-sonnet', 'minimax/MiniMax-M3'],
    profiles: {
      'anthropic/claude-3-5-sonnet': { name: 'Claude 3.5 Sonnet', metadata: { source: 'models.dev' } },
      'minimax/MiniMax-M3': { name: 'MiniMax M3', metadata: { source: 'models.dev' } },
    },
    preExisting: new Set(),
    out,
    isTTY: false,
  });
  const buf = out.buffer();
  // Single collapsed line.
  assert.match(buf, /v 2 passed, 0 failed, 0 skipped/);
  // Zero per-row ✔ rows in the pipe.
  assert.equal(buf.match(/✔ /g), null, `non-TTY must not emit per-row ✔ lines; got: ${buf}`);
  // Returned data still has perPick + totals.
  assert.equal(result.perPick.length, 2);
  assert.deepEqual(result.totals, { passed: 2, failed: 0, skipped: 0 });
});

test('renderPickStatusScreen: exit code 0 when any ✔, exit code 2 when every row is ✖', () => {
  // Mixed pick: one fresh ✔, one ✖. The exit code is 0 (any ✔ wins).
  const mixedOut = makeOutput();
  const mixed = renderPickStatusScreen({
    picked: ['a/1', 'b/2'],
    profiles: { 'a/1': { name: 'A', metadata: { source: 'models.dev' } } },
    preExisting: new Set(),
    out: mixedOut,
    isTTY: true,
  });
  assert.equal(mixed.exitCode, 0, 'mixed ✔+✖ picks must exit 0 (any ✔ wins)');
  assert.deepEqual(mixed.totals, { passed: 1, failed: 1, skipped: 0 });

  // Every row is ✖ → exit code 2.
  const allFailOut = makeOutput();
  const allFail = renderPickStatusScreen({
    picked: ['x/1', 'y/2'],
    profiles: {},
    preExisting: new Set(),
    out: allFailOut,
    isTTY: true,
  });
  assert.equal(allFail.exitCode, 2, 'every row ✖ must exit 2');
  assert.deepEqual(allFail.totals, { passed: 0, failed: 2, skipped: 0 });

  // classifyPickStatus is the pure 4-state classifier the renderer
  // depends on. Pin each branch so future refactors can't silently
  // change the ✔/✖/⤳ mapping without breaking this test.
  assert.equal(classifyPickStatus('a/1', null, new Set()), 'unavailable');
  assert.equal(classifyPickStatus('a/1', { metadata: { source: 'models.dev' } }, new Set()), 'fresh');
  assert.equal(classifyPickStatus('a/1', { metadata: { source: 'gateway-fallback' } }, new Set()), 'refreshed');
  assert.equal(classifyPickStatus('a/1', { metadata: { source: 'models.dev' } }, new Set(['a/1'])), 'preexisting');
});
