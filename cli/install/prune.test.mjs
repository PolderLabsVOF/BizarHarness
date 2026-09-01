/**
 * cli/install/prune.test.mjs
 *
 * Tests for the installer's prune + flag-wiring behavior added by F-141.
 *
 * Covers:
 *   1. pruneStale() — removes dest entries not in src, respects filter.
 *   2. runInstaller() — forwards --force / --dry-run / --quiet through
 *      to the provisioner (the bug that broke `bizar install --force`).
 */

import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_ENV = Object.fromEntries(
  ['HOME', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'BIZAR_HOME'].map((key) => [key, process.env[key]]),
);
const SUITE_HOME = mkdtempSync(join(tmpdir(), 'bizar-prune-test-'));
process.env.HOME = SUITE_HOME;
process.env.CLAUDE_CONFIG_DIR = join(SUITE_HOME, '.claude');
process.env.XDG_CONFIG_HOME = join(SUITE_HOME, '.config');
process.env.BIZAR_HOME = join(SUITE_HOME, '.config', 'bizar');

after(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { rmSync(SUITE_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

function mkdirp(p) { mkdirSync(p, { recursive: true }); }
function touch(p, content = '') { mkdirp(join(p, '..')); writeFileSync(p, content); }

// ─── pruneStale ──────────────────────────────────────────────────────────────

describe('pruneStale()', () => {
  let work;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'bizar-prune-work-'));
  });
  afterEach(() => {
    if (work) try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('removes files in dest not present in src', async () => {
    const { pruneStale } = await import('../provision.mjs');
    const src = join(work, 'src');
    const dst = join(work, 'dst');
    mkdirp(src); mkdirp(dst);
    touch(join(src, 'keep.md'), '# keep');
    touch(join(dst, 'keep.md'), '# keep');
    touch(join(dst, 'stale.md'), '# stale');

    const r = pruneStale(src, dst);
    assert.equal(r.removed, 1, 'one stale file removed');
    assert.equal(existsSync(join(dst, 'stale.md')), false);
    assert.equal(existsSync(join(dst, 'keep.md')), true);
  });

  test('respects filter — only touches matching extensions', async () => {
    const { pruneStale } = await import('../provision.mjs');
    const src = join(work, 'src');
    const dst = join(work, 'dst');
    mkdirp(src); mkdirp(dst);
    touch(join(dst, 'orphan.md'), 'md');
    touch(join(dst, 'orphan.txt'), 'txt');

    const r = pruneStale(src, dst, { filter: n => n.endsWith('.md') });
    assert.equal(r.removed, 1, 'md pruned');
    assert.equal(existsSync(join(dst, 'orphan.md')), false);
    assert.equal(existsSync(join(dst, 'orphan.txt')), true, 'txt preserved by filter');
  });

  test('skill-prune .md filter leaves arbitrary files alone (mirrors syncSkillFiles policy)', async () => {
    const { pruneStale } = await import('../provision.mjs');
    const src = join(work, 'src-skill');
    const dst = join(work, 'dst-skill');
    mkdirp(src); mkdirp(dst);
    // src has a normal skill dir, dst has the same dir plus a stray
    // user-owned .txt and a stray .json fixture.
    mkdirp(join(src, 'agent-baseline'));
    touch(join(src, 'agent-baseline', 'SKILL.md'), 'baseline');
    mkdirp(join(dst, 'agent-baseline'));
    touch(join(dst, 'agent-baseline', 'SKILL.md'), 'baseline');
    touch(join(dst, 'user-owned.txt'), 'mine');
    touch(join(dst, 'notes.json'), '{}');

    const r = pruneStale(src, dst, { filter: n => n.endsWith('.md') });
    assert.equal(r.removed, 0, 'no .md to prune in this fixture');
    assert.equal(existsSync(join(dst, 'user-owned.txt')), true);
    assert.equal(existsSync(join(dst, 'notes.json')), true);
  });

  test('recurses into subdirectories and removes stale ones', async () => {
    const { pruneStale } = await import('../provision.mjs');
    const src = join(work, 'src');
    const dst = join(work, 'dst');
    mkdirp(join(src, 'active'));
    mkdirp(join(dst, 'active'));
    mkdirp(join(dst, 'retired'));
    touch(join(src, 'active', 'SKILL.md'), 'a');
    touch(join(dst, 'active', 'SKILL.md'), 'a');
    touch(join(dst, 'retired', 'SKILL.md'), 'old');

    const r = pruneStale(src, dst);
    // A whole removed dir counts as 1; the file inside it is removed by
    // the recursive rmSync. We assert the directory is gone and the
    // survivor directory was preserved.
    assert.ok(r.removed >= 1, 'at least one entry removed');
    assert.equal(existsSync(join(dst, 'retired')), false, 'stale dir gone');
    assert.equal(existsSync(join(dst, 'active', 'SKILL.md')), true, 'active file kept');
    assert.equal(existsSync(join(dst, 'active')), true, 'active dir kept');
  });

  test('no-op when dest is empty or missing', async () => {
    const { pruneStale } = await import('../provision.mjs');
    const r1 = pruneStale(work, join(work, 'nope'));
    const r2 = pruneStale(work, work);
    assert.deepEqual(r1, { removed: 0, kept: 0 });
    assert.deepEqual(r2, { removed: 0, kept: 0 });
  });
});

// ─── runInstaller flag wiring ────────────────────────────────────────────────

describe('runInstaller() flag wiring (F-141)', () => {
  test('quiet=true returns without running provisioner', async () => {
    const { runInstaller } = await import('./index.mjs');
    const result = await runInstaller({ quiet: true });
    assert.equal(result.ok, true);
    assert.equal(result.stepResults, undefined, 'no provisioner steps ran');
  });

  test('dryRun=true returns ok without throwing on parse', async () => {
    const { runInstaller } = await import('./index.mjs');
    const result = await runInstaller({ dryRun: true });
    assert.equal(result.ok, true);
  });

  test('force=true is accepted and remains confined to the suite home', async () => {
    const { runInstaller } = await import('./index.mjs');
    const result = await runInstaller({ force: true, dryRun: true });
    assert.equal(result.ok, true);
    assert.ok(result.clean.wiped.every((path) => path.startsWith(SUITE_HOME)));
  });
});

describe('parseFlags() shared between install and provisioner', () => {
  // The argv parser lives in cli/provision.mjs and is the single
  // source of truth for installer flags. install() in
  // cli/commands/install.mjs imports it directly. These tests pin
  // the surface so install/update/provision stay in lockstep.
  test('--force --dry-run --yes are recognized', async () => {
    const { parseFlags } = await import('../provision.mjs');
    const opts = parseFlags(['--force', '--dry-run', '--yes', '-y', '--non-interactive']);
    assert.equal(opts.force, true);
    assert.equal(opts.dryRun, true);
    assert.equal(opts.yes, true);
  });

  test('--mode=update flips mode to update', async () => {
    const { parseFlags } = await import('../provision.mjs');
    assert.equal(parseFlags(['--mode=update']).mode, 'update');
    assert.equal(parseFlags(['--mode=install']).mode, 'install');
    assert.equal(parseFlags([]).mode, 'install');
    assert.equal(parseFlags(['--update']).mode, 'update');
  });

  // v10.19.6 — exhaustive flag-contract pin. Every flag advertised
  // anywhere in `bizar install` / `bizar update` help text MUST be
  // recognized by parseFlags. If a future refactor drops a flag from
  // the parser without also dropping it from the help text, one of
  // these assertions will fail. Pairs with
  // cli/commands/__tests__/update-help-contract.test.mjs which pins
  // the help-text side.
  test('exhaustive parseFlags contract — every advertised flag is recognized', async () => {
    const { parseFlags } = await import('../provision.mjs');

    // --dry-run (install + update)
    assert.equal(parseFlags(['--dry-run']).dryRun, true, '--dry-run');

    // --force and its --deep alias
    const force = parseFlags(['--force']);
    assert.equal(force.force, true, '--force');
    assert.equal(parseFlags(['--deep']).force, true, '--deep (alias for --force)');

    // --yes and its -y / --non-interactive aliases
    assert.equal(parseFlags(['--yes']).yes, true, '--yes');
    assert.equal(parseFlags(['-y']).yes, true, '-y');
    assert.equal(parseFlags(['--non-interactive']).yes, true, '--non-interactive (alias for --yes)');

    // --no-service
    assert.equal(parseFlags(['--no-service']).start, false, '--no-service');

    // --mode variants
    assert.equal(parseFlags(['--mode=install']).mode, 'install', '--mode=install');
    assert.equal(parseFlags(['--mode=update']).mode, 'update', '--mode=update');
    assert.equal(parseFlags(['--mode=install-only-system']).mode, 'install-only-system', '--mode=install-only-system');

    // --update legacy alias
    assert.equal(parseFlags(['--update']).mode, 'update', '--update (legacy alias for --mode=update)');
  });

  test('parseFlags defaults match the help text', async () => {
    const { parseFlags } = await import('../provision.mjs');
    const opts = parseFlags([]);
    assert.equal(opts.mode, 'install', 'default mode is install');
    assert.equal(opts.dryRun, false, 'default dryRun is false');
    assert.equal(opts.force, false, 'default force is false');
    assert.equal(opts.yes, false, 'default yes is false');
  });
});

console.log('  prune.test.mjs loaded — run with: node --test cli/install/prune.test.mjs');
