/**
 * cli/__tests__/workflow-gc.test.mjs — Phase B (v10.21.0) B.3
 *
 * Pins the workflow-gc CLI's lifecycle semantics:
 *   - Empty runs dir: 0 candidates, exit 0.
 *   - In-progress OpenKan task: ALL runs marked
 *     skip:in-progress, NO deletions.
 *   - 14-day boundary: runs older than 14d are deleted; runs newer than
 *     14d are skipped with skip:too-recent.
 *   - Idempotency: re-running after a successful sweep deletes nothing
 *     (all candidates gone).
 *   - Permission-denied: skip + warn without aborting the sweep.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, utimesSync, statSync, chmodSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = fileURLToPath(import.meta.url);
const repoRoot = resolve(here, '..', '..', '..');
const gcCli = join(repoRoot, 'cli', 'commands', 'workflow-gc.mjs');

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'bizar-gc-'));
}

/**
 * Set the mtime of every direct child directory inside `parent` (so
 * listRuns()'s mtimeMs reflects the requested age) AND the mtime of
 * `parent` itself (so the runs-root walk also ages uniformly).
 */
function setMtime(parent, daysAgo) {
  const ms = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  const atime = new Date(ms / 2);
  const mtime = new Date(ms);
  try { utimesSync(parent, atime, mtime); } catch { /* best-effort */ }
  for (const name of readdirSync(parent)) {
    const full = join(parent, name);
    try {
      const s = statSync(full);
      if (s.isDirectory()) utimesSync(full, atime, mtime);
      else utimesSync(full, atime, mtime);
    } catch {
      // best-effort
    }
  }
}

/**
 * Set the mtime of one specific run directory (used by per-run tests).
 */
function setRunMtime(runPath, daysAgo) {
  const ms = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  utimesSync(runPath, new Date(ms / 2), new Date(ms));
}

