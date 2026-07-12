/**
 * src/server/goals-store.test.mjs
 *
 * F-041 — node:test coverage for the goals-store. Run with:
 *   node --test bizar-dash/src/server/goals-store.test.mjs
 *
 * Covers (≥10 cases):
 *   1.  create → get returns the same row with id + timestamps
 *   2.  create rejects missing/oversized title
 *   3.  list returns goals in createdAt-desc order
 *   4.  update patches title/description/status/priority
 *   5.  archive soft-archives (status='archived'); default list excludes
 *   6.  per-project isolation: project A and B have separate stores
 *   7.  linkTask sets task.goalId; returns the updated task
 *   8.  unlinkTask clears task.goalId
 *   9.  setTasks bulk-links; unlinks tasks not in the new set
 *   10. progress counts done/blocked/inProgress/archived; percent correct
 *   11. _assertNoCycle throws on cycle; passes on valid parent
 *   12. filter by status / owner / parentGoalId
 *   13. missing goal returns null without crashing
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { goalsStore } from './goals-store.mjs';
import { tasksStore } from './tasks-store.mjs';

let tmpHome;
let prevHome;

before(() => {
  prevHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'f041-goals-store-'));
  process.env.HOME = tmpHome;
});

after(() => {
  process.env.HOME = prevHome;
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

function pid() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

test('create then get returns the same row with id + timestamps', async () => {
  const projectId = pid();
  const goal = await goalsStore.create(projectId, { title: 'Ship F-041', priority: 'high' });
  assert.ok(goal.id.startsWith('goal_'));
  assert.equal(goal.title, 'Ship F-041');
  assert.equal(goal.priority, 'high');
  assert.equal(goal.status, 'active');
  assert.ok(typeof goal.createdAt === 'string');
  assert.ok(typeof goal.updatedAt === 'string');
  assert.equal(goal.completedAt, null);

  const fetched = goalsStore.get(projectId, goal.id);
  assert.equal(fetched.id, goal.id);
  assert.equal(fetched.title, 'Ship F-041');
});

test('create rejects missing or oversized title', async () => {
  const projectId = pid();
  await assert.rejects(() => goalsStore.create(projectId, {}), /title required/);
  await assert.rejects(() => goalsStore.create(projectId, { title: '' }), /title required/);
  await assert.rejects(() => goalsStore.create(projectId, { title: 'x'.repeat(201) }), /title required/);
});

test('list returns goals sorted by createdAt descending', async () => {
  const projectId = pid();
  const a = await goalsStore.create(projectId, { title: 'A' });
  // Make the timestamps differ by a tick so the sort is deterministic.
  await new Promise((r) => setTimeout(r, 5));
  const b = await goalsStore.create(projectId, { title: 'B' });
  const list = goalsStore.list(projectId);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, b.id);
  assert.equal(list[1].id, a.id);
});

test('update patches title/description/status/priority and bumps updatedAt', async () => {
  const projectId = pid();
  const g = await goalsStore.create(projectId, { title: 'before' });
  const before = g.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  const updated = await goalsStore.update(projectId, g.id, {
    title: 'after',
    description: 'desc',
    status: 'completed',
    priority: 'low',
  });
  assert.equal(updated.title, 'after');
  assert.equal(updated.description, 'desc');
  assert.equal(updated.status, 'completed');
  assert.equal(updated.priority, 'low');
  assert.ok(updated.completedAt, 'completedAt should be set when status flips to completed');
  assert.notEqual(updated.updatedAt, before);
});

test('archive soft-archives; default list excludes archived goals', async () => {
  const projectId = pid();
  const g = await goalsStore.create(projectId, { title: 'Archive me' });
  const archived = await goalsStore.archive(projectId, g.id);
  assert.equal(archived.status, 'archived');

  const def = goalsStore.list(projectId);
  assert.equal(def.find((x) => x.id === g.id), undefined);

  const all = goalsStore.list(projectId, { includeArchived: true });
  assert.ok(all.find((x) => x.id === g.id));
});

test('per-project isolation: project A and B have separate stores', async () => {
  const a = pid();
  const b = pid();
  await goalsStore.create(a, { title: 'A1' });
  await goalsStore.create(a, { title: 'A2' });
  await goalsStore.create(b, { title: 'B1' });
  const aList = goalsStore.list(a);
  const bList = goalsStore.list(b);
  assert.equal(aList.length, 2);
  assert.equal(bList.length, 1);
  assert.ok(aList.every((g) => g.title.startsWith('A')));
  assert.ok(bList.every((g) => g.title.startsWith('B')));
});

test('linkTask sets task.goalId; returns the updated task', async () => {
  const projectId = pid();
  const goal = await goalsStore.create(projectId, { title: 'Goal for linking' });
  const task = await tasksStore.create(projectId, { title: 'linked task' });
  assert.equal(task.goalId, null);
  const linked = await goalsStore.linkTask(projectId, goal.id, task.id);
  assert.ok(linked);
  assert.equal(linked.goalId, goal.id);
  // Activity row should be appended for the link transition.
  const activity = linked.activity || [];
  assert.ok(activity.some((a) => a.type === 'goal-link' && a.data && a.data.to === goal.id));
});

test('unlinkTask clears task.goalId', async () => {
  const projectId = pid();
  const goal = await goalsStore.create(projectId, { title: 'unlink test' });
  const task = await tasksStore.create(projectId, { title: 'to-unlink', goalId: goal.id });
  assert.equal(task.goalId, goal.id);
  const unlinked = await goalsStore.unlinkTask(projectId, goal.id, task.id);
  assert.equal(unlinked.goalId, null);
});

test('setTasks bulk-links; unlinks tasks not in the new set', async () => {
  const projectId = pid();
  const goal = await goalsStore.create(projectId, { title: 'setTasks' });
  const t1 = await tasksStore.create(projectId, { title: 't1' });
  const t2 = await tasksStore.create(projectId, { title: 't2' });
  const t3 = await tasksStore.create(projectId, { title: 't3' });

  // Link t1 + t2 + t3 to start.
  const first = await goalsStore.setTasks(projectId, goal.id, [t1.id, t2.id, t3.id]);
  assert.equal(first.linked, 3);
  assert.equal(first.unlinked, 0);

  // Now reduce to just t2 + t3.
  const second = await goalsStore.setTasks(projectId, goal.id, [t2.id, t3.id]);
  assert.equal(second.linked, 0);
  assert.equal(second.unlinked, 1);

  const linked = tasksStore.getByGoalId(projectId, goal.id).map((t) => t.id).sort();
  assert.deepEqual(linked, [t2.id, t3.id].sort());

  // Verify t1 is now unlinked.
  const t1After = await tasksStore.getById(projectId, t1.id);
  assert.equal(t1After.goalId, null);
});

test('progress counts done/blocked/inProgress/archived; percent correct', async () => {
  const projectId = pid();
  const goal = await goalsStore.create(projectId, { title: 'progress' });
  const a = await tasksStore.create(projectId, { title: 'a', goalId: goal.id });
  const b = await tasksStore.create(projectId, { title: 'b', goalId: goal.id });
  const c = await tasksStore.create(projectId, { title: 'c', goalId: goal.id });
  const d = await tasksStore.create(projectId, { title: 'd', goalId: goal.id });
  await tasksStore.update(projectId, a.id, { status: 'done' });
  await tasksStore.update(projectId, b.id, { status: 'blocked' });
  await tasksStore.update(projectId, c.id, { status: 'doing' });
  // d stays in queued

  const p = goalsStore.progress(projectId, goal.id);
  assert.equal(p.total, 4);
  assert.equal(p.done, 1);
  assert.equal(p.blocked, 1);
  assert.equal(p.inProgress, 1);
  assert.equal(p.archived, 0);
  assert.equal(p.percent, 25);
});

test('progress excludes archived from total but counts them separately', async () => {
  const projectId = pid();
  const goal = await goalsStore.create(projectId, { title: 'archive rollup' });
  const a = await tasksStore.create(projectId, { title: 'a', goalId: goal.id });
  const b = await tasksStore.create(projectId, { title: 'b', goalId: goal.id });
  await tasksStore.update(projectId, a.id, { status: 'done' });
  await tasksStore.update(projectId, b.id, { status: 'archived' });
  const p = goalsStore.progress(projectId, goal.id);
  assert.equal(p.total, 1);
  assert.equal(p.archived, 1);
  assert.equal(p.done, 1);
  assert.equal(p.percent, 100);
});

test('_assertNoCycle throws on cycle; passes on valid parent', () => {
  const projectId = pid();
  return (async () => {
    const a = await goalsStore.create(projectId, { title: 'A' });
    const b = await goalsStore.create(projectId, { title: 'B' });
    // A → B is fine
    goalsStore._assertNoCycle(projectId, a.id, b.id);
    // B → A would create a 2-cycle
    await goalsStore.update(projectId, b.id, { parentGoalId: a.id });
    assert.throws(
      () => goalsStore._assertNoCycle(projectId, a.id, b.id),
      /cycle_detected/,
    );
    // Self-link also a cycle.
    assert.throws(
      () => goalsStore._assertNoCycle(projectId, a.id, a.id),
      /cycle_detected/,
    );
    // Null parent is fine (unsetting).
    goalsStore._assertNoCycle(projectId, a.id, null);
    // Non-existent parent throws parent_goal_not_found.
    assert.throws(
      () => goalsStore._assertNoCycle(projectId, a.id, 'goal_does_not_exist'),
      /parent_goal_not_found/,
    );
  })();
});

test('list filters by status, owner, and parentGoalId', async () => {
  const projectId = pid();
  const parent = await goalsStore.create(projectId, { title: 'parent' });
  const child = await goalsStore.create(projectId, { title: 'child', parentGoalId: parent.id });
  const other = await goalsStore.create(projectId, { title: 'other' });
  await goalsStore.update(projectId, child.id, { owner: 'odin' });
  await goalsStore.update(projectId, other.id, { owner: 'thor' });

  const active = goalsStore.list(projectId, { status: 'active' });
  assert.equal(active.length, 3);

  const archived = await goalsStore.archive(projectId, other.id);
  assert.equal(archived.status, 'archived');
  const afterArchive = goalsStore.list(projectId, { status: 'archived' });
  assert.equal(afterArchive.length, 1);

  const ownerOdin = goalsStore.list(projectId, { owner: 'odin' });
  assert.equal(ownerOdin.length, 1);
  assert.equal(ownerOdin[0].id, child.id);

  const childrenOfParent = goalsStore.list(projectId, { parentGoalId: parent.id });
  assert.equal(childrenOfParent.length, 1);
  assert.equal(childrenOfParent[0].id, child.id);

  const noParent = goalsStore.list(projectId, { parentGoalId: null });
  // parent itself + the archived 'other' have no parent.
  assert.ok(noParent.length >= 2);
});

test('get returns null when id is missing or unknown', () => {
  const projectId = pid();
  assert.equal(goalsStore.get(projectId, ''), null);
  assert.equal(goalsStore.get(projectId, 'goal_nope'), null);
  assert.equal(goalsStore.get(projectId, null), null);
});

test('update returns null when goal does not exist', async () => {
  const projectId = pid();
  const r = await goalsStore.update(projectId, 'goal_missing', { title: 'x' });
  assert.equal(r, null);
});