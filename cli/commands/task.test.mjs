import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const BIN = resolve(import.meta.dirname, '..', 'bin.mjs');
const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, 'task', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, BIZAR_SKIP_BUILD: '1' },
  });
}

test('task CLI creates, claims, completes, and unblocks dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-task-command-'));
  roots.push(root);
  const db = join(root, 'tasks.sqlite');

  let result = run([
    'create',
    'plan',
    '--title',
    'Plan',
    '--scope',
    'docs/plan.md',
    '--db',
    db,
    '--json',
  ], root);
  assert.equal(result.status, 0, result.stderr);

  result = run([
    'create',
    'build',
    '--title',
    'Build',
    '--scope',
    'src/**',
    '--depends-on',
    'plan',
    '--db',
    db,
    '--json',
  ], root);
  assert.equal(result.status, 0, result.stderr);

  result = run(['ready', '--db', db, '--json'], root);
  assert.deepEqual(JSON.parse(result.stdout).tasks.map((task) => task.id), ['plan']);

  result = run(['claim', 'plan', '--owner', 'paul', '--db', db, '--json'], root);
  assert.equal(result.status, 0, result.stderr);
  result = run([
    'complete',
    'plan',
    '--owner',
    'paul',
    '--evidence',
    'approved',
    '--db',
    db,
    '--json',
  ], root);
  assert.equal(result.status, 0, result.stderr);

  result = run(['ready', '--db', db, '--json'], root);
  assert.deepEqual(JSON.parse(result.stdout).tasks.map((task) => task.id), ['build']);
});

test('task CLI serializes integration queue ownership', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-task-integration-'));
  roots.push(root);
  const db = join(root, 'tasks.sqlite');

  for (const [id, scope, owner] of [
    ['first', 'src/first.ts', 'todd'],
    ['second', 'src/second.ts', 'karen'],
  ]) {
    assert.equal(run([
      'create', id, '--scope', scope, '--db', db, '--json',
    ], root).status, 0);
    assert.equal(run([
      'claim', id, '--owner', owner, '--db', db, '--json',
    ], root).status, 0);
    assert.equal(run([
      'complete', id, '--owner', owner, '--evidence', 'tests passed',
      '--db', db, '--json',
    ], root).status, 0);
    assert.equal(run([
      'integrate', 'enqueue', id, '--commit', `${id}1234`,
      '--owner', owner, '--db', db, '--json',
    ], root).status, 0);
  }

  let result = run([
    'integrate', 'claim', '--worker', 'steve', '--db', db, '--json',
  ], root);
  assert.equal(result.status, 0, result.stderr);
  const first = JSON.parse(result.stdout);
  assert.equal(first.taskId, 'first');

  result = run([
    'integrate', 'claim', '--worker', 'other', '--db', db, '--json',
  ], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INTEGRATION_BUSY/);

  result = run([
    'integrate', 'pass', String(first.id), '--worker', 'steve',
    '--evidence', 'aggregate checks passed', '--db', db, '--json',
  ], root);
  assert.equal(result.status, 0, result.stderr);

  result = run([
    'integrate', 'claim', '--worker', 'steve', '--db', db, '--json',
  ], root);
  assert.equal(JSON.parse(result.stdout).taskId, 'second');
});
