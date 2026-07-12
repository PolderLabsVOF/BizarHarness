/**
 * src/server/routes/goals.test.mjs
 *
 * F-041 — node:test coverage for routes/goals.mjs. Run with:
 *   node --test bizar-dash/src/server/routes/goals.test.mjs
 *
 * Covers (≥10 cases):
 *   1.  GET /goals returns empty array for fresh project
 *   2.  POST /goals 400 on missing title; 201 on valid
 *   3.  POST /goals/:id/tasks bulk-link with body {taskIds}; returns count
 *   4.  POST /goals/:id/refine returns plan (no persist)
 *   5.  POST /goals/from-plan with persist:false returns suggested tasks; nothing created
 *   6.  POST /goals/from-plan with persist:true creates goal + linked tasks
 *   7.  GET /goals/:id/progress returns {total,done,percent}
 *   8.  DELETE /goals/:id soft-archives (status='archived'); row still in store
 *   9.  PATCH parentGoalId cycle returns 400 cycle_detected
 *   10. Cross-project isolation: projectId query scopes correctly
 *   11. PATCH /goals/:id emits goal:change + goal:progress WS events
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGoalsRouter } from './goals.mjs';
import { tasksStore } from '../tasks-store.mjs';

let tmpHome;
let prevHome;

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    end() { this.body = null; return this; },
  };
  return res;
}

before(() => {
  prevHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'f041-goals-routes-'));
  process.env.HOME = tmpHome;
});

after(() => {
  process.env.HOME = prevHome;
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

function setupRouter() {
  const broadcasts = [];
  const router = createGoalsRouter({ broadcast: (evt) => broadcasts.push(evt) });
  return { router, broadcasts };
}

function invoke(router, { method, url, body }) {
  return new Promise((resolve, reject) => {
    const pathOnly = url.replace(/\?.*$/, '');
    const candidates = [];
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const r = layer.route;
      if (!r.methods) continue;
      const m = method.toLowerCase();
      if (!r.methods[m]) continue;
      if (matchesPath(r.path, pathOnly)) {
        candidates.push(r);
      }
    }
    if (!candidates.length) {
      reject(new Error(`No route matched ${method} ${url}`));
      return;
    }
    // Express matches in registration order — pick the FIRST match
    // for path patterns of equal length, longest overall wins.
    candidates.sort((a, b) => b.path.length - a.path.length);
    const handler = candidates[0].stack[0].handle;
    const req = {
      params: paramMap(pathOnly),
      body: body || {},
      query: queryMap(url),
    };
    const res = mockRes();
    Promise.resolve(handler(req, res, () => {})).then(() => resolve(res), reject);
  });
}

function matchesPath(pattern, path) {
  if (pattern === path) return true;
  const re = new RegExp(
    '^' + pattern.replace(/[.+*?^$()|[\]{}\\]/g, '\\$&').replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '([^/]+)') + '$',
  );
  return re.test(path);
}

function paramMap(path) {
  // Pull all :param captures out of /goals/:id[/tasks[/taskId]] paths.
  const out = {};
  const m = /^\/goals\/([^/?]+)(?:\/([^/?]+))?(?:\/([^/?]+))?$/.exec(path);
  if (m) {
    if (m[1]) out.id = m[1];
    if (m[2]) out.sub = m[2];
    if (m[3]) out.taskId = m[3];
  }
  return out;
}

function queryMap(url) {
  const idx = url.indexOf('?');
  if (idx < 0) return {};
  const out = {};
  for (const part of url.slice(idx + 1).split('&')) {
    const [k, v] = part.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return out;
}

function pid() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

test('GET /goals returns empty array for a fresh project', async () => {
  const { router } = setupRouter();
  const projectId = pid();
  const res = await invoke(router, { method: 'GET', url: `/goals?projectId=${projectId}` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.goals, []);
  assert.equal(res.body.projectId, projectId);
});

test('GET /goals requires projectId (400 when missing)', async () => {
  const { router } = setupRouter();
  const res = await invoke(router, { method: 'GET', url: '/goals' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_request');
});

test('POST /goals 400 on missing title; 201 on valid', async () => {
  const { router, broadcasts } = setupRouter();
  const projectId = pid();
  const bad = await invoke(router, { method: 'POST', url: '/goals', body: { projectId } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, 'bad_request');

  const good = await invoke(router, {
    method: 'POST',
    url: '/goals',
    body: { projectId, title: 'Ship F-041', priority: 'high' },
  });
  assert.equal(good.statusCode, 201);
  assert.equal(good.body.title, 'Ship F-041');
  assert.equal(good.body.priority, 'high');
  assert.ok(good.body.id.startsWith('goal_'));
  // Broadcast emitted.
  assert.ok(broadcasts.some((b) => b.type === 'goal:change' && b.goal && b.goal.id === good.body.id));
});

test('POST /goals/:id/tasks bulk-link with {taskIds}; returns count', async () => {
  const { router, broadcasts } = setupRouter();
  const projectId = pid();
  const g = await invoke(router, { method: 'POST', url: '/goals', body: { projectId, title: 'G' } });
  const goalId = g.body.id;
  const t1 = await tasksStore.create(projectId, { title: 't1' });
  const t2 = await tasksStore.create(projectId, { title: 't2' });
  const link = await invoke(router, {
    method: 'POST',
    url: `/goals/${goalId}/tasks?projectId=${projectId}`,
    body: { taskIds: [t1.id, t2.id] },
  });
  assert.equal(link.statusCode, 200);
  assert.equal(link.body.count, 2);
  assert.deepEqual(link.body.taskIds.sort(), [t1.id, t2.id].sort());
  // Broadcast emitted.
  assert.ok(broadcasts.some((b) => b.type === 'goal:tasks-linked' && b.goalId === goalId));
  assert.ok(broadcasts.some((b) => b.type === 'goal:progress' && b.goalId === goalId));
});

test('POST /goals/:id/refine returns plan (no persist)', async () => {
  const { router } = setupRouter();
  const projectId = pid();
  const g = await invoke(router, {
    method: 'POST',
    url: '/goals',
    body: { projectId, title: 'Ship it', description: 'Build the dashboard, test it, deploy it' },
  });
  // Pass an explicit text to refine so we know exactly what the planner sees.
  const r = await invoke(router, {
    method: 'POST',
    url: `/goals/${g.body.id}/refine?projectId=${projectId}`,
    body: { text: 'Research the API, analyze the requirements, plan the work, implement the feature, test the implementation, deploy to production' },
  });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.plan);
  assert.ok(Array.isArray(r.body.plan.steps));
  assert.ok(r.body.plan.steps.length >= 2, `expected at least 2 steps, got ${r.body.plan.steps.length}`);
  assert.ok(Array.isArray(r.body.suggestedTasks));
  // refine is non-destructive to the goal itself.
  const fresh = await invoke(router, { method: 'GET', url: `/goals/${g.body.id}?projectId=${projectId}` });
  assert.equal(fresh.body.goal.title, 'Ship it');
});

test('POST /goals/from-plan with persist:false returns suggested tasks; nothing created', async () => {
  const { router } = setupRouter();
  const projectId = pid();
  const plan = { id: 'plan_test', goal: 'Build a thing', steps: [{ id: 's1', action: 'build', title: 'Build a thing' }], totalCost: 1, totalDurationMs: 1000, goalEffects: ['artifact_built'] };
  const r = await invoke(router, {
    method: 'POST',
    url: `/goals/from-plan?projectId=${projectId}`,
    body: { plan, persist: false },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.suggestedTasks.length, 1);
  // No goal created.
  const list = await invoke(router, { method: 'GET', url: `/goals?projectId=${projectId}` });
  assert.equal(list.body.goals.length, 0);
});

test('POST /goals/from-plan with persist:true creates goal + linked tasks', async () => {
  const { router, broadcasts } = setupRouter();
  const projectId = pid();
  const plan = {
    id: 'plan_persist',
    goal: 'Plan a thing',
    steps: [
      { id: 's1', action: 'research', title: 'Research', agent: 'Odin', description: 'd', effects: ['context_gathered'], deps: [], estimatedCost: 1, estimatedDurationMs: 1000 },
      { id: 's2', action: 'build', title: 'Build it', agent: 'Thor', description: 'd', effects: ['artifact_built'], deps: ['s1'], estimatedCost: 3, estimatedDurationMs: 5000 },
    ],
    totalCost: 4,
    totalDurationMs: 6000,
    goalEffects: ['artifact_built'],
  };
  const r = await invoke(router, {
    method: 'POST',
    url: `/goals/from-plan?projectId=${projectId}`,
    body: { plan, persist: true },
  });
  assert.equal(r.statusCode, 201);
  assert.ok(r.body.goalId.startsWith('goal_'));
  assert.equal(r.body.linkedTaskIds.length, 2);
  // Tasks must be linked to the new goal.
  const t1 = await tasksStore.getById(projectId, r.body.linkedTaskIds[0]);
  assert.equal(t1.goalId, r.body.goalId);
  // Broadcast: goal:change + goal:tasks-linked + goal:progress.
  assert.ok(broadcasts.some((b) => b.type === 'goal:change' && b.goal.id === r.body.goalId));
  assert.ok(broadcasts.some((b) => b.type === 'goal:tasks-linked' && b.goalId === r.body.goalId && b.count === 2));
});

test('GET /goals/:id/progress returns {total,done,percent}', async () => {
  const { router } = setupRouter();
  const projectId = pid();
  const g = await invoke(router, { method: 'POST', url: '/goals', body: { projectId, title: 'prog' } });
  const goalId = g.body.id;
  const a = await tasksStore.create(projectId, { title: 'a', goalId });
  const b = await tasksStore.create(projectId, { title: 'b', goalId });
  await tasksStore.update(projectId, a.id, { status: 'done' });

  const p = await invoke(router, { method: 'GET', url: `/goals/${goalId}/progress?projectId=${projectId}` });
  assert.equal(p.statusCode, 200);
  assert.equal(p.body.progress.total, 2);
  assert.equal(p.body.progress.done, 1);
  assert.equal(p.body.progress.percent, 50);
});

test('DELETE /goals/:id soft-archives; row still in store', async () => {
  const { router, broadcasts } = setupRouter();
  const projectId = pid();
  const g = await invoke(router, { method: 'POST', url: '/goals', body: { projectId, title: 'archive me' } });
  const d = await invoke(router, { method: 'DELETE', url: `/goals/${g.body.id}?projectId=${projectId}` });
  assert.equal(d.statusCode, 204);
  // Default list omits archived.
  const def = await invoke(router, { method: 'GET', url: `/goals?projectId=${projectId}` });
  assert.equal(def.body.goals.length, 0);
  // With includeArchived, the row is there with status='archived'.
  const all = await invoke(router, { method: 'GET', url: `/goals?projectId=${projectId}&includeArchived=true` });
  assert.equal(all.body.goals.length, 1);
  assert.equal(all.body.goals[0].status, 'archived');
  assert.ok(broadcasts.some((b) => b.type === 'goal:change'));
});

test('PATCH parentGoalId cycle returns 400 cycle_detected', async () => {
  const { router } = setupRouter();
  const projectId = pid();
  const a = await invoke(router, { method: 'POST', url: '/goals', body: { projectId, title: 'A' } });
  const b = await invoke(router, { method: 'POST', url: '/goals', body: { projectId, title: 'B' } });
  // Set B's parent to A.
  const p1 = await invoke(router, {
    method: 'PATCH',
    url: `/goals/${b.body.id}?projectId=${projectId}`,
    body: { parentGoalId: a.body.id },
  });
  assert.equal(p1.statusCode, 200);
  // Now try to set A's parent to B — that would cycle.
  const p2 = await invoke(router, {
    method: 'PATCH',
    url: `/goals/${a.body.id}?projectId=${projectId}`,
    body: { parentGoalId: b.body.id },
  });
  assert.equal(p2.statusCode, 400);
  assert.equal(p2.body.error, 'cycle_detected');
});

test('Cross-project isolation: projectId query scopes correctly', async () => {
  const { router } = setupRouter();
  const p1 = pid();
  const p2 = pid();
  await invoke(router, { method: 'POST', url: '/goals', body: { projectId: p1, title: 'P1-goal' } });
  await invoke(router, { method: 'POST', url: '/goals', body: { projectId: p2, title: 'P2-goal' } });
  const r1 = await invoke(router, { method: 'GET', url: `/goals?projectId=${p1}` });
  const r2 = await invoke(router, { method: 'GET', url: `/goals?projectId=${p2}` });
  assert.equal(r1.body.goals.length, 1);
  assert.equal(r1.body.goals[0].title, 'P1-goal');
  assert.equal(r2.body.goals.length, 1);
  assert.equal(r2.body.goals[0].title, 'P2-goal');
});

test('PATCH /goals/:id emits goal:change + goal:progress WS events', async () => {
  const { router, broadcasts } = setupRouter();
  const projectId = pid();
  const g = await invoke(router, { method: 'POST', url: '/goals', body: { projectId, title: 'patch test' } });
  broadcasts.length = 0;
  const r = await invoke(router, {
    method: 'PATCH',
    url: `/goals/${g.body.id}?projectId=${projectId}`,
    body: { title: 'patched title' },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.title, 'patched title');
  assert.ok(broadcasts.some((b) => b.type === 'goal:change'));
  assert.ok(broadcasts.some((b) => b.type === 'goal:progress'));
});

test('DELETE /goals/:id/tasks/:taskId unlinks a task', async () => {
  const { router, broadcasts } = setupRouter();
  const projectId = pid();
  const g = await invoke(router, { method: 'POST', url: '/goals', body: { projectId, title: 'unlink' } });
  const t = await tasksStore.create(projectId, { title: 'linked', goalId: g.body.id });
  broadcasts.length = 0;
  const r = await invoke(router, {
    method: 'DELETE',
    url: `/goals/${g.body.id}/tasks/${t.id}?projectId=${projectId}`,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.unlinked, true);
  // Task's goalId is null.
  const after = await tasksStore.getById(projectId, t.id);
  assert.equal(after.goalId, null);
  // Broadcasts.
  assert.ok(broadcasts.some((b) => b.type === 'goal:tasks-linked' && b.goalId === g.body.id));
  assert.ok(broadcasts.some((b) => b.type === 'goal:progress'));
});

test('POST /goals/:id/tasks with taskIds validates all tasks exist', async () => {
  const { router } = setupRouter();
  const projectId = pid();
  const g = await invoke(router, { method: 'POST', url: '/goals', body: { projectId, title: 'validate' } });
  const real = await tasksStore.create(projectId, { title: 'real' });
  const r = await invoke(router, {
    method: 'POST',
    url: `/goals/${g.body.id}/tasks?projectId=${projectId}`,
    body: { taskIds: [real.id, 'tsk_does_not_exist'] },
  });
  assert.equal(r.statusCode, 400);
  assert.match(r.body.message || '', /task\(s\) not found/);
});