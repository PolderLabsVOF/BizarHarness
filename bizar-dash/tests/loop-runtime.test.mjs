/**
 * tests/loop-runtime.test.mjs
 *
 * Self-check for loop-runtime.mjs (G-autoloop Phase 2).
 * In-memory tasks + injected dispatch — no real bg instances.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'bizar-loops-'));
process.env.BIZAR_LOOPS_ROOT = TMP;

const {
  LOOPS_ROOT,
  genLoopId,
  stateFile,
  createLoop,
  readLoop,
  patchLoop,
  deleteLoop,
  listLoops,
  snapshotLoops,
  pickReadyTasks,
  runTick,
  startLoop,
  stopLoop,
  _dropInProcessTimers,
} = await import('../src/server/loop-runtime.mjs');

after(() => {
  _dropInProcessTimers();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* */ }
});

// ---- CRUD -----------------------------------------------------------------

test('createLoop: requires projectId, writes state.json, returns state', () => {
  assert.throws(() => createLoop({}), TypeError);
  const s = createLoop({ projectId: 'p1', name: 'nightly', intervalMs: 5000 });
  assert.ok(s.loopId.startsWith('loop_'));
  assert.equal(s.projectId, 'p1');
  assert.equal(s.name, 'nightly');
  assert.equal(s.intervalMs, 5000);
  assert.equal(s.status, 'pending');
  assert.equal(s.iteration, 0);
  assert.ok(existsSync(stateFile(s.loopId)));
});

test('createLoop: defaults intervalMs to 30000 and maxIterations to Infinity', () => {
  const s = createLoop({ projectId: 'p1' });
  assert.equal(s.intervalMs, 30000);
  assert.equal(s.maxIterations, Infinity);
});

test('readLoop: returns null for unknown id, state for known', () => {
  assert.equal(readLoop('nope'), null);
  const s = createLoop({ projectId: 'p1' });
  const back = readLoop(s.loopId);
  assert.equal(back.loopId, s.loopId);
  assert.equal(back.projectId, 'p1');
});

test('patchLoop: merges fields, updates updatedAt, rejects unknown', () => {
  const s = createLoop({ projectId: 'p1' });
  const oldUpdatedAt = s.updatedAt;
  // Force monotonic separation in the timestamp
  const waited = Date.now() + 2;
  while (Date.now() < waited) { /* */ }
  const next = patchLoop(s.loopId, { status: 'running', lastTickAt: new Date().toISOString() });
  assert.ok(next);
  assert.equal(next.status, 'running');
  assert.notEqual(next.updatedAt, oldUpdatedAt);
  assert.equal(patchLoop('ghost', { status: 'stopped' }), null);
});

test('deleteLoop: removes the directory and is idempotent', () => {
  const s = createLoop({ projectId: 'p1' });
  assert.ok(existsSync(stateFile(s.loopId)));
  deleteLoop(s.loopId);
  assert.equal(existsSync(stateFile(s.loopId)), false);
  deleteLoop(s.loopId); // no throw
});

test('listLoops + snapshotLoops: enumerate known dirs only', () => {
  const a = createLoop({ projectId: 'p1' });
  const b = createLoop({ projectId: 'p1' });
  const list = listLoops();
  assert.ok(list.includes(a.loopId));
  assert.ok(list.includes(b.loopId));
  const snap = snapshotLoops();
  assert.ok(snap[a.loopId]);
  assert.ok(snap[b.loopId]);
});

test('listLoops: tolerates a stray file at the root (no dir)', () => {
  createLoop({ projectId: 'p1' });
  mkdirSync(LOOPS_ROOT, { recursive: true });
  // Stray non-dir entry should be skipped, not crash.
  writeFileSync(join(LOOPS_ROOT, 'stray.txt'), 'x');
  const list = listLoops();
  assert.ok(!list.includes('stray.txt'));
});

// ---- pickReadyTasks -------------------------------------------------------

