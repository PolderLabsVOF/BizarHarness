/**
 * cli/__tests__/models-persists-under-bizar-home.test.mjs
 *
 * Regression coverage: the model router file must live under
 * `~/.claude/model-router.json` (where Claude Code hooks read it),
 * NOT under `~/.config/bizar/`.  Running `bizar models` from any cwd
 * must persist to the same global file.
 *
 * These tests drive `bizar models --set` from two different tmp cwds and
 * assert that:
 *   1. The persisted file lives under `CLAUDE_CONFIG_DIR`, NOT under the tmp cwd.
 *   2. Re-running the command from a DIFFERENT cwd preserves the SAME
 *      global file (no per-cwd copy).
 *   3. The `BIZAR_MODEL_ROUTER_CONFIG` env override still works as an
 *      explicit operator escape hatch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const CWD = process.cwd();
const BIN = join(CWD, 'cli', 'bin.mjs');

/**
 * The harness resolves BIZAR_HOME lazily through `process.env.BIZAR_HOME`
 * -> `process.env.XDG_CONFIG_HOME/bizar` -> `$HOME/.config/bizar`. We pin
 * `BIZAR_HOME` directly to a tmp dir per test (the documented per-invocation
 * override — see `cli/provision.mjs#computeBizarHome`) so the subprocess
 * writes to a hermetic location and never touches the operator's real home.
 */
function makeSandbox() {
  const bizarHome = mkdtempSync(join(tmpdir(), 'bizar-models-home-'));
  const cwd1 = mkdtempSync(join(tmpdir(), 'bizar-models-cwd1-'));
  const cwd2 = mkdtempSync(join(tmpdir(), 'bizar-models-cwd2-'));
  const claudeConfigDir = mkdtempSync(join(tmpdir(), 'bizar-models-claude-'));
  return { bizarHome, cwd1, cwd2, claudeConfigDir };
}

