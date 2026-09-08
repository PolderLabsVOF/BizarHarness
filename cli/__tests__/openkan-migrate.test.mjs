/**
 * cli/__tests__/openkan-migrate.test.mjs
 *
 * Tests for the OpenKan v1 → v2 migration path that Bizar exposes via
 * `bizar openkan migrate [--apply] [--tasks|--board]`. The vendored
 * migration scripts under `scripts/openkan/` are exercised end-to-end
 * against a temporary `.ok/` workspace that simulates a v1 layout.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { afterEach } from 'node:test';

const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bizar-openkan-migrate-'));
  roots.push(root);
  return root;
}

function writeV1Task(okDir, id, extra = {}) {
  const tasksDir = join(okDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(join(tasksDir, `${id}.json`), JSON.stringify({
    schema: 'ok.task.v1',
    id,
    title: `Sample ${id}`,
    status: 'pending',
    priority: 'p1',
    ...extra,
  }));
}

function writeLegacyBoard(okDir, tasks) {
  writeFileSync(join(okDir, 'board.json'), JSON.stringify({
    version: 1,
    columns: [],
    tasks,
    sessions: {},
  }));
}

const BIN = new URL('../bin.mjs', import.meta.url).pathname;

test('bizar openkan migrate --help prints usage banner', () => {
  const result = spawnSync(process.execPath, [BIN, 'openkan', 'migrate', '--help'], {
    encoding: 'utf8',
    env: { ...process.env, BIZAR_SKIP_BUILD: '1' },
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout + result.stderr, /Migrate v1 tasks\/board to v2 layout/);
});

test('dry-run leaves v1 files in place and prints the report', () => {
  const root = fixture();
  const okDir = join(root, '.ok');
  mkdirSync(okDir, { recursive: true });
  writeV1Task(okDir, 'tsk-dry');

  const result = spawnSync(process.execPath, [BIN, 'openkan', 'migrate'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BIZAR_SKIP_BUILD: '1' },
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout + result.stderr, /dry-run/i);
  assert.match(result.stdout + result.stderr, /scanned 1 legacy v1/);
  // v1 file should still be present after dry-run
  assert.equal(existsSync(join(okDir, 'tasks', 'tsk-dry.json')), true,
    'dry-run must not move v1 files');
  // v2 directory must NOT exist
  assert.equal(existsSync(join(okDir, 'tasks', 'tsk-dry', 'task.json')), false,
    'dry-run must not create v2 files');
});

test('--apply migrates v1 flat files into v2 directory layout with backup', () => {
  const root = fixture();
  const okDir = join(root, '.ok');
  mkdirSync(okDir, { recursive: true });
  writeV1Task(okDir, 'tsk-apply', { title: 'Apply me', priority: 'p1' });

  const result = spawnSync(process.execPath, [BIN, 'openkan', 'migrate', '--apply'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BIZAR_SKIP_BUILD: '1' },
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout + result.stderr, /migrated 1/);

  const v2File = join(okDir, 'tasks', 'tsk-apply', 'task.json');
  assert.equal(existsSync(v2File), true, 'v2 task.json must exist after --apply');
  const v2 = JSON.parse(readFileSync(v2File, 'utf8'));
  assert.equal(v2.schema, 'ok.task.v2');
  assert.equal(v2.id, 'tsk-apply');
  assert.equal(v2.title, 'Apply me');
  // p1 must map to high under the v2 enum
  assert.equal(v2.priority, 'high');
  // Original v1 file should be backed up inside the new directory
  assert.equal(existsSync(join(okDir, 'tasks', 'tsk-apply', 'task.v1.json')), true);
  // v1 flat file should be gone from the parent directory
  assert.equal(existsSync(join(okDir, 'tasks', 'tsk-apply.json')), false,
    'v1 flat file should have been moved into the backup location');
});

test('--tasks scope runs only the task migration, not the board migration', () => {
  const root = fixture();
  const okDir = join(root, '.ok');
  mkdirSync(okDir, { recursive: true });
  writeV1Task(okDir, 'tsk-scope');
  writeLegacyBoard(okDir, [{ id: 'tsk-scope-board', title: 'Board task', status: 'doing', column: 'doing', order: 0, priority: 'p2' }]);

  const result = spawnSync(process.execPath, [BIN, 'openkan', 'migrate', '--apply', '--tasks'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BIZAR_SKIP_BUILD: '1' },
  });
  assert.equal(result.status, 0);
  // Tasks migrated
  assert.equal(existsSync(join(okDir, 'tasks', 'tsk-scope', 'task.json')), true);
  // Board NOT migrated
  assert.equal(existsSync(join(okDir, 'board.json')), true,
    '--tasks scope must leave board.json in place');
});

test('--board scope runs only the board migration', () => {
  const root = fixture();
  const okDir = join(root, '.ok');
  mkdirSync(okDir, { recursive: true });
  writeV1Task(okDir, 'tsk-board-scope');
  writeLegacyBoard(okDir, [{ id: 'tsk-board-only', title: 'Board only', status: 'todo', column: 'todo', order: 0, priority: 'normal' }]);

  const result = spawnSync(process.execPath, [BIN, 'openkan', 'migrate', '--apply', '--board'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BIZAR_SKIP_BUILD: '1' },
  });
  assert.equal(result.status, 0);
  // Board migrated to per-task directory
  assert.equal(existsSync(join(okDir, 'tasks', 'tsk-board-only', 'task.json')), true);
  // Tasks flat files NOT migrated
  assert.equal(existsSync(join(okDir, 'tasks', 'tsk-board-scope.json')), true,
    '--board scope must leave v1 task files in place');
});

test('read adapter returns [] when no .ok/ workspace exists', () => {
  const root = fixture();
  const result = spawnSync(process.execPath, [BIN, 'openkan', 'migrate', '--apply'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BIZAR_SKIP_BUILD: '1' },
  });
  // No .ok/ → no tasks/ → 0 scanned → 0 migrated → 0 errors → exit 0
  assert.equal(result.status, 0, `expected exit 0 on missing .ok/, got ${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout + result.stderr, /scanned 0 legacy v1/);
});
