/**
 * tests/memory-install-bootstrap.test.mjs
 *
 * Regression test for v4.2.2: the `bizar` CLI bootstrap path crashed with
 * `ERR_AMBIGUOUS_MODULE_SYNTAX` on a fresh install because `promptAndInstallOptional`
 * in `cli/install.mjs` referenced `__dirname` (a CommonJS global) without defining
 * the ESM polyfill. This was only triggered by the bootstrap path, which the
 * existing test suite never exercised.
 *
 * Test: spawn the CLI in a fresh temp project, with BIZAR_SKIP_INSTALL unset.
 * The bootstrap should run and exit cleanly (rc 0 or rc 1 for missing auth, but
 * NOT crash with ERR_AMBIGUOUS_MODULE_SYNTAX).
 *
 * Fix: move the `__dirname` polyfill to module scope in cli/install.mjs.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const CLI_BIN = join(dirname(__filename), '..', '..', 'cli', 'bin.mjs');

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Spawn `bizar <subcmd>` in the given cwd, with the given env vars.
 * Returns { code, stdout, stderr }.
 *
 * The bootstrap path is checked by NOT setting BIZAR_SKIP_INSTALL.
 */
function runBizarWithoutSkip(args, cwd, extraEnv = {}) {
  try {
    const stdout = execFileSync('node', [CLI_BIN, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30_000,
      env: { ...process.env, ...extraEnv }, // no BIZAR_SKIP_INSTALL
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : (err.message ?? ''),
    };
  }
}

describe('bizar CLI bootstrap (v4.2.3 regression)', () => {
  let projectRoot;
  let homeDir;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `bizar-bootstrap-${uid()}`);
    homeDir = join(tmpdir(), `bizar-bootstrap-home-${uid()}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(homeDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('bizar --version does not crash with ERR_AMBIGUOUS_MODULE_SYNTAX', () => {
    const r = runBizarWithoutSkip(['--version'], projectRoot, { HOME: homeDir });
    // Whatever exit code, the key thing is the bootstrap doesn't crash
    assert.ok(
      !r.stderr.includes('ERR_AMBIGUOUS_MODULE_SYNTAX'),
      `bootstrap crashed with ERR_AMBIGUOUS_MODULE_SYNTAX. stderr=${r.stderr}`,
    );
    assert.ok(
      !r.stderr.includes('Cannot determine intended module format'),
      `bootstrap module-format error. stderr=${r.stderr}`,
    );
  });

  it('bizar memory status does not crash with ERR_AMBIGUOUS_MODULE_SYNTAX', () => {
    const r = runBizarWithoutSkip(['memory', 'status'], projectRoot, { HOME: homeDir });
    assert.ok(
      !r.stderr.includes('ERR_AMBIGUOUS_MODULE_SYNTAX'),
      `bootstrap crashed with ERR_AMBIGUOUS_MODULE_SYNTAX. stderr=${r.stderr}`,
    );
    assert.ok(
      !r.stderr.includes('Cannot determine intended module format'),
      `bootstrap module-format error. stderr=${r.stderr}`,
    );
  });

  it('bizar memory doctor does not crash with ERR_AMBIGUOUS_MODULE_SYNTAX', () => {
    const r = runBizarWithoutSkip(['memory', 'doctor'], projectRoot, { HOME: homeDir });
    assert.ok(
      !r.stderr.includes('ERR_AMBIGUOUS_MODULE_SYNTAX'),
      `bootstrap crashed with ERR_AMBIGUOUS_MODULE_SYNTAX. stderr=${r.stderr}`,
    );
  });

  it('install.mjs source defines __dirname at module scope (regression guard)', () => {
    // Read the source of cli/install.mjs and check that __dirname is
    // defined at module scope (not only inside runInstaller).
    const installSrc = execFileSync('node', ['-e', `
      const fs = require('fs');
      const src = fs.readFileSync(${JSON.stringify(join(dirname(CLI_BIN), 'install.mjs'))}, 'utf8');
      // Find first __dirname definition (should be at module scope, not inside a function)
      const lines = src.split('\\n');
      let firstDefine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('__dirname = dirname(fileURLToPath')) {
          firstDefine = i;
          break;
        }
      }
      // The first definition must be BEFORE any function definition that uses __dirname
      // Simple heuristic: it must be within the first 20 lines
      process.stdout.write(JSON.stringify({ firstDefine, totalLines: lines.length }));
    `], { encoding: 'utf8' });
    const { firstDefine, totalLines } = JSON.parse(installSrc);
    assert.ok(
      firstDefine >= 0 && firstDefine < 20,
      `__dirname polyfill should be at module scope (first 20 lines). Found at line ${firstDefine + 1} of ${totalLines}.`,
    );
  });
});
