import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

import {
  TaskLedger,
  TaskLedgerError,
  resolveTaskDatabase,
} from '../task-ledger.mjs';

const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bizar-task-ledger-'));
  roots.push(root);
  let now = Date.parse('2026-07-30T10:00:00.000Z');
  const ledger = new TaskLedger({
    dbPath: join(root, 'tasks.sqlite'),
    now: () => now,
  });
  return {
    root,
    ledger,
    advance(ms) { now += ms; },
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) =>
    error instanceof TaskLedgerError && error.code === code);
}

describe('durable task DAG', () => {
  test('only dependency-ready tasks can be claimed', () => {
    const { root, ledger } = fixture();
    ledger.createTask({
      id: 'design',
      title: 'Define contract',
      scopes: ['docs/contract.md'],
    });
    ledger.createTask({
      id: 'implementation',
      title: 'Implement contract',
      scopes: ['packages/sdk/**'],
      dependencies: ['design'],
    });

    assert.deepEqual(ledger.listReady().map((task) => task.id), ['design']);
    expectCode(
      () => ledger.claimTask({
        taskId: 'implementation',
        owner: 'karen',
        workspace: join(root, 'implementation'),
      }),
      'DEPENDENCY_BLOCKED',
    );

    ledger.claimTask({
      taskId: 'design',
      owner: 'paul',
      workspace: join(root, 'design'),
    });
    ledger.completeTask({
      taskId: 'design',
      owner: 'paul',
      evidence: 'contract reviewed',
    });

    assert.deepEqual(ledger.listReady().map((task) => task.id), ['implementation']);
  });

  test('overlapping live path scopes are rejected while disjoint scopes run', () => {
    const { root, ledger } = fixture();
    ledger.createTask({ id: 'sdk-a', title: 'SDK A', scopes: ['packages/sdk/**'] });
    ledger.createTask({ id: 'sdk-b', title: 'SDK B', scopes: ['packages/sdk/src/index.ts'] });
    ledger.createTask({ id: 'cli', title: 'CLI', scopes: ['cli/**'] });

    ledger.claimTask({
      taskId: 'sdk-a',
      owner: 'todd',
      workspace: join(root, 'sdk-a'),
    });
    expectCode(
      () => ledger.claimTask({
        taskId: 'sdk-b',
        owner: 'karen',
        workspace: join(root, 'sdk-b'),
      }),
      'SCOPE_CONFLICT',
    );

    const claimed = ledger.claimTask({
      taskId: 'cli',
      owner: 'brenda',
      workspace: join(root, 'cli'),
    });
    assert.equal(claimed.state, 'active');
  });

  test('expired leases return tasks and scopes to the ready pool', () => {
    const { root, ledger, advance } = fixture();
    ledger.createTask({ id: 'first', title: 'First', scopes: ['src/**'] });
    ledger.createTask({ id: 'second', title: 'Second', scopes: ['src/index.ts'] });
    ledger.claimTask({
      taskId: 'first',
      owner: 'todd',
      workspace: join(root, 'first'),
      leaseMs: 1_000,
    });

    advance(1_001);
    assert.equal(ledger.sweepExpiredLeases(), 1);
    assert.equal(ledger.getTask('first').state, 'pending');

    const claimed = ledger.claimTask({
      taskId: 'second',
      owner: 'karen',
      workspace: join(root, 'second'),
    });
    assert.equal(claimed.owner, 'karen');
  });

  test('cross-process claims serialize overlapping scopes', async () => {
    const { root, ledger } = fixture();
    ledger.createTask({ id: 'left', title: 'Left', scopes: ['packages/**'] });
    ledger.createTask({ id: 'right', title: 'Right', scopes: ['packages/sdk/**'] });

    const moduleUrl = new URL('../task-ledger.mjs', import.meta.url).href;
    const program = `
      import { TaskLedger } from ${JSON.stringify(moduleUrl)};
      const [dbPath, taskId, workspace] = process.argv.slice(1);
      const ledger = new TaskLedger({ dbPath });
      try {
        ledger.claimTask({ taskId, owner: taskId, workspace });
        process.stdout.write(JSON.stringify({ ok: true, taskId }));
      } catch (error) {
        process.stdout.write(JSON.stringify({ ok: false, code: error.code }));
        process.exitCode = 2;
      } finally {
        ledger.close();
      }
    `;
    const run = (taskId) => new Promise((resolveResult) => {
      const child = spawn(process.execPath, [
        '--input-type=module',
        '-e',
        program,
        ledger.dbPath,
        taskId,
        join(root, taskId),
      ], { encoding: 'utf8' });
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.on('close', (code) => resolveResult({ code, result: JSON.parse(stdout) }));
    });

    const results = await Promise.all([run('left'), run('right')]);
    assert.equal(results.filter((result) => result.result.ok).length, 1);
    assert.equal(
      results.filter((result) => result.result.code === 'SCOPE_CONFLICT').length,
      1,
    );
  });

  test('edit authorization enforces the current workspace scope and sibling claims', () => {
    const { root, ledger } = fixture();
    const main = join(root, 'main');
    const isolated = join(root, 'isolated');
    mkdirSync(join(main, 'src'), { recursive: true });
    mkdirSync(join(isolated, 'src'), { recursive: true });
    mkdirSync(join(isolated, 'docs'), { recursive: true });

    ledger.createTask({ id: 'source', title: 'Source', scopes: ['src/**'] });
    ledger.claimTask({
      taskId: 'source',
      owner: 'todd',
      workspace: isolated,
    });

    assert.equal(ledger.authorizeEdit({
      cwd: isolated,
      filePath: join(isolated, 'src', 'index.ts'),
    }).allowed, true);

    assert.equal(ledger.authorizeEdit({
      cwd: isolated,
      filePath: join(isolated, 'docs', 'design.md'),
    }).reason, 'OUT_OF_SCOPE');

    assert.equal(ledger.authorizeEdit({
      cwd: main,
      filePath: join(main, 'src', 'index.ts'),
    }).reason, 'SCOPE_OWNED');
  });
});

test('all worktrees resolve the same Git-common task database', () => {
  const parent = mkdtempSync(join(tmpdir(), 'bizar-task-common-'));
  roots.push(parent);
  const main = join(parent, 'main');
  const isolated = join(parent, 'isolated');
  mkdirSync(main);

  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git(main, 'init', '-q');
  git(main, 'config', 'user.email', 'tests@bizar.local');
  git(main, 'config', 'user.name', 'Bizar Tests');
  writeFileSync(join(main, 'README.md'), '# fixture\n');
  git(main, 'add', 'README.md');
  git(main, 'commit', '-qm', 'test: seed task fixture');
  git(main, 'worktree', 'add', '-q', '-b', 'task-test', isolated);

  assert.equal(resolveTaskDatabase(main), resolveTaskDatabase(isolated));
});
