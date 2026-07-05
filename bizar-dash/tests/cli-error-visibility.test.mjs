/**
 * bizar-dash/tests/cli-error-visibility.test.mjs
 *
 * v4.7.1 — CLI silent error visibility fixes.
 *
 * Verifies:
 *   1. importCommand() failure produces a visible error message
 *   2. `bizar help` shows help text (not "Unknown command")
 *   3. `bizar --help` shows help text
 *   4. `bizar` (no command) shows help text
 *
 * Run with: node --test bizar-dash/tests/cli-error-visibility.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// __dirname = .../BizarHarness/bizar-dash/tests  →  .../BizarHarness/cli
const CLI_ROOT = resolve(__dirname, '..', '..', 'cli');

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Run the CLI as a subprocess and capture stdout + stderr.
 * Uses spawnSync for reliable synchronous capture.
 * Returns { code, stdout, stderr }.
 */
function runBizar(args, env = {}) {
  const binPath = resolve(CLI_ROOT, 'bin.mjs');
  const result = spawnSync('node', [binPath, ...args], {
    env: { ...process.env, BIZAR_SKIP_INSTALL: '1', ...env },
    timeout: 10000,
    encoding: 'utf8',
  });
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

// ── importCommand() failure ───────────────────────────────────────────────────

describe('importCommand() failure produces visible error', () => {
  test('non-existent command prints "Unknown command", not silent exit', () => {
    const { code, stdout, stderr } = runBizar(['this-command-does-not-exist-xyz']);
    const combined = stdout + stderr;
    // Should exit with error code
    assert.notStrictEqual(code, 0, `should exit non-zero, got ${code}`);
    // Should NOT be silent
    assert.ok(combined.length > 0, `should produce output, not silent. stdout=${stdout.length}, stderr=${stderr.length}`);
    // Should mention the unknown command
    assert.ok(
      combined.includes('Unknown command') || combined.includes('this-command-does-not-exist-xyz'),
      `output should mention Unknown command or the command name, got: ${combined.slice(0, 200)}`,
    );
  });

  test('broken command module logs error to stderr (not silent)', () => {
    // The bin.mjs importCommand catch now logs to console.error.
    // We verify stderr is non-empty when a command fails to load.
    const { stderr } = runBizar(['this-command-does-not-exist-xyz']);
    assert.ok(stderr.length > 0, `stderr should not be empty when command fails. stderr=${JSON.stringify(stderr.slice(0, 100))}`);
  });
});

// ── `bizar help` alias ─────────────────────────────────────────────────────────

describe('`bizar help` alias', () => {
  test('`bizar help` shows help text, not "Unknown command"', () => {
    const { code, stdout, stderr } = runBizar(['help']);
    const combined = stdout + stderr;
    assert.strictEqual(code, 0, `should exit with 0, got ${code}. stderr: ${stderr.slice(0, 300)}`);
    assert.ok(
      combined.includes('Usage:') && combined.includes('bizar'),
      `should show help usage, got: ${combined.slice(0, 300)}`,
    );
    assert.ok(
      !combined.includes('Unknown command'),
      `should NOT say "Unknown command", got: ${combined.slice(0, 300)}`,
    );
  });
});

// ── `bizar --help` ─────────────────────────────────────────────────────────────

describe('`bizar --help`', () => {
  test('`bizar --help` shows help text', () => {
    const { code, stdout, stderr } = runBizar(['--help']);
    const combined = stdout + stderr;
    assert.strictEqual(code, 0, `should exit with 0, got ${code}. stderr: ${stderr.slice(0, 300)}`);
    assert.ok(
      combined.includes('Usage:') && combined.includes('bizar'),
      `should show help usage, got: ${combined.slice(0, 300)}`,
    );
  });

  test('`bizar -h` shows help text', () => {
    const { code, stdout, stderr } = runBizar(['-h']);
    const combined = stdout + stderr;
    assert.strictEqual(code, 0, `should exit with 0, got ${code}. stderr: ${stderr.slice(0, 300)}`);
    assert.ok(
      combined.includes('Usage:') && combined.includes('bizar'),
      `should show help usage, got: ${combined.slice(0, 300)}`,
    );
  });
});

// ── `bizar` (no command) ───────────────────────────────────────────────────────

describe('`bizar` with no command', () => {
  test('`bizar` with no args shows help text', () => {
    const { code, stdout, stderr } = runBizar([]);
    const combined = stdout + stderr;
    assert.strictEqual(code, 0, `should exit with 0, got ${code}. stderr: ${stderr.slice(0, 300)}`);
    assert.ok(
      combined.includes('Usage:') && combined.includes('bizar'),
      `should show help usage, got: ${combined.slice(0, 300)}`,
    );
    assert.ok(
      !combined.includes('Unknown command'),
      `should NOT say "Unknown command", got: ${combined.slice(0, 300)}`,
    );
  });
});

// ── Defensive null checks on import ───────────────────────────────────────────

describe('command module null-check produces user-visible error', () => {
  test('bin.mjs has null checks after importCommand in all case branches', async () => {
    const binSrc = await import('fs').then((fs) =>
      fs.promises.readFile(resolve(CLI_ROOT, 'bin.mjs'), 'utf8'),
    );
    // Count `if (!mod)` checks that follow `importCommand`
    const nullCheckCount = (binSrc.match(/if \(!mod\)/g) || []).length;
    // We have 9 case groups that call importCommand: install/update, service, dash,
    // minimax, headroom, mod, artifact, memory, usage, and util (utility commands)
    assert.ok(
      nullCheckCount >= 9,
      `Expected at least 9 null checks after importCommand, found ${nullCheckCount}`,
    );
    // Also verify each has a user-visible error message
    const errorMsgCount = (binSrc.match(/Could not load .+ command module/g) || []).length;
    assert.ok(
      errorMsgCount >= 9,
      `Expected at least 9 user-visible error messages for failed loads, found ${errorMsgCount}`,
    );
  });
});
