/**
 * tests/task-splitter.test.mjs
 *
 * Self-check for task-splitter.mjs (G-autoloop Phase 3).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  estimateSize,
  avgHistoricalMinutes,
  shouldSplit,
  planSplit,
  acceptSplit,
  rollupProgress,
  goalAwarePriority,
} = await import('../src/server/task-splitter.mjs');

// ---- estimateSize ---------------------------------------------------------

test('estimateSize: tiny tasks → S', () => {
  const size = estimateSize({ title: 'fix typo', description: '' });
  assert.equal(size, 'S');
});

test('estimateSize: medium tasks with description → M or L', () => {
  const size = estimateSize({
    title: 'Add a /metrics Prometheus endpoint to the dash server',
    description: 'Wire app.get("/metrics") using prom-client; expose httpRequestsTotal as gauge and counter, label by route+status; gate on auth.',
  });
  assert.ok(['M', 'L'].includes(size), `expected M or L, got ${size}`);
});

test('estimateSize: linked goal+kr pushes to L or XL', () => {
  const size = estimateSize({
    title: 'Refactor agent routing',
    metadata: { goalId: 'G-1', krId: 'KR-1' },
    description: 'medium',
  });
  assert.ok(['L', 'XL'].includes(size), `got ${size}`);
});

test('estimateSize: long description pushes to XL', () => {
  const longDesc = 'word '.repeat(800).trim();
  const size = estimateSize({
    title: 'huge task',
    description: longDesc,
  });
  assert.equal(size, 'XL');
});

test('estimateSize: history of > 6h avg pushes up', () => {
  const history = [
    { title: 'Huge task redesign dashboard', timeSpent: 400 },
    { title: 'Huge task refactor navigation', timeSpent: 500 },
    { title: 'Huge task wire up', timeSpent: 450 },
  ];
  const size = estimateSize({ title: 'Huge task integrate', description: '' }, history);
  assert.ok(['L', 'XL'].includes(size), `got ${size}`);
});

test('estimateSize: history < 2 items is ignored', () => {
  const history = [{ title: 'Huge task first', timeSpent: 600 }];
  const size = estimateSize({ title: 'tiny', description: '' }, history);
  assert.equal(size, 'S');
});

test('estimateSize: bad input → M', () => {
  assert.equal(estimateSize(null), 'M');
  assert.equal(estimateSize(undefined), 'M');
  assert.equal(estimateSize('not a task'), 'M');
});

// ---- avgHistoricalMinutes -------------------------------------------------

test('avgHistoricalMinutes: matches on overlapping title words', () => {
  const history = [
    { title: 'Refactor the sidebar navigation', timeSpent: 30 },
    { title: 'Refactor the dashboard navigation', timeSpent: 90 },
    { title: 'Refresh everything else', timeSpent: 60 },
  ];
  const mins = avgHistoricalMinutes({ title: 'Refactor the sidebar navigation' }, history);
  // overlap≥2 with the candidate; first two share "Refactor" + "navigation".
  assert.equal(mins, (30 + 90) / 2);
});

test('avgHistoricalMinutes: ignores zero/negative timeSpent rows', () => {
  const history = [
    { title: 'wire up routes', timeSpent: 30 },
    { title: 'wire up nav', timeSpent: 0 },
    { title: 'wire up tasks', timeSpent: -5 },
  ];
  // Title words: "wire", "up", "routes" / "nav" / "tasks"; "up" is short
  // and dropped (>3 filter). Only "wire" overlap → match by ≥1? No, we
  // require ≥2. So only "wire up routes" should match (shares "wire",
  // "routes").
  const mins = avgHistoricalMinutes({ title: 'wire up routes' }, history);
  assert.equal(mins, 30);
});

test('avgHistoricalMinutes: short history is unreliable', () => {
  const history = [{ title: 'Refactor the dashboard', timeSpent: 600 }];
  assert.equal(avgHistoricalMinutes({ title: 'Refactor the dashboard' }, history), 0);
});

test('avgHistoricalMinutes: no word overlap → 0', () => {
  const history = [
    { title: 'completely unrelated task alpha beta', timeSpent: 600 },
    { title: 'completely unrelated task gamma delta', timeSpent: 600 },
  ];
  assert.equal(avgHistoricalMinutes({ title: 'tiny change' }, history), 0);
});

// ---- shouldSplit ----------------------------------------------------------

test('shouldSplit: implicit L+ → true', () => {
  const task = {
    title: 'Refactor the dashboard and rewrite every component',
    description: 'huge'.repeat(200),
    metadata: { goalId: 'G-1', krId: 'KR-1' },
  };
  assert.equal(shouldSplit(task), true);
});

test('shouldSplit: small tasks → false', () => {
  assert.equal(shouldSplit({ title: 'fix typo' }), false);
});

test('shouldSplit: explicit metadata wins over heuristic', () => {
  // Small task, but force split via metadata.
  assert.equal(shouldSplit({ title: 'tiny', metadata: { autoSplit: true } }), true);
  // Big task, but explicitly forbid splitting.
  assert.equal(
    shouldSplit({
      title: 'huge '.repeat(50).trim(),
      description: 'big',
      metadata: { autoSplit: false },
    }),
    false,
  );
});

// ---- planSplit ------------------------------------------------------------

test('planSplit: requires id, returns prompt + constraints', () => {
  assert.throws(() => planSplit(null), TypeError);
  assert.throws(() => planSplit({}), TypeError);
  const plan = planSplit({
    id: 'tsk_abc',
    title: 'wire up autonomous loop',
    description: 'big change',
    assignee: 'tyr',
    metadata: { goalId: 'G-1' },
  });
  assert.equal(plan.kind, 'task-decompose');
  assert.equal(plan.parentTaskId, 'tsk_abc');
  assert.ok(plan.prompt.includes('wire up autonomous loop'));
  assert.ok(plan.prompt.includes('Linked goal: G-1'));
  assert.equal(plan.constraints.min, 2);
  assert.equal(plan.constraints.max, 5);
});

// ---- acceptSplit ----------------------------------------------------------

test('acceptSplit: filters out malformed candidates', () => {
  const candidates = [
    { title: 'subtask 1', description: 'ok' },
    null,
    { title: '' },
    { title: 'subtask 2' },
    { title: 42 }, // wrong type
    { title: 'subtask 3' },
    { title: 'subtask 4' },
    { title: 'subtask 5' },
    { title: 'subtask 6' },
    'string not object',
  ];
  const out = acceptSplit(candidates);
  assert.equal(out.length, 5); // capped at max=5; we drop empty/numbered/string
  assert.deepEqual(out.map((o) => o.title), ['subtask 1', 'subtask 2', 'subtask 3', 'subtask 4', 'subtask 5']);
});

test('acceptSplit: below minimum → empty', () => {
  const out = acceptSplit([{ title: 'only' }]);
  assert.equal(out.length, 0);
});

test('acceptSplit: trims oversize title and description', () => {
  const longTitle = 'x'.repeat(500);
  const longDesc = 'y'.repeat(10000);
  const out = acceptSplit([
    { title: longTitle, description: longDesc },
    { title: 'second' },
  ]);
  assert.equal(out[0].title.length, 200);
  assert.equal(out[0].description.length, 4000);
});

test('acceptSplit: tags default to autosplit, priority defaults to 5', () => {
  const out = acceptSplit([{ title: 'a' }, { title: 'b', priority: 2, tags: ['foo'] }]);
  assert.equal(out[0].priority, 5);
  assert.deepEqual(out[0].tags, ['autosplit']);
  assert.equal(out[1].priority, 2);
  assert.deepEqual(out[1].tags, ['foo']);
});

// ---- rollupProgress -------------------------------------------------------

test('rollupProgress: counts done children', () => {
  const parent = {
    subtasks: [
      { status: 'done' },
      { status: 'doing' },
      { status: 'done' },
      { status: 'queued' },
    ],
  };
  const r = rollupProgress(parent);
  assert.equal(r.ratio, 0.5);
  assert.equal(r.allDone, false);
});

test('rollupProgress: allDone when every child is done', () => {
  const parent = {
    subtasks: [{ status: 'done' }, { status: 'done' }],
  };
  const r = rollupProgress(parent);
  assert.equal(r.ratio, 1);
  assert.equal(r.allDone, true);
});

test('rollupProgress: no children → zeros', () => {
  assert.deepEqual(rollupProgress({}), { ratio: 0, allDone: false });
  assert.deepEqual(rollupProgress(null), { ratio: 0, allDone: false });
});

// ---- goalAwarePriority ----------------------------------------------------

test('goalAwarePriority: at-risk goal bumps priority', () => {
  const out = goalAwarePriority({ priority: 4 }, { status: 'at-risk' });
  assert.equal(out.priority, 3);
  assert.equal(out.action, 'bump');
});

test('goalAwarePriority: at-risk clamps at 1', () => {
  const out = goalAwarePriority({ priority: 1 }, { status: 'at-risk' });
  assert.equal(out.priority, 1);
  assert.equal(out.action, 'bump');
});

test('goalAwarePriority: blocked goal holds priority', () => {
  const out = goalAwarePriority({ priority: 3 }, { status: 'blocked' });
  assert.equal(out.priority, 3);
  assert.equal(out.action, 'none');
});

test('goalAwarePriority: done goal de-prioritises', () => {
  const out = goalAwarePriority({ priority: 2 }, { status: 'done' });
  assert.equal(out.priority, 9);
  assert.equal(out.action, 'drop');
});

test('goalAwarePriority: missing goal or task → no change', () => {
  assert.equal(goalAwarePriority(null, { status: 'at-risk' }).action, 'none');
  assert.equal(goalAwarePriority({ priority: 3 }, null).action, 'none');
  assert.equal(goalAwarePriority({ priority: 3 }, { status: 'on-track' }).action, 'none');
});
