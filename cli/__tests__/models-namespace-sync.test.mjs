/**
 * cli/__tests__/models-namespace-sync.test.mjs
 *
 * Regression tests for the 10.19.2 gateway-namespace alignment:
 *   - `partitionStalePicks` separates live picks from stale picks.
 *   - `applyModelOverrides` writes the self-map pattern, refuses to
 *     overwrite a corrupt settings.json, and skips when `null`.
 *   - `applyModels → applyModelOverrides` wiring survives a real
 *     filesystem round-trip (read-back of both files).
 *   - `bizar models --set id1,id2` syncs to a temp settings.json.
 *   - `classifyKind` recognizes the live provider namespace
 *     (`minimax/`, `codex/`, `glm/`, `qct/`, `openrouter/`, `a/`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyModels,
  applyModelOverrides,
  applyModelPicker,
  deriveModelLabel,
  enrichModelsWithCapabilities,
  loadRouter,
  normalizeModels,
  partitionStalePicks,
  classifyKind,
} from '../commands/models.mjs';

const CWD = process.cwd();
const BIN = join(CWD, 'cli', 'bin.mjs');

function makeCwd() {
  return mkdtempSync(join(tmpdir(), 'bizar-namespace-sync-'));
}

function tmpRouterPath(cwd) {
  return join(cwd, 'model-router.json');
}

function tmpSettingsPath(cwd) {
  return join(cwd, 'settings.json');
}

function writeBaseRouter(cwd) {
  const path = tmpRouterPath(cwd);
  writeFileSync(path, JSON.stringify({
    version: '13.0.0',
    endpoint: 'http://stub/v1',
    tiers: { premium: { models: ['qct/qwen3.8-max-preview'], purpose: 'x', effort: 'high' } },
    policies: { selectionOwner: 'orchestrator', discoveryFailure: 'inherit-session', unavailableModel: 'inherit-session', retryModelAliases: false, maxDispatchModelAttempts: 1 },
  }, null, 2));
  return path;
}

function runBizar(args, { cwd, env, timeoutMs = 15000 } = {}) {
  return new Promise((resolveP) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: { ...process.env, BIZAR_SKIP_BUILD: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolveP({ code: -1, stdout, stderr, killed: true });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolveP({ code, stdout, stderr });
    });
  });
}

// ── partitionStalePicks ────────────────────────────────────────────────────

test('partitionStalePicks: keeps live picks, drops stale, ignores unknowns when pool empty', () => {
  const live = ['minimax/MiniMax-M3', 'codex/gpt-5.6-sol', 'qct/qwen3.8-max-preview'];
  const picked = ['minimax/MiniMax-M3', 'a/1', 'qct/qwen3.8-max-preview', 'codex/gpt-5.6-sol'];
  const result = partitionStalePicks({ liveIds: live, pickedIds: picked });
  assert.deepEqual(result.liveIds.sort(), ['codex/gpt-5.6-sol', 'minimax/MiniMax-M3', 'qct/qwen3.8-max-preview'].sort());
  assert.deepEqual(result.staleIds, ['a/1']);
  assert.deepEqual(result.unknownIds, []);
});

test('partitionStalePicks: empty live pool marks every pick unknown (no false stale)', () => {
  const result = partitionStalePicks({ liveIds: [], pickedIds: ['minimax/MiniMax-M3', 'a/1'] });
  assert.deepEqual(result.liveIds, []);
  assert.deepEqual(result.staleIds, []);
  assert.deepEqual(result.unknownIds.sort(), ['a/1', 'minimax/MiniMax-M3'].sort());
});

test('partitionStalePicks: tolerates non-array inputs', () => {
  const result = partitionStalePicks({ liveIds: undefined, pickedIds: null });
  assert.deepEqual(result, { liveIds: [], staleIds: [], unknownIds: [] });
});

// ── applyModelOverrides ───────────────────────────────────────────────────

test('applyModelOverrides: writes self-map for live picks only', () => {
  const cwd = makeCwd();
  try {
    const settingsPath = tmpSettingsPath(cwd);
    writeFileSync(settingsPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'tok' } }, null, 2));
    const result = applyModelOverrides({
      settingsJsonPath: settingsPath,
      pickedIds: ['minimax/MiniMax-M3', 'a/1', 'codex/gpt-5.6-sol'],
      liveIds: ['minimax/MiniMax-M3', 'codex/gpt-5.6-sol'],
    });
    assert.equal(result.wrote, true);
    assert.deepEqual(result.syncedIds.sort(), ['codex/gpt-5.6-sol', 'minimax/MiniMax-M3'].sort());
    assert.deepEqual(result.skippedStale, ['a/1']);
    const back = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(back.env.ANTHROPIC_AUTH_TOKEN, 'tok'); // preserved
    assert.deepEqual(back.modelOverrides, {
      'minimax/MiniMax-M3': 'minimax/MiniMax-M3',
      'codex/gpt-5.6-sol': 'codex/gpt-5.6-sol',
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyModelOverrides: empty liveIds writes self-map for every pick (no false stale)', () => {
  const cwd = makeCwd();
  try {
    const settingsPath = tmpSettingsPath(cwd);
    const result = applyModelOverrides({
      settingsJsonPath: settingsPath,
      pickedIds: ['minimax/MiniMax-M3'],
      liveIds: [],
    });
    assert.equal(result.wrote, true);
    assert.deepEqual(result.syncedIds, ['minimax/MiniMax-M3']);
    assert.deepEqual(result.skippedStale, []);
    const back = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(back.modelOverrides['minimax/MiniMax-M3'], 'minimax/MiniMax-M3');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyModelOverrides: empty pickedIds clears modelOverrides', () => {
  const cwd = makeCwd();
  try {
    const settingsPath = tmpSettingsPath(cwd);
    writeFileSync(settingsPath, JSON.stringify({ modelOverrides: { 'minimax/MiniMax-M3': 'minimax/MiniMax-M3' } }, null, 2));
    const result = applyModelOverrides({ settingsJsonPath: settingsPath, pickedIds: [], liveIds: [] });
    assert.equal(result.wrote, true);
    assert.deepEqual(result.syncedIds, []);
    const back = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(back.modelOverrides, {});
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyModelOverrides: null path skips the sync entirely', () => {
  const result = applyModelOverrides({ settingsJsonPath: null, pickedIds: ['minimax/MiniMax-M3'], liveIds: ['minimax/MiniMax-M3'] });
  assert.equal(result.wrote, false);
  assert.equal(result.settingsPath, null);
});

test('applyModelOverrides: refuses to overwrite a corrupt settings.json', () => {
  const cwd = makeCwd();
  try {
    const settingsPath = tmpSettingsPath(cwd);
    writeFileSync(settingsPath, '{ this is not valid json');
    const result = applyModelOverrides({ settingsJsonPath: settingsPath, pickedIds: ['minimax/MiniMax-M3'], liveIds: ['minimax/MiniMax-M3'] });
    assert.equal(result.wrote, false);
    assert.equal(readFileSync(settingsPath, 'utf8'), '{ this is not valid json');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ── applyModels ↔ applyModelOverrides round-trip ─────────────────────────

test('applyModels then applyModelOverrides: round-trip survives both files', () => {
  const cwd = makeCwd();
  try {
    const routerPath = writeBaseRouter(cwd);
    const settingsPath = tmpSettingsPath(cwd);
    writeFileSync(settingsPath, '{}');
    const picks = ['minimax/MiniMax-M3', 'codex/gpt-5.6-sol'];
    applyModels({ routerPath, models: picks, source: 'live-pick' });
    applyModelOverrides({ settingsJsonPath: settingsPath, pickedIds: picks, liveIds: picks });
    const router = JSON.parse(readFileSync(routerPath, 'utf8'));
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(router.userSelected.models, picks);
    assert.deepEqual(settings.modelOverrides, {
      'minimax/MiniMax-M3': 'minimax/MiniMax-M3',
      'codex/gpt-5.6-sol': 'codex/gpt-5.6-sol',
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ── classifyKind (live namespace) ────────────────────────────────────────

test('classifyKind: recognises every live gateway prefix', () => {
  assert.equal(classifyKind('minimax/MiniMax-M3'), 'minimax');
  assert.equal(classifyKind('codex/gpt-5.6-sol'), 'codex');
  assert.equal(classifyKind('glm/glm-5.3-flash'), 'glm');
  assert.equal(classifyKind('qct/qwen3.8-max-preview'), 'qct');
  assert.equal(classifyKind('openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'), 'openrouter');
  assert.equal(classifyKind('a/1'), 'a');
});

test('classifyKind: still recognises legacy shipped prefixes', () => {
  assert.equal(classifyKind('claude-qwen/qwen3.8-max'), 'claude-qwen');
  assert.equal(classifyKind('claude-minimax/MiniMax-M3'), 'claude-minimax');
  assert.equal(classifyKind('cx/gpt-5.6-terra'), 'cx');
  assert.equal(classifyKind('anthropic/claude-3-5-sonnet'), 'anthropic');
  assert.equal(classifyKind('something/random'), 'other');
});

// ── subprocess: bizar models --set syncs to settings.json ────────────────

test('bizar models --set syncs picks to a temp settings.json', async () => {
  // The CLI unconditionally fetches the live gateway list at startup (for
  // both `--set` and the interactive picker). Stand up a tiny local server
  // that pretends to be OmniRoute so the subprocess can complete.
  const srv = createServer((req, res) => {
    if (req.url.startsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [
        { id: 'minimax/MiniMax-M3', owned_by: 'minimax' },
        { id: 'codex/gpt-5.6-sol', owned_by: 'codex' },
      ] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const cwd = makeCwd();
    try {
      const routerPath = writeBaseRouter(cwd);
      // applyModelOverrides() reads os.homedir() (which respects $HOME on
      // POSIX) and joins `.claude/settings.json`, so point HOME at the cwd
      // and write the test fixture at the resolved path.
      const settingsDir = join(cwd, '.claude');
      mkdirSync(settingsDir, { recursive: true });
      const settingsPath = join(settingsDir, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'tok' } }, null, 2));
      const { code, stderr } = await runBizar(
        ['models', '--set=minimax/MiniMax-M3,codex/gpt-5.6-sol'],
        {
          cwd,
          env: {
            BIZAR_MODEL_ROUTER_CONFIG: routerPath,
            HOME: cwd,
            BIZAR_HOME: cwd,
            BIZAR_MODEL_ROUTER_URL: `http://127.0.0.1:${port}`,
          },
        },
      );
      assert.equal(code, 0, `expected 0, got ${code}; stderr=${stderr}`);
      const back = JSON.parse(readFileSync(settingsPath, 'utf8'));
      assert.equal(back.modelOverrides['minimax/MiniMax-M3'], 'minimax/MiniMax-M3');
      assert.equal(back.modelOverrides['codex/gpt-5.6-sol'], 'codex/gpt-5.6-sol');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

// ── deriveModelLabel ─────────────────────────────────────────────────────

test('deriveModelLabel: drops the provider segment and joins word boundaries with spaces', () => {
  assert.equal(deriveModelLabel('minimax/MiniMax-M3'), 'MiniMax M3');
  assert.equal(deriveModelLabel('codex/gpt-5.6-sol'), 'gpt 5.6 sol');
  assert.equal(deriveModelLabel('qct/qwen3.8-max-preview'), 'qwen3.8 max preview');
  assert.equal(deriveModelLabel('openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'), 'nvidia nemotron 3 ultra 550b a55b free');
  assert.equal(deriveModelLabel('a/1'), '1');
});

test('deriveModelLabel: profile.name wins over the ID-derived fallback', () => {
  assert.equal(
    deriveModelLabel('minimax/MiniMax-M3', { name: 'MiniMax M3 (preview)' }),
    'MiniMax M3 (preview)',
  );
});

test('deriveModelLabel: empty / invalid input returns ""', () => {
  assert.equal(deriveModelLabel(''), '');
  assert.equal(deriveModelLabel(null), '');
  assert.equal(deriveModelLabel(undefined), '');
});

// ── applyModelPicker (10.19.3 — drives /model without gateway discovery) ─

test('applyModelPicker: writes modelPicker as {options:[{model,label}]}', () => {
  const cwd = makeCwd();
  try {
    const settingsPath = tmpSettingsPath(cwd);
    writeFileSync(settingsPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'tok' } }, null, 2));
    const result = applyModelPicker({
      settingsJsonPath: settingsPath,
      pickedIds: ['minimax/MiniMax-M3', 'codex/gpt-5.6-sol'],
      liveIds: ['minimax/MiniMax-M3', 'codex/gpt-5.6-sol'],
    });
    assert.equal(result.wrote, true);
    assert.deepEqual(result.options, [
      { model: 'minimax/MiniMax-M3', label: 'MiniMax M3' },
      { model: 'codex/gpt-5.6-sol', label: 'gpt 5.6 sol' },
    ]);
    const back = JSON.parse(readFileSync(settingsPath, 'utf8'));
    // Per Claude Code schema: modelPicker MUST be an object with `options`,
    // not a bare array — the runtime rejects top-level arrays.
    assert.deepEqual(back.modelPicker, { options: result.options });
    assert.equal(back.env.ANTHROPIC_AUTH_TOKEN, 'tok');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyModelPicker: filters out stale picks (live-only) and reports them', () => {
  const cwd = makeCwd();
  try {
    const settingsPath = tmpSettingsPath(cwd);
    writeFileSync(settingsPath, '{}');
    const result = applyModelPicker({
      settingsJsonPath: settingsPath,
      pickedIds: ['minimax/MiniMax-M3', 'a/1'],
      liveIds: ['minimax/MiniMax-M3'],
    });
    assert.deepEqual(result.options, [{ model: 'minimax/MiniMax-M3', label: 'MiniMax M3' }]);
    assert.deepEqual(result.skippedStale, ['a/1']);
    const back = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(back.modelPicker.options.length, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyModelPicker: empty picks writes {options:[]} (preserves the key)', () => {
  const cwd = makeCwd();
  try {
    const settingsPath = tmpSettingsPath(cwd);
    writeFileSync(settingsPath, JSON.stringify({ modelPicker: { options: [{ model: 'old', label: 'Old' }] } }, null, 2));
    const result = applyModelPicker({ settingsJsonPath: settingsPath, pickedIds: [], liveIds: [] });
    assert.equal(result.wrote, true);
    assert.deepEqual(result.options, []);
    const back = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(back.modelPicker, { options: [] });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyModelPicker: uses profile.name when present (gateway-reported display name)', () => {
  const cwd = makeCwd();
  try {
    const settingsPath = tmpSettingsPath(cwd);
    writeFileSync(settingsPath, '{}');
    const result = applyModelPicker({
      settingsJsonPath: settingsPath,
      pickedIds: ['minimax/MiniMax-M3', 'qct/qwen3.8-max-preview'],
      profiles: {
        'minimax/MiniMax-M3': { name: 'MiniMax M3 (operator)' },
        'qct/qwen3.8-max-preview': { name: 'Qwen3.8 Max Preview' },
      },
      liveIds: ['minimax/MiniMax-M3', 'qct/qwen3.8-max-preview'],
    });
    assert.deepEqual(result.options, [
      { model: 'minimax/MiniMax-M3', label: 'MiniMax M3 (operator)' },
      { model: 'qct/qwen3.8-max-preview', label: 'Qwen3.8 Max Preview' },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyModelPicker: surfaces profile.description when present', () => {
  const cwd = makeCwd();
  try {
    const settingsPath = tmpSettingsPath(cwd);
    writeFileSync(settingsPath, '{}');
    const result = applyModelPicker({
      settingsJsonPath: settingsPath,
      pickedIds: ['minimax/MiniMax-M3'],
      profiles: { 'minimax/MiniMax-M3': { description: 'Strongest reasoning on the gateway.' } },
      liveIds: ['minimax/MiniMax-M3'],
    });
    assert.equal(result.options[0].description, 'Strongest reasoning on the gateway.');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyModelPicker: null path skips the sync entirely', () => {
  const result = applyModelPicker({ settingsJsonPath: null, pickedIds: ['minimax/MiniMax-M3'], liveIds: [] });
  assert.equal(result.wrote, false);
  assert.equal(result.settingsPath, null);
});

test('applyModelPicker: refuses to overwrite a corrupt settings.json', () => {
  const cwd = makeCwd();
  try {
    const settingsPath = tmpSettingsPath(cwd);
    writeFileSync(settingsPath, '{ not valid json');
    const result = applyModelPicker({ settingsJsonPath: settingsPath, pickedIds: ['minimax/MiniMax-M3'], liveIds: ['minimax/MiniMax-M3'] });
    assert.equal(result.wrote, false);
    assert.equal(readFileSync(settingsPath, 'utf8'), '{ not valid json');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('bizar models --set populates modelPicker.options in settings.json', async () => {
  const srv = createServer((req, res) => {
    if (req.url.startsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [
        { id: 'minimax/MiniMax-M3', owned_by: 'minimax', name: 'MiniMax M3' },
        { id: 'codex/gpt-5.6-sol', owned_by: 'codex' },
      ] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const cwd = makeCwd();
    try {
      const routerPath = writeBaseRouter(cwd);
      const settingsDir = join(cwd, '.claude');
      mkdirSync(settingsDir, { recursive: true });
      const settingsPath = join(settingsDir, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'tok' } }, null, 2));
      const { code, stderr } = await runBizar(
        ['models', '--set=minimax/MiniMax-M3,codex/gpt-5.6-sol'],
        {
          cwd,
          env: {
            BIZAR_MODEL_ROUTER_CONFIG: routerPath,
            HOME: cwd,
            BIZAR_HOME: cwd,
            BIZAR_MODEL_ROUTER_URL: `http://127.0.0.1:${port}`,
          },
        },
      );
      assert.equal(code, 0, `expected 0, got ${code}; stderr=${stderr}`);
      const back = JSON.parse(readFileSync(settingsPath, 'utf8'));
      // The modelPicker MUST be an object with an `options` array, each
      // entry using `model` (not `id`) — Claude Code's schema rejects the
      // top-level array form.
      assert.deepEqual(back.modelPicker, {
        options: [
          { model: 'minimax/MiniMax-M3', label: 'MiniMax M3' },
          { model: 'codex/gpt-5.6-sol', label: 'gpt 5.6 sol' },
        ],
      });
      // Other settings.json fields are preserved.
      assert.equal(back.env.ANTHROPIC_AUTH_TOKEN, 'tok');
      // modelOverrides still carries the self-map for unrecognized_model
      // diagnostics.
      assert.equal(back.modelOverrides['minimax/MiniMax-M3'], 'minimax/MiniMax-M3');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

// ── Phase 1 (v10.19.7): _gateway plumbing ───────────────────────────────────

test('normalizeModels: preserves gateway name/display_name/description under _gateway', () => {
  const result = normalizeModels({
    data: [
      {
        id: 'anthropic/claude-3-5-sonnet',
        owned_by: 'anthropic',
        name: 'Claude 3.5 Sonnet',
        display_name: 'Sonnet 3.5',
        description: 'Helpful assistant',
      },
    ],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'anthropic/claude-3-5-sonnet');
  assert.equal(result[0].owned_by, 'anthropic');
  assert.equal(result[0]._gateway.name, 'Claude 3.5 Sonnet');
  assert.equal(result[0]._gateway.display_name, 'Sonnet 3.5');
  assert.equal(result[0]._gateway.description, 'Helpful assistant');
});

test('normalizeModels: omits _gateway sub-keys when gateway omits them', () => {
  const result = normalizeModels({
    data: [{ id: 'minimax/MiniMax-M3', owned_by: 'minimax' }],
  });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]._gateway, {});
  // No `name` / `display_name` / `description` keys leak into the candidate.
  assert.equal(result[0]._gateway.name, undefined);
  assert.equal(result[0]._gateway.display_name, undefined);
  assert.equal(result[0]._gateway.description, undefined);
});

test('normalizeModels: does not persist _gateway into userSelected on round-trip', () => {
  // `_gateway` is in-memory only. Build a router with `userSelected` plus
  // a non-empty `_gateway` candidate pool, normalize it, write through
  // `applyModels`, read it back via `loadRouter`, and assert no `_gateway`
  // key on the persisted profile. This pins the schema-migration boundary
  // so `applyModels` cannot accidentally start serializing the new field.
  const cwd = makeCwd();
  try {
    const routerPath = tmpRouterPath(cwd);
    writeFileSync(routerPath, JSON.stringify({
      version: '13.0.0',
      endpoint: 'http://stub/v1',
      tiers: [],
      userSelected: { models: ['anthropic/claude-3-5-sonnet'] },
    }, null, 2));

    // Normalize a candidate pool with rich gateway metadata.
    const normalized = normalizeModels({
      data: [
        {
          id: 'anthropic/claude-3-5-sonnet',
          owned_by: 'anthropic',
          name: 'Claude 3.5 Sonnet',
          description: 'Helpful assistant',
        },
      ],
    });
    assert.equal(normalized[0]._gateway.name, 'Claude 3.5 Sonnet');
    assert.equal(normalized[0]._gateway.description, 'Helpful assistant');

    // Round-trip: write through applyModels and read back.
    applyModels({
      routerPath,
      models: ['anthropic/claude-3-5-sonnet'],
      profiles: {},
      source: 'test',
    });
    const loaded = loadRouter(routerPath);
    const persistedProfile = loaded.profiles?.['anthropic/claude-3-5-sonnet'] || null;
    if (persistedProfile) {
      assert.equal(persistedProfile._gateway, undefined,
        'persisted profile must NOT carry _gateway');
    }
    for (const id of (loaded.userSelected?.models || [])) {
      assert.equal(typeof id, 'string',
        `userSelected.models entries must be plain ids, got ${typeof id}`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('enrichModelsWithCapabilities: promotes _gateway.name into profile.name on Models.dev miss', () => {
  // Phase 1 plumbing — when Models.dev has no row, the gateway-supplied
  // `_gateway.name` becomes `profile.name` so the picker row renderer can
  // read a label without dereferencing `_gateway` directly.
  const candidates = [
    { id: 'anthropic/claude-3-5-haiku', _gateway: { name: 'Claude 3.5 Haiku' } },
  ];
  const [out] = enrichModelsWithCapabilities(candidates, {});
  assert.ok(out.profile, 'Models.dev miss with _gateway data must build a profile');
  assert.equal(out.profile.name, 'Claude 3.5 Haiku');
  assert.equal(out.profile.description, null); // gateway didn't have description either
  assert.equal(out.profile.metadata.source, 'gateway-fallback');
});
