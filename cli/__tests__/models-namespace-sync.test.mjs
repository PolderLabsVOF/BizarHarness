/**
 * cli/__tests__/models-namespace-sync.test.mjs
 *
 * Regression tests for the 10.19.2 gateway-namespace alignment:
 *   - `partitionStalePicks` separates live picks from stale picks.
 *   - `applyModelOverrides` writes recognized-key gateway mappings, refuses to
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
  buildClaudeModelOverrides,
  modelAgentName,
  syncGeneratedModelAgents,
  requiresGatewayModelDiscovery,
  configuredFallbackModels,
  currentSelection,
} from '../commands/models.mjs';

test('custom gateway picks populate standard Claude override keys for alias compatibility', () => {
  const overrides = buildClaudeModelOverrides(['glm/glm-5.3', 'codex/gpt-5.6', 'minimax/MiniMax-M3']);
  assert.equal(overrides['claude-sonnet-5'], 'glm/glm-5.3');
  assert.equal(overrides['claude-opus-5'], 'codex/gpt-5.6');
  assert.equal(overrides['claude-haiku-4-5-20251001'], 'minimax/MiniMax-M3');
  assert.equal(overrides['claude-fable-5'], 'glm/glm-5.3');
});

test('generated model agents use a Claude-safe name and preserve the full gateway ID in frontmatter', () => {
  const cwd = makeCwd();
  try {
    const agentsDir = join(cwd, 'agents', 'bizar-models');
    const id = 'codex/gpt-5.6-sol';
    const name = modelAgentName(id);
    assert.match(name, /^[a-z-]+$/);
    const result = syncGeneratedModelAgents([id], { agentsDir });
    assert.deepEqual(result.names, [name]);
    const definition = readFileSync(join(agentsDir, `${name}.md`), 'utf8');
    assert.match(definition, new RegExp(`model: ${id.replace(/[./-]/g, '\\$&')}`));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

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

test('requiresGatewayModelDiscovery distinguishes custom gateway IDs', () => {
  assert.equal(requiresGatewayModelDiscovery(['cx/gpt-5.6-luna']), true);
  assert.equal(requiresGatewayModelDiscovery(['minimax/MiniMax-M3']), true);
  assert.equal(requiresGatewayModelDiscovery(['claude-sonnet-4-6']), false);
  assert.equal(requiresGatewayModelDiscovery(['anthropic/claude-opus']), false);
});

// ── applyModelOverrides ───────────────────────────────────────────────────

test('applyModelOverrides: writes recognized-key mappings for live picks only', () => {
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
    assert.equal(back.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
    assert.deepEqual(back.modelOverrides, buildClaudeModelOverrides([
      'minimax/MiniMax-M3', 'codex/gpt-5.6-sol',
    ]));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyModelOverrides: empty liveIds maps every pick (no false stale)', () => {
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
    assert.ok(Object.values(back.modelOverrides).includes('minimax/MiniMax-M3'));
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

test('applyModelOverrides: switches managed context tokens and clears them when metadata is unavailable', () => {
  const cwd = makeCwd();
  try {
    const settingsPath = tmpSettingsPath(cwd);
    const profiles = {
      'provider/large': { limits: { contextTokens: 1_000_000 } },
      'provider/small': { limits: { contextTokens: 200_000 } },
    };
    writeFileSync(settingsPath, JSON.stringify({
      model: 'provider/large',
      env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '1000000' },
    }));

    applyModelOverrides({ settingsJsonPath: settingsPath, pickedIds: ['provider/small'], profiles });
    let back = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(back.model, 'provider/small');
    assert.equal(back.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '200000');

    applyModelOverrides({ settingsJsonPath: settingsPath, pickedIds: ['provider/unknown'], profiles });
    back = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(back.model, 'provider/unknown');
    assert.deepEqual(back.env, {
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'provider/unknown',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'provider/unknown',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'provider/unknown',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'provider/unknown',
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('applyModelOverrides: preserves an explicit operator context override', () => {
  const cwd = makeCwd();
  try {
    const settingsPath = tmpSettingsPath(cwd);
    const profiles = {
      'provider/large': { limits: { contextTokens: 1_000_000 } },
      'provider/small': { limits: { contextTokens: 200_000 } },
    };
    writeFileSync(settingsPath, JSON.stringify({
      model: 'provider/large',
      env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '777777' },
    }));
    applyModelOverrides({ settingsJsonPath: settingsPath, pickedIds: ['provider/small'], profiles });
    const back = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(back.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '777777');
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
    assert.deepEqual(settings.modelOverrides, buildClaudeModelOverrides(picks));
    assert.equal(settings.model, picks[0]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('configuredFallbackModels filters disabled providers and preserves tier order', () => {
  assert.deepEqual(configuredFallbackModels({
    disabledProviders: ['anthropic/'],
    tiers: { budget: { models: ['anthropic/a', 'provider/cheap'] }, default: { models: ['provider/main'] } },
  }), ['provider/cheap', 'provider/main']);
});

test('configuredEnabledModels prefers explicit global picks and falls back to tiers', async () => {
  const { configuredEnabledModels } = await import('../commands/models.mjs');
  assert.deepEqual(configuredEnabledModels({
    disabledProviders: ['anthropic/'],
    userSelected: { models: ['anthropic/opus', 'provider/picked'] },
    tiers: { default: { models: ['provider/fallback'] } },
  }), ['provider/picked']);
  assert.deepEqual(configuredEnabledModels({
    userSelected: { models: [] },
    tiers: { default: { models: ['provider/fallback'] } },
  }), ['provider/fallback']);
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
      assert.deepEqual(back.modelOverrides, buildClaudeModelOverrides([
        'minimax/MiniMax-M3', 'codex/gpt-5.6-sol',
      ]));
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
      // modelOverrides carries a recognized-key mapping for diagnostic suppression.
      assert.ok(Object.values(back.modelOverrides).includes('minimax/MiniMax-M3'));
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

// ── 10.19.8 Phase 2: subprocess proves --list skips the catalog fetch ─────

test('bizar models --list does NOT contact models.dev', async () => {
  // Phase 2 (10.19.8) regression: `bizar models --list` used to call
  // `fetchModelsDevCatalog` BEFORE any flag was inspected, paying the
  // round-trip on every `--list` and `--set`. After Phase 2 the catalog
  // fetch is gated behind picker confirmation; `--list` (and `--set`)
  // must skip the fetch entirely.
  //
  // Strategy: spin up a stub gateway AND a stub models.dev server. The
  // models.dev server records every hit (count via a side-channel file).
  // Run `bizar models --list`; assert exit 0 and that the models.dev
  // hit-count remains 0.
  const { writeFileSync, readFileSync } = await import('node:fs');

  const stubDir = mkdtempSync(join(tmpdir(), 'bizar-models-list-'));
  const counterPath = join(stubDir, 'models-dev-hits.txt');
  writeFileSync(counterPath, '0');

  let gwHits = 0;
  let mdHits = 0;
  const gwSrv = createServer((req, res) => {
    if (req.url.startsWith('/models')) {
      gwHits += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [
        { id: 'minimax/MiniMax-M3', owned_by: 'minimax' },
        { id: 'codex/gpt-5.6-sol', owned_by: 'codex' },
      ] }));
      return;
    }
    res.writeHead(404).end();
  });
  const mdSrv = createServer((req, res) => {
    // Any contact with models.dev is a Phase 2 regression. Record the hit
    // and serve an empty catalog so we don't accidentally pass-by luck.
    mdHits += 1;
    try {
      const current = parseInt(readFileSync(counterPath, 'utf8').trim() || '0', 10);
      writeFileSync(counterPath, String(current + 1));
    } catch {
      /* counter file IO is best-effort; the in-process mdHits counter
         below is the authoritative measurement. */
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await Promise.all([
    new Promise((r) => gwSrv.listen(0, '127.0.0.1', r)),
    new Promise((r) => mdSrv.listen(0, '127.0.0.1', r)),
  ]);
  const gwPort = gwSrv.address().port;
  const mdPort = mdSrv.address().port;
  try {
    const cwd = makeCwd();
    try {
      const routerPath = writeBaseRouter(cwd);
      const { code, stdout, stderr } = await runBizar(
        ['models', '--list'],
        {
          cwd,
          env: {
            BIZAR_MODEL_ROUTER_CONFIG: routerPath,
            HOME: cwd,
            BIZAR_HOME: cwd,
            BIZAR_MODEL_ROUTER_URL: `http://127.0.0.1:${gwPort}`,
            // Point fetchModelsDevCatalog at the stub models.dev server
            // so any contact with it is observable.
            BIZAR_MODELS_DEV_URL: `http://127.0.0.1:${mdPort}/models.json`,
          },
        },
      );
      assert.equal(code, 0, `expected 0, got ${code}; stderr=${stderr}; stdout=${stdout}`);
      // Gateway must have been hit (Phase 2 still calls listModels for --list).
      assert.ok(gwHits >= 1, `gateway /models must be hit for --list (got ${gwHits})`);
      // Models.dev must NOT have been hit (Phase 2 defers the fetch past
      // the picker; --list never opens a picker).
      assert.equal(mdHits, 0, `models.dev must NOT be contacted for --list (got ${mdHits} hits)`);
      assert.equal(
        parseInt(readFileSync(counterPath, 'utf8').trim() || '0', 10),
        0,
        'counter file shows zero models.dev hits',
      );
      // --list still prints the candidate IDs from the gateway stub.
      assert.match(stdout, /minimax\/MiniMax-M3/);
      assert.match(stdout, /codex\/gpt-5\.6-sol/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  } finally {
    await Promise.all([
      new Promise((r) => gwSrv.close(r)),
      new Promise((r) => mdSrv.close(r)),
    ]);
    try { rmSync(stubDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ── 10.19.9 Phase 3: subprocess proves interactive --json exposes status.* ─

test('bizar models --json exposes status.perPick and status.totals after interactive pick', async () => {
  // The interactive --json envelope carries the new `status` block from
  // `renderPickStatusScreen`. To exercise the interactive path inside a
  // subprocess, spawn a tiny Node wrapper that stubs `process.stdin.isTTY`
  // and the test-injection surface (`deps.listModels`, `deps.pickModels`,
  // `deps.fetchModelsDevCatalog`) BEFORE requiring the CLI. The wrapper
  // then calls `run('models', ['--json'], false, deps)` so the same code
  // path the interactive picker takes produces the JSON envelope.
  //
  // This is a real subprocess (child_process.spawn), so it exercises the
  // full module-load → run() → JSON write path that production goes
  // through. The only stubbed parts are the network fetches (gateway +
  // Models.dev) and the interactive picker, all of which are gated by
  // the existing test-injection contract from Phase 2 (10.19.8).
  const stubDir = mkdtempSync(join(tmpdir(), 'bizar-phase3-'));
  const wrapperPath = join(stubDir, 'phase3-wrapper.mjs');
  const modelsModulePath = join(CWD, 'cli', 'commands', 'models.mjs');
  // The Models.dev catalog stub matches the shape `flattenModelsDevCatalog`
  // expects: top-level provider keys → nested `models` map → per-model
  // metadata. Phase 2's enrichPicksByMetadata uses this to populate
  // `profile.metadata.source === 'models.dev'` for the picked id.
  writeFileSync(wrapperPath, `
import { run } from ${JSON.stringify(modelsModulePath)};

// Stub isTTY + raw mode BEFORE the CLI reads process.stdin. The CLI's
// interactive branch runs when process.stdin.isTTY === true OR
// deps.pickModels is set; we set both so the test is robust to either
// order of guards. process.stdin.setRawMode is a no-op so the picker
// falls back to line mode and never reads from this stub stdin.
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
Object.defineProperty(process.stdin, 'setRawMode', { value: () => true, configurable: true });
Object.defineProperty(process.stdin, 'resume', { value: () => {}, configurable: true });
Object.defineProperty(process.stdin, 'pause', { value: () => {}, configurable: true });
Object.defineProperty(process.stdin, 'setEncoding', { value: () => {}, configurable: true });
Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

const deps = {
  // listModels: 1-candidate stub. The "live gateway" is replaced with a
  // static list so the subprocess can complete without a real fetch.
  listModels: async () => ([
    { id: 'minimax/MiniMax-M3', owned_by: 'minimax', name: 'MiniMax M3' },
  ]),
  // pickModels: confirm every candidate (no TTY). The renderer's
  // preExisting Set is empty, so every picked id is 'fresh' (✔).
  pickModels: async ({ candidates }) => candidates.map((c) => c.id),
  // fetchModelsDevCatalog: stub the wholesale catalog fetch so the
  // per-id enrichment in Phase 2's enrichPicksByMetadata succeeds.
  fetchModelsDevCatalog: async () => ({
    minimax: {
      id: 'minimax',
      name: 'minimax',
      models: {
        'MiniMax-M3': {
          id: 'MiniMax-M3',
          name: 'MiniMax M3',
          family: 'm3',
          tool_call: true,
          limit: { context: 200000, output: 8192 },
        },
      },
    },
  }),
};

await run('models', ['--json'], false, deps);
`);

  const cwd = makeCwd();
  try {
    const routerPath = writeBaseRouter(cwd);
    const settingsDir = join(cwd, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'tok' } }, null, 2));

    // Spawn the wrapper directly. runBizar runs `cli/bin.mjs`; the wrapper
    // is its own entry point that calls run() with stubs.
    const result = await new Promise((resolveP) => {
      const child = spawn(process.execPath, [wrapperPath], {
        cwd,
        env: {
          ...process.env,
          BIZAR_SKIP_BUILD: '1',
          BIZAR_MODEL_ROUTER_CONFIG: routerPath,
          HOME: cwd,
          BIZAR_HOME: cwd,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += String(d); });
      child.stderr.on('data', (d) => { err += String(d); });
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        resolveP({ code: -1, stdout: out, stderr: err, killed: true });
      }, 15000);
      child.on('exit', (c) => { clearTimeout(timer); resolveP({ code: c, stdout: out, stderr: err }); });
    });
    const { code, stdout, stderr } = result;
    assert.equal(code, 0, `expected 0, got ${code}; stderr=${stderr}; stdout=${stdout}`);

    // Parse the JSON envelope and verify the new `status` block is present.
    const jsonStart = stdout.indexOf('{');
    assert.notEqual(jsonStart, -1, `expected JSON envelope in stdout, got: ${stdout.slice(0, 200)}`);
    const envelope = JSON.parse(stdout.slice(jsonStart));
    assert.ok(envelope.status, `expected envelope.status to be set, got keys: ${Object.keys(envelope)}`);
    assert.ok(Array.isArray(envelope.status.perPick), `expected status.perPick to be an array, got ${typeof envelope.status.perPick}`);
    assert.equal(envelope.status.perPick.length, 1, `expected 1 picked id, got ${envelope.status.perPick.length}`);
    assert.equal(envelope.status.perPick[0].id, 'minimax/MiniMax-M3');
    assert.equal(envelope.status.perPick[0].status, 'fresh', `expected fresh ✔, got: ${envelope.status.perPick[0].status}`);
    assert.equal(envelope.status.perPick[0].hasProfile, true);
    assert.deepEqual(envelope.status.totals, { passed: 1, failed: 0, skipped: 0 });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test('bizar models --json exits 2 when every pick is unavailable', async () => {
  // Linda's exit-code propagation regression: previously, run() called
  // renderPickStatusScreen but discarded its exitCode, so the all-✖
  // case exited 0 instead of the documented 2. This test pins the fix:
  // every picked id must produce exitCode=2 from the renderer, and the
  // subprocess (which exercises the real process.exitCode wire-in) must
  // exit with code 2. The JSON envelope must also expose exitCode so
  // machine consumers can read it without inspecting the process exit.
  const stubDir = mkdtempSync(join(tmpdir(), 'bizar-phase3-exit-'));
  const wrapperPath = join(stubDir, 'phase3-exit-wrapper.mjs');
  const modelsModulePath = join(CWD, 'cli', 'commands', 'models.mjs');
  writeFileSync(wrapperPath, `
import { run } from ${JSON.stringify(modelsModulePath)};

Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
Object.defineProperty(process.stdin, 'setRawMode', { value: () => true, configurable: true });
Object.defineProperty(process.stdin, 'resume', { value: () => {}, configurable: true });
Object.defineProperty(process.stdin, 'pause', { value: () => {}, configurable: true });
Object.defineProperty(process.stdin, 'setEncoding', { value: () => {}, configurable: true });
Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

const deps = {
  // Candidate id 'no-such/no-model-9000' has no Models.dev profile: the
  // catalog below does not contain a 'no-such' provider. Phase 2's
  // enrichPicksByMetadata will leave it without a profile, so
  // classifyPickStatus reports 'unavailable' (✖) for every pick.
  listModels: async () => ([
    { id: 'no-such/no-model-9000', owned_by: 'no-such', name: 'No Such Model 9000' },
  ]),
  // pickModels: confirm the only candidate. The id is not in profilesMap
  // (no gateway namespace entry) and not in the Models.dev catalog stub,
  // so every picked id becomes a ✖ row.
  pickModels: async ({ candidates }) => candidates.map((c) => c.id),
  // fetchModelsDevCatalog: stub a catalog that does NOT contain the picked
  // id. 'no-such' is absent; only the unrelated 'minimax' provider exists.
  fetchModelsDevCatalog: async () => ({
    minimax: {
      id: 'minimax',
      name: 'minimax',
      models: {
        'MiniMax-M3': {
          id: 'MiniMax-M3',
          name: 'MiniMax M3',
          family: 'm3',
          tool_call: true,
          limit: { context: 200000, output: 8192 },
        },
      },
    },
  }),
};

await run('models', ['--json'], false, deps);
`);

  const cwd = makeCwd();
  try {
    const routerPath = writeBaseRouter(cwd);
    const settingsDir = join(cwd, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'tok' } }, null, 2));

    const result = await new Promise((resolveP) => {
      const child = spawn(process.execPath, [wrapperPath], {
        cwd,
        env: {
          ...process.env,
          BIZAR_SKIP_BUILD: '1',
          BIZAR_MODEL_ROUTER_CONFIG: routerPath,
          HOME: cwd,
          BIZAR_HOME: cwd,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += String(d); });
      child.stderr.on('data', (d) => { err += String(d); });
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        resolveP({ code: -1, stdout: out, stderr: err, killed: true });
      }, 15000);
      child.on('exit', (c) => { clearTimeout(timer); resolveP({ code: c, stdout: out, stderr: err }); });
    });
    const { code, stdout, stderr } = result;
    assert.equal(code, 2, `expected exit code 2 when every pick is unavailable, got ${code}; stderr=${stderr}; stdout=${stdout}`);

    // The JSON envelope must also expose exitCode so machine consumers can
    // read it without inspecting the process exit status. Parse and pin it.
    const jsonStart = stdout.indexOf('{');
    assert.notEqual(jsonStart, -1, `expected JSON envelope in stdout, got: ${stdout.slice(0, 200)}`);
    const envelope = JSON.parse(stdout.slice(jsonStart));
    assert.ok(envelope.status, `expected envelope.status to be set, got keys: ${Object.keys(envelope)}`);
    assert.equal(envelope.status.exitCode, 2, `expected envelope.status.exitCode to be 2, got ${envelope.status.exitCode}`);
    assert.equal(envelope.status.perPick.length, 1);
    assert.equal(envelope.status.perPick[0].status, 'unavailable', `expected unavailable ✖, got: ${envelope.status.perPick[0].status}`);
    assert.equal(envelope.status.perPick[0].hasProfile, false);
    assert.deepEqual(envelope.status.totals, { passed: 0, failed: 1, skipped: 0 });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

// ── 10.22.0 / Phase 4: disabled-providers filter contract ──────────────

test('applyModelOverrides: skippedDisabled is reported and disabled ids never sync', () => {
  // The recognized-key mapping writes {<claude-id>:<gateway-id>}. Operators with
  // `disabledProviders: ["anthropic"]` must NEVER see an
  // an `anthropic/*` override value in settings.json — the
  // skippedDisabled array carries the dropped ids back so the CLI
  // can surface them in the interactive summary.
  const cwd = makeCwd();
  try {
    const routerPath = writeBaseRouter(cwd);
    const settingsJsonPath = tmpSettingsPath(cwd);
    writeFileSync(settingsJsonPath, JSON.stringify({}));
    const result = applyModelOverrides({
      settingsJsonPath,
      pickedIds: ['anthropic/claude-3-5-sonnet', 'claude-minimax/MiniMax-M3'],
      liveIds: ['anthropic/claude-3-5-sonnet', 'claude-minimax/MiniMax-M3'],
      disabledProviders: ['anthropic'],
    });
    assert.deepEqual(result.syncedIds, ['claude-minimax/MiniMax-M3']);
    assert.deepEqual(result.skippedDisabled, ['anthropic/claude-3-5-sonnet']);
    // The settings.json must contain ONLY the surviving gateway value.
    const after = JSON.parse(readFileSync(settingsJsonPath, 'utf8'));
    assert.deepEqual(after.modelOverrides, buildClaudeModelOverrides(['claude-minimax/MiniMax-M3']));
    assert.ok(!Object.values(after.modelOverrides).includes('anthropic/claude-3-5-sonnet'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('partitionStalePicks: disabled ids are not in live pool OR stale list', () => {
  // Disabled ids must not surface as "stale" either — they were never
  // the operator's intent once the disable list landed.
  const result = partitionStalePicks({
    liveIds: ['claude-minimax/MiniMax-M3', 'anthropic/claude-3-5-sonnet'],
    pickedIds: ['claude-minimax/MiniMax-M3', 'anthropic/claude-3-5-sonnet', 'anthropic/claude-opus-4'],
    disabledProviders: ['anthropic'],
  });
  assert.deepEqual(result.liveIds, ['claude-minimax/MiniMax-M3']);
  // The disabled `anthropic/claude-opus-4` is dropped entirely — it is
  // neither live nor stale.
  assert.deepEqual(result.staleIds, []);
});

test('currentSelection: disabled ids already persisted in userSelected are stripped on read', () => {
  // Even when the router file already has `anthropic/*` ids in
  // `userSelected.models` from a prior run, every read site honours the
  // current disable list — the operator's disable intent overrides
  // history.
  const router = {
    userSelected: {
      models: ['anthropic/claude-3-5-sonnet', 'claude-minimax/MiniMax-M3'],
      tierHints: { 'claude-minimax/MiniMax-M3': 'default' },
    },
  };
  const result = currentSelection(router, { disabledProviders: ['anthropic'] });
  assert.deepEqual(result.models, ['claude-minimax/MiniMax-M3']);
  // tierHints keys for disabled ids are NOT carried over (no orphan hints).
  assert.deepEqual(result.tierHints, { 'claude-minimax/MiniMax-M3': 'default' });
});
