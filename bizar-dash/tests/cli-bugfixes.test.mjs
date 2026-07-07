/**
 * tests/cli-bugfixes.test.mjs — regression tests for CLI + installer bug fixes.
 *
 * Covers:
 *   B1 — parseWithModsFlag exits with code 2 when no value follows --with-mods
 *   B7 — check-deps.mjs uses path.join() (Windows fix) + covers all deps
 *   B9 — --json flag works for `bizar doctor --json`
 *   B10 — --debug flag sets DEBUG env var
 *
 * Run with: node --test bizar-dash/tests/cli-bugfixes.test.mjs
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

const REPO = join(process.cwd());

// ─── B1: parseWithModsFlag exits with code 2 on missing value ──────────────────

describe('B1 — parseWithModsFlag', () => {
  it('exits with code 2 when --with-mods is the last arg', async () => {
    // Import fresh each time to avoid module-level side effects
    const { parseWithModsFlag } = await import('../../cli/commands/install.mjs');
    let exitCode = null;
    const origExit = process.exit;
    // Mock process.exit to capture the code without terminating the test
    try {
      process.exit = (code) => { exitCode = code; throw new Error('exit:' + code); };
      parseWithModsFlag(['install', '--with-mods']);
    } catch (err) {
      if (err.message.startsWith('exit:')) exitCode = parseInt(err.message.split(':')[1]);
    } finally {
      process.exit = origExit;
    }
    assert.strictEqual(exitCode, 2, 'should have called process.exit(2)');
  });

  it('exits with code 2 when next arg is another flag', async () => {
    const { parseWithModsFlag } = await import('../../cli/commands/install.mjs');
    let exitCode = null;
    const origExit = process.exit;
    try {
      process.exit = (code) => { exitCode = code; throw new Error('exit:' + code); };
      parseWithModsFlag(['install', '--with-mods', '--force']);
    } catch (err) {
      if (err.message.startsWith('exit:')) exitCode = parseInt(err.message.split(':')[1]);
    } finally {
      process.exit = origExit;
    }
    assert.strictEqual(exitCode, 2);
  });

  it('returns null when --with-mods is not present', async () => {
    const { parseWithModsFlag } = await import('../../cli/commands/install.mjs');
    let exitCode = null;
    const origExit = process.exit;
    try {
      process.exit = (code) => { exitCode = code; throw new Error('exit:' + code); };
      const result = parseWithModsFlag(['install', '--force']);
      assert.strictEqual(result, null);
      assert.strictEqual(exitCode, null);
    } finally {
      process.exit = origExit;
    }
  });

  it('returns array of mod ids when value is provided', async () => {
    const { parseWithModsFlag } = await import('../../cli/commands/install.mjs');
    let exitCode = null;
    const origExit = process.exit;
    try {
      process.exit = (code) => { exitCode = code; throw new Error('exit:' + code); };
      const result = parseWithModsFlag(['install', '--with-mods', 'a,b,c']);
      assert.deepStrictEqual(result, ['a', 'b', 'c']);
      assert.strictEqual(exitCode, null);
    } finally {
      process.exit = origExit;
    }
  });
});

// ─── B7: check-deps.mjs cross-platform path joining ───────────────────────────

describe('B7 — check-deps.mjs which() uses path.join()', () => {
  it('covers all required dependencies', async () => {
    const { checkDeps } = await import('../../scripts/check-deps.mjs');
    const result = await checkDeps({ strict: false });
    const names = [...result.present, ...result.missing].map(d => d.name);
    const required = ['node', 'bun', 'cline', 'tmux', 'git', 'python3', 'pip', 'jq', 'gh', 'headroom', 'semble', 'skills'];
    for (const dep of required) {
      assert.ok(names.includes(dep), `expected ${dep} to be checked`);
    }
  });

  it('which() uses join() from node:path for path construction', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(join(process.cwd(), 'scripts', 'check-deps.mjs'), 'utf8');
    assert.ok(src.includes("import { join } from 'node:path'"), 'should import join from node:path');
    assert.ok(src.includes('join(dir, cmd + ext)'), 'should use join() for path construction');
  });
});

// ─── B9: --json flag for doctor ───────────────────────────────────────────────

describe('B9 — --json flag', () => {
  it('doctor --json outputs valid JSON', async () => {
    const { spawnSync } = await import('node:child_process');
    const bin = join(REPO, 'cli', 'bin.mjs');
    const result = spawnSync('node', [bin, 'doctor', '--json'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    const out = result.stdout.trim();
    // Should be parseable as JSON
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      assert.fail(`expected JSON output, got: ${out.slice(0, 200)}`);
      return;
    }
    assert.ok('passed' in parsed, 'JSON should have passed field');
    assert.ok('failed' in parsed, 'JSON should have failed field');
    assert.ok('results' in parsed, 'JSON should have results field');
    assert.ok(Array.isArray(parsed.results), 'results should be an array');
  });
});

// ─── B10: --debug flag sets DEBUG env var ──────────────────────────────────────

describe('B10 — --debug flag', () => {
  it('dbg() helper is defined in bin.mjs', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(join(REPO, 'cli', 'bin.mjs'), 'utf8');
    assert.ok(src.includes('function dbg('), 'dbg() helper should be defined');
    assert.ok(src.includes("process.env.DEBUG = 'bizar:*'"), '--debug should set DEBUG=bizar:*');
    assert.ok(src.includes("process.env.BIZAR_DEBUG = '1'"), '--debug should set BIZAR_DEBUG=1');
  });

  it('--debug flag is accepted without error', async () => {
    const { spawnSync } = await import('node:child_process');
    const bin = join(REPO, 'cli', 'bin.mjs');
    // Just verify --debug doesn't cause a parse error or unknown flag
    const result = spawnSync('node', [bin, '--help', '--debug'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    // --debug should not cause an error (help should print)
    assert.ok(result.status === 0 || result.stdout.includes('bizar'), '--debug should not error');
  });
});