test('pickReadyTasks: filters status + archived + unmet deps + sorts by priority then age', () => {
  const t = (id, o = {}) => ({
    id,
    status: o.status || 'queued',
    priority: o.priority ?? 5,
    createdAt: o.createdAt || new Date().toISOString(),
    archived: !!o.archived,
    dependencies: o.dependencies || [],
  });
  const tasks = [
    t('a', { status: 'doing' }),
    t('b', { status: 'queued', archived: true }),
    t('c', { status: 'queued', priority: 2 }),
    t('d', { status: 'queued', priority: 2, createdAt: '2026-01-01T00:00:00Z' }),
    t('e', { status: 'queued', dependencies: ['x'] }),           // dep not in set
    t('f', { status: 'queued', dependencies: ['c'] }),           // c will be queued (not done) — still blocks
    t('g', { status: 'queued', dependencies: ['a'] }),           // a is 'doing' — still blocks
    t('h', { status: 'queued', priority: 1 }),
  ];
  const ready = pickReadyTasks(tasks).map((r) => r.id);
  // c, d are priority 2 and have no deps; h is priority 1 and has no deps.
  // Expected order: h (pri 1), then by age among c/d at pri 2.
  assert.deepEqual(ready, ['h', 'd', 'c']);
});

test('pickReadyTasks: dep that is "done" no longer blocks', () => {
  const t = (id, o = {}) => ({ id, status: o.status || 'queued', dependencies: o.dependencies || [], archived: !!o.archived });
  const tasks = [
    t('dep', { status: 'done' }),
    t('child', { status: 'queued', dependencies: ['dep'] }),
  ];
  const ids = pickReadyTasks(tasks).map((r) => r.id);
  assert.deepEqual(ids, ['child']);
});

test('pickReadyTasks: empty or non-array input returns empty', () => {
  assert.deepEqual(pickReadyTasks([]), []);
  assert.deepEqual(pickReadyTasks(null), []);
  assert.deepEqual(pickReadyTasks(undefined), []);
});

// ---- runTick --------------------------------------------------------------

function fixture(extra) {
  const tasks = extra || [
    { id: 't1', status: 'queued', priority: 1, createdAt: new Date().toISOString() },
    { id: 't2', status: 'doing' },
    { id: 't3', status: 'queued', priority: 3, createdAt: new Date(Date.now() - 1000).toISOString() },
  ];
  let claimed = null;
  const dispatched = [];
  return {
    tasks,
    getTasks: () => tasks.slice(),
    claimTask: (id) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return null;
      t.status = 'doing';
      t.assignee = 'tyr';
      claimed = id;
      return t;
    },
    dispatch: async (task) => {
      dispatched.push(task.id);
      return { ok: true, bgInstanceId: 'bg_' + task.id };
    },
    getClaimed: () => claimed,
    getDispatched: () => dispatched,
  };
}

test('runTick: picks highest-priority queued, claims, dispatches', async () => {
  const f = fixture();
  const result = await runTick(f);
  assert.equal(result.picked, 't1');
  assert.equal(result.dispatched.taskId, 't1');
  assert.equal(result.dispatched.bgInstanceId, 'bg_t1');
  assert.equal(result.iteration, 1);
  assert.equal(result.lastError, null);
  assert.equal(f.getClaimed(), 't1');
  assert.deepEqual(f.getDispatched(), ['t1']);
});

test('runTick: returns null dispatch when no ready tasks', async () => {
  const f = fixture([
    { id: 'x', status: 'doing' },
    { id: 'y', status: 'done' },
  ]);
  const result = await runTick(f);
  assert.equal(result.picked, null);
  assert.equal(result.dispatched, null);
  assert.equal(result.lastError, null);
});

test('runTick: dispatch failure surfaces lastError', async () => {
  const f = fixture();
  f.dispatch = async () => ({ ok: false, error: 'sdk offline' });
  const result = await runTick(f);
  assert.equal(result.picked, 't1');
  assert.equal(result.dispatched, null);
  assert.equal(result.lastError, 'sdk offline');
});

test('runTick: dispatch throwing is caught and converted to lastError', async () => {
  const f = fixture();
  f.dispatch = async () => { throw new Error('boom'); };
  const result = await runTick(f);
  assert.equal(result.picked, 't1');
  assert.equal(result.lastError, 'boom');
});

