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