async function runGc(args, opts = {}) {
  return spawnSync(process.execPath, [gcCli, ...args], {
    cwd: opts.cwd || '/tmp',
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('workflow-gc B.3', () => {
  test('empty runs dir: 0 candidates, exit 0', async () => {
    const root = makeRoot();
    const runs = join(root, '.bizar', 'runs');
    mkdirSync(runs, { recursive: true });
    // No runs directory at all is the more common case; cover it too.
    const emptyRoot = makeRoot();
    const r1 = await runGc(['--dry-run', '--root', runs]);
    assert.equal(r1.status, 0, r1.stderr);
    assert.match(r1.stdout, /candidates:\s+0/);
    const r2 = await runGc(['--dry-run', '--root', join(emptyRoot, '.bizar', 'runs')]);
    assert.equal(r2.status, 0);
    assert.match(r2.stdout, /candidates:\s+0/);
    rmSync(root, { recursive: true, force: true });
    rmSync(emptyRoot, { recursive: true, force: true });
  });

  test('in_progress OpenKan task blocks all deletions', async () => {
    const root = makeRoot();
    const runs = join(root, '.bizar', 'runs');
    mkdirSync(runs, { recursive: true });
    // Create two old runs (both > 14d).
    for (const id of ['old-1', 'old-2']) {
      const r = join(runs, id);
      mkdirSync(r);
      writeFileSync(join(r, 'manifest.json'), JSON.stringify({ runId: id }));
    }
    setMtime(runs, 30);

    // Add an active OpenKan task.
    mkdirSync(join(root, '.ok', 'tasks'), { recursive: true });
    writeFileSync(join(root, '.ok', 'tasks', 'tsk-active.json'), JSON.stringify({
      schema: 'ok.task.v1', id: 'tsk-active', status: 'in_progress',
    }));

    const r = await runGc(['--root', runs], { cwd: root });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /in-progress:\s+yes/);
    assert.match(r.stdout, /SKIP \(in-progress\)/);
    // Both runs still on disk
    assert.ok(existsSync(join(runs, 'old-1')));
    assert.ok(existsSync(join(runs, 'old-2')));
    rmSync(root, { recursive: true, force: true });
  });

  test('14-day boundary: deletes >14d, skips <=14d', async () => {
    const root = makeRoot();
    const runs = join(root, '.bizar', 'runs');
    mkdirSync(runs, { recursive: true });
    // No active OpenKan task -> no in-progress gate.
    for (const id of ['old', 'new', 'boundary']) {
      const r = join(runs, id);
      mkdirSync(r);
      writeFileSync(join(r, 'manifest.json'), JSON.stringify({ runId: id }));
    }
    // old: 20 days ago, new: 5 days ago, boundary: 14.0001 days ago (just past)
    setRunMtime(join(runs, 'old'), 20);
    setRunMtime(join(runs, 'new'), 5);
    setRunMtime(join(runs, 'boundary'), 14.01);

    // First dry-run
    const dry = await runGc(['--dry-run', '--root', runs], { cwd: root });
    assert.equal(dry.status, 0);
    assert.match(dry.stdout, /DELETE\s+old/);
    assert.match(dry.stdout, /SKIP \(too-recent\)\s+new/);
    assert.match(dry.stdout, /DELETE\s+boundary/);

    // Now real delete
    const real = await runGc(['--root', runs], { cwd: root });
    assert.equal(real.status, 0);
    assert.equal(existsSync(join(runs, 'old')), false);
    assert.equal(existsSync(join(runs, 'new')), true);
    assert.equal(existsSync(join(runs, 'boundary')), false);

    // Idempotent: re-run only sees the still-too-recent 'new' run.
    const re = await runGc(['--root', runs], { cwd: root });
    assert.equal(re.status, 0);
    assert.match(re.stdout, /candidates:\s+1/);
    assert.match(re.stdout, /SKIP \(too-recent\)\s+new/);
    rmSync(root, { recursive: true, force: true });
  });

  test('permission-denied: skip + warn without aborting the sweep', async () => {
    const root = makeRoot();
    const runs = join(root, '.bizar', 'runs');
    mkdirSync(runs, { recursive: true });
    for (const id of ['locked', 'unlocked']) {
      const r = join(runs, id);
      mkdirSync(r);
      writeFileSync(join(r, 'manifest.json'), JSON.stringify({ runId: id }));
    }
    setMtime(runs, 30);
    // Strip write perms on `locked` so rmSync will throw EACCES.
    chmodSync(join(runs, 'locked'), 0o555);

    // Restore perms in cleanup.
    const restore = () => {
      try { chmodSync(join(runs, 'locked'), 0o755); } catch { /* ignore */ }
    };
    try {
      const r = await runGc(['--root', runs], { cwd: root });
      restore();
      // The 'locked' run is skipped/errored; 'unlocked' is deleted;
      // the sweep exits non-zero because errors > 0.
      assert.equal(r.status, 1, `expected exit 1 (errors > 0); got ${r.status}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
      assert.match(r.stdout, /ERROR \(permission-denied\)\s+locked/);
      assert.match(r.stdout, /DELETED\s+unlocked/);
      // Locked dir may still be on disk; that is the skip+warn behavior.
      assert.ok(existsSync(join(runs, 'locked')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('gc.json log is emitted with a per-row breakdown', async () => {
    const root = makeRoot();
    const runs = join(root, '.bizar', 'runs');
    mkdirSync(runs, { recursive: true });
    const r = join(runs, 'logged');
    mkdirSync(r);
    writeFileSync(join(r, 'manifest.json'), JSON.stringify({ runId: 'logged' }));
    setMtime(runs, 20);
    const result = await runGc(['--root', runs], { cwd: root });
    assert.equal(result.status, 0);
    const logPath = join(runs, 'gc.json');
    assert.ok(existsSync(logPath), 'gc.json must be written');
    const log = JSON.parse(readFileSync(logPath, 'utf8'));
    assert.equal(log.maxAgeDays, 14);
    assert.equal(log.inProgressIds.length, 0);
    assert.equal(log.deleted, 1);
    assert.equal(log.errors, 0);
    rmSync(root, { recursive: true, force: true });
  });
});