function cleanupSandbox(sandbox) {
  for (const dir of [sandbox.cwd1, sandbox.cwd2, sandbox.bizarHome, sandbox.claudeConfigDir]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function sandboxEnv(sandbox, extra = {}) {
  return {
    BIZAR_HOME: sandbox.bizarHome,
    CLAUDE_CONFIG_DIR: sandbox.claudeConfigDir,
    ...extra,
  };
}

function runBizar(args, { cwd, env } = {}) {
  return new Promise((resolveP) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: {
        ...process.env,
        BIZAR_SKIP_BUILD: '1',
        ...(env || {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('exit', (code) => resolveP({ code, stdout, stderr }));
  });
}

test('bizar models --set persists the router file under CLAUDE_CONFIG_DIR, not cwd', async () => {
  const sandbox = makeSandbox();
  try {
    // Router lives under CLAUDE_CONFIG_DIR (~/.claude/model-router.json) — the single
    // canonical location that both the CLI and Claude Code hooks agree on.
    const expectedRouterPath = join(sandbox.claudeConfigDir, 'model-router.json');

    const { code, stdout, stderr } = await runBizar(['models', '--set=a/1,b/2', '--json'], {
      cwd: sandbox.cwd1,
      env: sandboxEnv(sandbox),
    });

    assert.equal(code, 0, `expected 0, got ${code}; stderr=${stderr}; stdout=${stdout}`);

    // The global router file MUST exist under CLAUDE_CONFIG_DIR.
    assert.equal(
      existsSync(expectedRouterPath),
      true,
      `router file must be persisted at ${expectedRouterPath} (under CLAUDE_CONFIG_DIR), not under cwd`,
    );

    // The cwd-relative mirror MUST NOT exist — no per-cwd leakage.
    const cwdMirror = join(sandbox.cwd1, 'model-router.json');
    assert.equal(
      existsSync(cwdMirror),
      false,
      `no router file may leak into ${cwdMirror}`,
    );

    // The persisted payload under CLAUDE_CONFIG_DIR carries the userSelected block.
    const parsed = JSON.parse(readFileSync(expectedRouterPath, 'utf8'));
    assert.deepEqual(parsed.userSelected.models, ['a/1', 'b/2']);
    assert.equal(parsed.userSelected.source, 'cli-set');

    const settings = JSON.parse(readFileSync(join(sandbox.claudeConfigDir, 'settings.json'), 'utf8'));
    assert.equal(settings.model, 'a/1', 'model sync must stay inside the test Claude config');
  } finally {
    cleanupSandbox(sandbox);
  }
});

test('re-running bizar models from a different cwd preserves the same global CLAUDE_CONFIG_DIR file', async () => {
  const sandbox = makeSandbox();
  try {
    const expectedRouterPath = join(sandbox.claudeConfigDir, 'model-router.json');

    // First run from cwd1.
    const first = await runBizar(['models', '--set=a/1', '--json'], {
      cwd: sandbox.cwd1,
      env: sandboxEnv(sandbox),
    });
    assert.equal(first.code, 0, `first run exited ${first.code}; stderr=${first.stderr}`);
    assert.equal(existsSync(expectedRouterPath), true);

    // Second run from cwd2 — completely different cwd.
    const second = await runBizar(['models', '--set=a/1,b/2', '--json'], {
      cwd: sandbox.cwd2,
      env: sandboxEnv(sandbox),
    });
    assert.equal(second.code, 0, `second run exited ${second.code}; stderr=${second.stderr}`);

    // No per-cwd copy: cwd2 must NOT have its own router file.
    const cwd2Mirror = join(sandbox.cwd2, 'model-router.json');
    assert.equal(
      existsSync(cwd2Mirror),
      false,
      `second run must NOT create a per-cwd mirror at ${cwd2Mirror}`,
    );

    // And the global file reflects the second run (overwriting the first).
    const parsed = JSON.parse(readFileSync(expectedRouterPath, 'utf8'));
    assert.deepEqual(parsed.userSelected.models, ['a/1', 'b/2'], 'second run wins; no per-cwd sharding');
  } finally {
    cleanupSandbox(sandbox);
  }
});

test('BIZAR_MODEL_ROUTER_CONFIG absolute override still wins over the BIZAR_HOME default', async () => {
  const sandbox = makeSandbox();
  try {
    const tmpRouter = join(sandbox.cwd1, 'redirected-router.json');
    writeFileSync(tmpRouter, JSON.stringify({
      version: '13.0.0',
      endpoint: 'http://stub/v1',
      tiers: { premium: { models: ['stub/p'], purpose: 'x', effort: 'high' } },
      policies: { selectionOwner: 'orchestrator', discoveryFailure: 'inherit-session', unavailableModel: 'inherit-session', retryModelAliases: false, maxDispatchModelAttempts: 1 },
    }));

    const { code, stdout, stderr } = await runBizar(['models', '--set=alpha/1', '--json'], {
      cwd: sandbox.cwd1,
      env: sandboxEnv(sandbox, {
        BIZAR_MODEL_ROUTER_CONFIG: tmpRouter,
      }),
    });

    assert.equal(code, 0, `expected 0, got ${code}; stderr=${stderr}; stdout=${stdout}`);

    // The override target got the write.
    assert.equal(existsSync(tmpRouter), true);
    const parsed = JSON.parse(readFileSync(tmpRouter, 'utf8'));
    assert.deepEqual(parsed.userSelected.models, ['alpha/1']);

    // And the BIZAR_HOME default was NOT touched — the override is exclusive.
    const bizHomeRouter = join(sandbox.bizarHome, 'config', 'claude', 'model-router.json');
    assert.equal(
      existsSync(bizHomeRouter),
      false,
      `BIZAR_MODEL_ROUTER_CONFIG override must suppress the BIZAR_HOME default write (${bizHomeRouter})`,
    );
  } finally {
    cleanupSandbox(sandbox);
  }
});
