#!/usr/bin/env node
/**
 * .claude/hooks/__tests__/sessionstart-model-sync.test.mjs
 *
 * Unit tests for sessionstart-model-sync.mjs — the SessionStart hook that
 * re-applies the operator's `userSelected.models` block into
 * `~/.claude/settings.json` so the `/model` picker survives Claude Code's
 * between-session rewrites.
 *
 * Strategy: spawn the hook binary as a subprocess with HOME redirected at
 * a temp stage directory and `BIZAR_MODEL_ROUTER_CONFIG` pointing at a
 * staged router file. Feed it stdin JSON, then assert on stdout JSON and
 * the post-run state of the staged settings.json. This avoids drift
 * between test and source — what the binary emits IS what the tests check.
 *
 * The hook never touches the real operator settings.json during tests.
 */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '..', 'sessionstart-model-sync.mjs');

function makeStage() {
  const dir = join(tmpdir(), `bizar-model-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const routerPath = join(dir, 'router.json');
  const settingsDir = join(dir, '.claude');
  mkdirSync(settingsDir, { recursive: true });
  const settingsPath = join(settingsDir, 'settings.json');
  return { dir, routerPath, settingsDir, settingsPath };
}

function runHook(inputJson, env) {
  const r = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(inputJson || {}),
    encoding: 'utf8',
    env: { ...process.env, ...(env || {}) },
    timeout: 8000,
  });
  return {
    status: r.status,
    stdout: r.stdout.trim(),
    stderr: r.stderr.trim(),
  };
}

function parseStdout(stdout) {
  if (!stdout) return null;
  try { return JSON.parse(stdout); } catch { return null; }
}

function additionalContext(stdout) {
  const obj = parseStdout(stdout);
  return obj && obj.hookSpecificOutput && obj.hookSpecificOutput.additionalContext ? obj.hookSpecificOutput.additionalContext : '';
}

test('model-sync: reapplies modelPicker + modelOverrides + resets dead claude- model', () => {
  const stage = makeStage();
  try {
    writeFileSync(stage.routerPath, JSON.stringify({
      userSelected: {
        models: [
          'codex/gpt-5.6-sol',
          'minimax/MiniMax-M3',
          'qct/qwen3.8-max-preview',
        ],
        profiles: {
          'minimax/MiniMax-M3': {
            name: 'MiniMax M3',
            description: 'Default model',
          },
        },
      },
    }));
    // Pre-stage settings.json with the broken post-`/model` state.
    writeFileSync(stage.settingsPath, JSON.stringify({
      model: 'claude-minimax/MiniMax-M3[1m]',
      modelOverrides: { 'claude-minimax/MiniMax-M3': 'claude-minimax/MiniMax-M3' },
      env: { BIZAR_HOME: '/tmp/test-bizar' },
      mcpServers: { foo: { command: 'foo', args: [] } },
      permissions: { allow: ['Bash(make *)'] },
    }, null, 2));

    const result = runHook(
      { hook_event_name: 'SessionStart', source: 'startup', session_id: 'sess-1' },
      {
        HOME: stage.dir,
        // BIZAR_MODEL_ROUTER_CONFIG is honoured but absolute paths already
        // point at our stage file. Setting it explicitly is documentation.
        BIZAR_MODEL_ROUTER_CONFIG: stage.routerPath,
      },
    );

    assert.equal(result.status, 0, `hook exited non-zero: ${result.stderr}`);
    const out = parseStdout(result.stdout);
    assert.ok(out, 'stdout should be JSON');
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(out.hookSpecificOutput.additionalContext, /reapplied 3 model picker option/);

    // Verify the staged settings.json was rewritten with the operator picks
    // AND that unrelated operator settings (env, mcpServers, permissions)
    // were preserved verbatim.
    assert.ok(existsSync(stage.settingsPath), 'settings.json should still exist');
    const after = JSON.parse(readFileSync(stage.settingsPath, 'utf8'));
    assert.equal(after.model, 'codex/gpt-5.6-sol', 'dead claude-* alias should be reset to first user pick');
    assert.equal(after.env.BIZAR_HOME, '/tmp/test-bizar', 'env preserved');
    assert.deepEqual(after.mcpServers, { foo: { command: 'foo', args: [] } }, 'mcpServers preserved');
    assert.deepEqual(after.permissions, { allow: ['Bash(make *)'] }, 'permissions preserved');

    // modelPicker structure
    assert.ok(after.modelPicker && Array.isArray(after.modelPicker.options));
    assert.equal(after.modelPicker.options.length, 3);
    assert.deepEqual(after.modelPicker.options.map((o) => o.model), [
      'codex/gpt-5.6-sol',
      'minimax/MiniMax-M3',
      'qct/qwen3.8-max-preview',
    ]);
    // Derived labels (matches deriveModelLabel in cli/commands/models.mjs)
    assert.equal(after.modelPicker.options[0].label, 'gpt 5.6 sol');
    assert.equal(after.modelPicker.options[1].label, 'MiniMax M3');
    assert.equal(after.modelPicker.options[2].label, 'qwen3.8 max preview');

    // modelOverrides self-map for each live pick
    assert.deepEqual(after.modelOverrides, {
      'codex/gpt-5.6-sol': 'codex/gpt-5.6-sol',
      'minimax/MiniMax-M3': 'minimax/MiniMax-M3',
      'qct/qwen3.8-max-preview': 'qct/qwen3.8-max-preview',
    });
  } finally {
    rmSync(stage.dir, { recursive: true, force: true });
  }
});

test('model-sync: emits JSON on stdin and exits 0 even with empty input', () => {
  const stage = makeStage();
  try {
    // Point router at a file we never create so the hook treats this as a
    // missing-router noop rather than reading the operator's real router
    // file and clobbering their settings.json.
    const result = runHook({}, {
        HOME: stage.dir,
        BIZAR_MODEL_ROUTER_CONFIG: join(stage.dir, 'router.json'),
      });
    assert.equal(result.status, 0);
    const out = parseStdout(result.stdout);
    assert.ok(out, 'stdout should be JSON');
  } finally {
    rmSync(stage.dir, { recursive: true, force: true });
  }
});

test('model-sync: no userSelected → noop payload (empty additionalContext)', () => {
  const stage = makeStage();
  try {
    writeFileSync(stage.routerPath, JSON.stringify({ userSelected: { models: [] } }));
    const result = runHook(
      { hook_event_name: 'SessionStart', source: 'startup' },
      { HOME: stage.dir, BIZAR_MODEL_ROUTER_CONFIG: stage.routerPath },
    );
    assert.equal(result.status, 0);
    const out = parseStdout(result.stdout);
    assert.equal(out.hookSpecificOutput.additionalContext, '');
  } finally {
    rmSync(stage.dir, { recursive: true, force: true });
  }
});

test('model-sync: missing model-router.json is a noop, not an error', () => {
  const stage = makeStage();
  try {
    const result = runHook(
      { hook_event_name: 'SessionStart', source: 'startup' },
      {
        HOME: stage.dir,
        BIZAR_MODEL_ROUTER_CONFIG: join(stage.dir, 'router.json'),
      },
    );
    assert.equal(result.status, 0, 'hook must never block session start');
    const out = parseStdout(result.stdout);
    assert.equal(out.hookSpecificOutput.additionalContext, '');
  } finally {
    rmSync(stage.dir, { recursive: true, force: true });
  }
});

test('model-sync: malformed router JSON is swallowed (exits 0)', () => {
  const stage = makeStage();
  try {
    writeFileSync(stage.routerPath, '{not valid json');
    const result = runHook(
      { hook_event_name: 'SessionStart', source: 'startup' },
      { HOME: stage.dir, BIZAR_MODEL_ROUTER_CONFIG: stage.routerPath },
    );
    assert.equal(result.status, 0);
    const out = parseStdout(result.stdout);
    assert.equal(out.hookSpecificOutput.additionalContext, '');
  } finally {
    rmSync(stage.dir, { recursive: true, force: true });
  }
});

test('model-sync: derived label for openrouter multi-segment id matches helper', () => {
  const stage = makeStage();
  try {
    writeFileSync(stage.routerPath, JSON.stringify({
      userSelected: { models: ['openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'] },
    }));
    writeFileSync(stage.settingsPath, '{}');
    const result = runHook(
      { hook_event_name: 'SessionStart', source: 'startup' },
      { HOME: stage.dir, BIZAR_MODEL_ROUTER_CONFIG: stage.routerPath },
    );
    assert.equal(result.status, 0);
    const out = parseStdout(result.stdout);
    assert.match(out.hookSpecificOutput.additionalContext, /reapplied 1 model picker option/);
    const after = JSON.parse(readFileSync(stage.settingsPath, 'utf8'));
    assert.equal(after.modelPicker.options[0].label, 'nvidia nemotron 3 ultra 550b a55b free');
  } finally {
    rmSync(stage.dir, { recursive: true, force: true });
  }
});

test('model-sync: leaves model alone when it is already a live id', () => {
  const stage = makeStage();
  try {
    writeFileSync(stage.routerPath, JSON.stringify({
      userSelected: { models: ['minimax/MiniMax-M3', 'codex/gpt-5.6-sol'] },
    }));
    writeFileSync(stage.settingsPath, JSON.stringify({ model: 'minimax/MiniMax-M3' }));
    const result = runHook(
      { hook_event_name: 'SessionStart', source: 'startup' },
      { HOME: stage.dir, BIZAR_MODEL_ROUTER_CONFIG: stage.routerPath },
    );
    assert.equal(result.status, 0);
    const after = JSON.parse(readFileSync(stage.settingsPath, 'utf8'));
    // Operator pinned a specific live id; leave it alone.
    assert.equal(after.model, 'minimax/MiniMax-M3');
  } finally {
    rmSync(stage.dir, { recursive: true, force: true });
  }
});

test('model-sync: missing settings.json is created on first run', () => {
  const stage = makeStage();
  try {
    writeFileSync(stage.routerPath, JSON.stringify({
      userSelected: { models: ['minimax/MiniMax-M3'] },
    }));
    // Note: stage.settingsPath intentionally not created.
    const result = runHook(
      { hook_event_name: 'SessionStart', source: 'startup' },
      { HOME: stage.dir, BIZAR_MODEL_ROUTER_CONFIG: stage.routerPath },
    );
    assert.equal(result.status, 0);
    assert.ok(existsSync(stage.settingsPath), 'hook should materialise settings.json');
    const after = JSON.parse(readFileSync(stage.settingsPath, 'utf8'));
    assert.deepEqual(after.modelPicker.options, [{
      model: 'minimax/MiniMax-M3',
      label: 'MiniMax M3',
    }]);
  } finally {
    rmSync(stage.dir, { recursive: true, force: true });
  }
});

test('model-sync: disabledProviders strips banned ids before picker re-apply', () => {
  // 10.22.0 / Phase 4: the SessionStart hook honours the operator's
  // `disabledProviders: ["anthropic"]` list — even if `userSelected.models`
  // already contains `anthropic/*` from a prior run, the picker re-apply
  // must NOT surface them to Claude Code's `/model` menu.
  const stage = makeStage();
  try {
    writeFileSync(stage.routerPath, JSON.stringify({
      disabledProviders: ['anthropic'],
      userSelected: {
        models: ['anthropic/claude-3-5-sonnet', 'minimax/MiniMax-M3', 'anthropic/claude-opus-4'],
      },
    }));
    writeFileSync(stage.settingsPath, JSON.stringify({}));
    const result = runHook(
      { hook_event_name: 'SessionStart', source: 'startup' },
      { HOME: stage.dir, BIZAR_MODEL_ROUTER_CONFIG: stage.routerPath },
    );
    assert.equal(result.status, 0);
    const after = JSON.parse(readFileSync(stage.settingsPath, 'utf8'));
    // Only the non-disabled id survives in the picker.
    assert.deepEqual(after.modelPicker.options.map((o) => o.model), ['minimax/MiniMax-M3']);
    // The self-map pattern also skips the disabled ids.
    assert.deepEqual(after.modelOverrides, {
      'minimax/MiniMax-M3': 'minimax/MiniMax-M3',
    });
  } finally {
    rmSync(stage.dir, { recursive: true, force: true });
  }
});

test('model-sync: hook source mentions contract (regression fence)', () => {
  // Source-only assertions; no subprocess spawn so no settings.json writes.
  const src = readFileSync(HOOK_PATH, 'utf8');
  assert.match(src, /settings\.modelPicker\s*=\s*\{\s*options/);
  assert.match(src, /settings\.modelOverrides\s*=\s*Object\.fromEntries/);
  assert.match(src, /!liveIds\.includes\(settings\.model\)/);
  assert.match(src, /atomicWriteJson/);
});
