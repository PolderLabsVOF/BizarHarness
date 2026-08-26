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

  test('edit authorization enforces sibling claims and allows the claimant to edit freely', () => {
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

    // Active task's own scope: ALLOWED (claim against others, not self).
    assert.equal(ledger.authorizeEdit({
      cwd: isolated,
      filePath: join(isolated, 'src', 'index.ts'),
    }).allowed, true);

    // Active task editing outside its own scope: ALLOWED (F-200
    // loosening — scope is a sibling claim, not a self-restriction).
    assert.equal(ledger.authorizeEdit({
      cwd: isolated,
      filePath: join(isolated, 'docs', 'design.md'),
    }).allowed, true);

    // Different workspace, file in active task's scope: DENIED with
    // SCOPE_OWNED — the scope still blocks sibling workers.
    assert.equal(ledger.authorizeEdit({
      cwd: main,
      filePath: join(main, 'src', 'index.ts'),
    }).reason, 'SCOPE_OWNED');
  });

  test('expired leases fall through to TASK_REQUIRED when caller requires a task', () => {
    const { root, ledger, advance } = fixture();
    const main = join(root, 'main');
    const isolated = join(root, 'isolated');
    mkdirSync(join(main, 'src'), { recursive: true });
    mkdirSync(join(isolated, 'src'), { recursive: true });

    ledger.createTask({ id: 'source', title: 'Source', scopes: ['src/**'] });
    ledger.claimTask({
      taskId: 'source',
      owner: 'todd',
      workspace: isolated,
      leaseMs: 1_000,
    });
    advance(1_001);

    // F-200: LEASE_EXPIRED is no longer a separate code — expired leases
    // fall through to the reserved-scope check. With requireTask=true
    // and no live reservation, the result is TASK_REQUIRED.
    assert.equal(ledger.authorizeEdit({
      cwd: isolated,
      filePath: join(isolated, 'src', 'index.ts'),
      requireTask: true,
    }).reason, 'TASK_REQUIRED');

    ledger.sweepExpiredLeases();
    // After sweep the task is back to `pending`. With no active claim
    // and no scope owner, requireTask=true still yields TASK_REQUIRED.
    assert.equal(ledger.authorizeEdit({
      cwd: isolated,
      filePath: join(isolated, 'src', 'index.ts'),
      requireTask: true,
    }).reason, 'TASK_REQUIRED');

    // With requireTask=false the same edit is allowed (F-200 loosening).
    assert.equal(ledger.authorizeEdit({
      cwd: isolated,
      filePath: join(isolated, 'src', 'index.ts'),
      requireTask: false,
    }).allowed, true);
  });

  test('linked worktree edits require a task and completed scopes are released', () => {
    const { root, ledger } = fixture();
    const main = join(root, 'main');
    const unclaimed = join(root, 'unclaimed');
    const completed = join(root, 'completed');
    mkdirSync(join(main, 'src'), { recursive: true });
    mkdirSync(join(unclaimed, 'src'), { recursive: true });
    mkdirSync(join(completed, 'src'), { recursive: true });

    assert.equal(ledger.authorizeEdit({
      cwd: unclaimed,
      filePath: join(unclaimed, 'src', 'index.ts'),
      requireTask: true,
    }).reason, 'TASK_REQUIRED');

    ledger.createTask({ id: 'done', title: 'Done', scopes: ['src/**'] });
    ledger.claimTask({ taskId: 'done', owner: 'todd', workspace: completed });
    ledger.completeTask({ taskId: 'done', owner: 'todd', evidence: 'tests pass' });

    // F-200 loosening: completed tasks no longer reserve scopes. A
    // sibling worker can now edit the same path in the main repo.
    assert.equal(ledger.authorizeEdit({
      cwd: main,
      repoRoot: main,
      filePath: join(main, 'src', 'index.ts'),
    }).allowed, true);
  });
});

