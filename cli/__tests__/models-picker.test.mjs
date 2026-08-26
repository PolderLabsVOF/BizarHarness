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
  pickModels,
  applyModels,
  defaultTierHint,
  resolveEndpoint,
  resolveRouterPath,
  currentSelection,
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
    writeFileSync(settingsPath, JSON.stringify({
      env: { BIZAR_MODEL_ROUTER_URL: 'https://settings.example/v1' },
    }));
    mkdirSync(join(dir, 'config', 'claude'), { recursive: true });
    writeFileSync(join(dir, 'config', 'claude', 'model-router.json'), JSON.stringify({ endpoint: 'https://router.example/v1' }));
    const r = resolveEndpoint({ cwd: dir, env: {}, settingsJsonPath: settingsPath });
    assert.equal(r.endpoint, 'https://settings.example/v1');
    assert.equal(r.source, 'settings.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveEndpoint: router.json wins over default', () => {
  const dir = tmpDir();
  try {
    // resolveEndpoint reads `config/claude/model-router.json` relative to cwd.
    mkdirSync(join(dir, 'config', 'claude'), { recursive: true });
    writeFileSync(join(dir, 'config', 'claude', 'model-router.json'), JSON.stringify({ endpoint: 'https://router.example/v1' }));
    const r = resolveEndpoint({ cwd: dir, env: {}, settingsJsonPath: join(dir, 'nope.json') });
    assert.equal(r.endpoint, 'https://router.example/v1');
    assert.equal(r.source, 'model-router.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveEndpoint: falls back to localhost default', () => {
  const dir = tmpDir();
  const r = resolveEndpoint({ cwd: dir, env: {}, settingsJsonPath: join(dir, 'nope.json') });
  assert.equal(r.endpoint, 'http://localhost:20128/v1');
  assert.equal(r.source, 'default');
});