test('runTick: rejects missing functions', async () => {
  await assert.rejects(() => runTick({}), TypeError);
  await assert.rejects(() => runTick({ getTasks: () => [] }), TypeError);
  await assert.rejects(() => runTick({ getTasks: () => [], claimTask: () => null }), TypeError);
});

// ---- startLoop / stopLoop (in-process scheduler) --------------------------

test('startLoop: marks running, fires onTick, persists state, then stopLoop cancels', async () => {
  const s = createLoop({ projectId: 'p1', intervalMs: 50, maxIterations: 5 });
  const f = fixture();
  const ticks = [];
  startLoop(s.loopId, {
    getTasks: f.getTasks,
    claimTask: f.claimTask,
    dispatch: f.dispatch,
    onTick: (result, state) => ticks.push({ result, state }),
  });
  // Wait for at least one tick.
  await new Promise((r) => setTimeout(r, 120));
  stopLoop(s.loopId);
  assert.ok(ticks.length >= 1);
  const last = readLoop(s.loopId);
  assert.equal(last.status, 'stopped');
  assert.ok(last.iteration >= 1);
  assert.ok(Array.isArray(last.dispatched));
  assert.ok(last.dispatched[0].taskId);
});

test('startLoop: second start is a no-op (timer not duplicated)', () => {
  const s = createLoop({ projectId: 'p1', intervalMs: 1000000 });
  startLoop(s.loopId, { getTasks: () => [], claimTask: () => null, dispatch: async () => ({ ok: true }) });
  const firstRead = readLoop(s.loopId);
  startLoop(s.loopId, { getTasks: () => [], claimTask: () => null, dispatch: async () => ({ ok: true }) });
  const secondRead = readLoop(s.loopId);
  assert.equal(firstRead.status, 'running');
  assert.equal(secondRead.status, 'running');
  stopLoop(s.loopId);
});

test('startLoop: error from getTasks flips status to error and calls onError', async () => {
  const s = createLoop({ projectId: 'p1', intervalMs: 40 });
  const errors = [];
  startLoop(s.loopId, {
    getTasks: () => { throw new Error('disk full'); },
    claimTask: () => null,
    dispatch: async () => ({ ok: true }),
    onError: (err, id) => errors.push({ err: err.message, id }),
  });
  await new Promise((r) => setTimeout(r, 100));
  stopLoop(s.loopId);
  const last = readLoop(s.loopId);
  assert.equal(last.status, 'error');
  assert.equal(last.lastError, 'disk full');
  // Interval is 40ms; with a 100ms wait we expect 2-3 error firings.
  assert.ok(errors.length >= 1, `expected at least 1 error, got ${errors.length}`);
  assert.equal(errors[0].err, 'disk full');
});

test('startLoop: respects maxIterations and stops itself', async () => {
  // Each runTick here always succeeds and advances iteration by 1.
  const s = createLoop({ projectId: 'p1', intervalMs: 30, maxIterations: 2 });
  const f = fixture();
  startLoop(s.loopId, {
    getTasks: f.getTasks,
    claimTask: f.claimTask,
    dispatch: f.dispatch,
  });
  // Wait long enough for a couple of ticks.
  await new Promise((r) => setTimeout(r, 200));
  const last = readLoop(s.loopId);
  assert.equal(last.status, 'stopped');
  assert.ok(last.iteration >= 2);
});

test('stopLoop: idempotent on already-stopped loops', () => {
  const s = createLoop({ projectId: 'p1' });
  patchLoop(s.loopId, { status: 'stopped' });
  const out = stopLoop(s.loopId);
  assert.equal(out.status, 'stopped');
});

test('_dropInProcessTimers: clears every active timer', () => {
  const s = createLoop({ projectId: 'p1', intervalMs: 1000000 });
  startLoop(s.loopId, { getTasks: () => [], claimTask: () => null, dispatch: async () => ({ ok: true }) });
  _dropInProcessTimers();
  // Should be a clean no-op now.
  _dropInProcessTimers();
  // State shouldn't be auto-mutated by dropInProcessTimers.
  const last = readLoop(s.loopId);
  assert.equal(last.status, 'running');
});