describe('serialized integration queue', () => {
  function completedTask(fixtureState, id, scope, owner = 'todd') {
    const { root, ledger } = fixtureState;
    ledger.createTask({ id, title: id, scopes: [scope] });
    ledger.claimTask({
      taskId: id,
      owner,
      workspace: join(root, id),
    });
    ledger.completeTask({
      taskId: id,
      owner,
      evidence: `${id} tests passed`,
    });
  }

  test('only one integration item is active and queued work remains FIFO', () => {
    const state = fixture();
    completedTask(state, 'first', 'src/first.ts');
    completedTask(state, 'second', 'src/second.ts');
    state.ledger.enqueueIntegration({
      taskId: 'first',
      commitSha: '1111111',
      submittedBy: 'todd',
    });
    state.advance(1);
    state.ledger.enqueueIntegration({
      taskId: 'second',
      commitSha: '2222222',
      submittedBy: 'karen',
    });

    const first = state.ledger.claimNextIntegration({ worker: 'steve' });
    assert.equal(first.taskId, 'first');
    expectCode(
      () => state.ledger.claimNextIntegration({ worker: 'other-integrator' }),
      'INTEGRATION_BUSY',
    );

    state.ledger.finishIntegration({
      queueId: first.id,
      worker: 'steve',
      success: true,
      evidence: 'make check passed after cherry-pick',
    });
    assert.equal(state.ledger.getTask('first').state, 'integrated');

    const second = state.ledger.claimNextIntegration({ worker: 'steve' });
    assert.equal(second.taskId, 'second');
  });

  test('integration failure returns work to the original owner with a repair lease', () => {
    const state = fixture();
    completedTask(state, 'failing', 'src/failing.ts', 'karen');
    state.ledger.enqueueIntegration({
      taskId: 'failing',
      commitSha: 'abcdef1',
      submittedBy: 'karen',
      verifyCommand: 'make check',
    });

    const item = state.ledger.claimNextIntegration({ worker: 'steve' });
    const failed = state.ledger.finishIntegration({
      queueId: item.id,
      worker: 'steve',
      success: false,
      error: 'aggregate typecheck failed',
    });

    assert.equal(failed.status, 'failed');
    const task = state.ledger.getTask('failing');
    assert.equal(task.state, 'active');
    assert.equal(task.owner, 'karen');
    assert.equal(task.blocker, 'aggregate typecheck failed');
    assert.ok(task.leaseExpiresAt > Date.parse('2026-07-30T10:00:00.000Z'));
  });

  test('incomplete tasks cannot enter integration', () => {
    const state = fixture();
    state.ledger.createTask({ id: 'active', title: 'Active', scopes: ['src/**'] });
    expectCode(
      () => state.ledger.enqueueIntegration({
        taskId: 'active',
        commitSha: 'abcdef1',
        submittedBy: 'todd',
      }),
      'TASK_NOT_COMPLETED',
    );
  });

  test('integration does not reactivate a scope claimed after queueing', () => {
    const state = fixture();
    completedTask(state, 'queued', 'src/**');
    state.ledger.enqueueIntegration({
      taskId: 'queued',
      commitSha: 'abcdef1',
      submittedBy: 'todd',
    });

    state.advance(30 * 60 * 1_000 + 1);
    state.ledger.createTask({
      id: 'new-owner',
      title: 'New owner',
      scopes: ['src/index.ts'],
    });
    state.ledger.claimTask({
      taskId: 'new-owner',
      owner: 'karen',
      workspace: join(state.root, 'new-owner'),
    });

    expectCode(
      () => state.ledger.claimNextIntegration({ worker: 'steve' }),
      'INTEGRATION_SCOPE_CONFLICT',
    );
  });

  test('cross-process integrators cannot claim queue work concurrently', async () => {
    const state = fixture();
    completedTask(state, 'queued', 'src/queued.ts');
    state.ledger.enqueueIntegration({
      taskId: 'queued',
      commitSha: 'abcdef1',
      submittedBy: 'todd',
    });

    const moduleUrl = new URL('../task-ledger.mjs', import.meta.url).href;
    const program = `
      import { TaskLedger } from ${JSON.stringify(moduleUrl)};
      const [dbPath, worker] = process.argv.slice(1);
      const ledger = new TaskLedger({ dbPath });
      try {
        const item = ledger.claimNextIntegration({ worker });
        process.stdout.write(JSON.stringify({ ok: true, id: item.id }));
      } catch (error) {
        process.stdout.write(JSON.stringify({ ok: false, code: error.code }));
        process.exitCode = 2;
      } finally {
        ledger.close();
      }
    `;
    const run = (worker) => new Promise((resolveResult) => {
      const child = spawn(process.execPath, [
        '--input-type=module',
        '-e',
        program,
        state.ledger.dbPath,
        worker,
      ]);
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.on('close', (code) => resolveResult({ code, result: JSON.parse(stdout) }));
    });

    const results = await Promise.all([run('steve-a'), run('steve-b')]);
    assert.equal(results.filter((result) => result.result.ok).length, 1);
    assert.equal(
      results.filter((result) => result.result.code === 'INTEGRATION_BUSY').length,
      1,
    );
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
