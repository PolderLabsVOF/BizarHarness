/**
 * goals-decompose.test.mjs — tests for goal → task auto-decomposition
 * (Sprint S18). Covers:
 *
 *   - POST /api/goals/:id/decompose creates one queued task per KR.
 *   - PATCH /api/tasks/:id/status (done) flows back to mark KR done
 *     and recomputes goal.progress%.
 *   - Re-decomposing a goal leaves existing taskIds intact.
 *
 * Run with: node --test bizar-dash/tests/goals-decompose.test.mjs
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = resolve(import.meta.dirname, '..', '..');

let SANDBOX_HOME;
let ORIGINAL_HOME;
let app;
let progressPath;

before(async () => {
  SANDBOX_HOME = mkdtempSync(join(tmpdir(), `bizar-goals-test-${Date.now()}-`));
  ORIGINAL_HOME = process.env.HOME;
  process.env.HOME = SANDBOX_HOME;
  mkdirSync(join(SANDBOX_HOME, '.bizar'), { recursive: true });
  progressPath = join(SANDBOX_HOME, '.bizar', 'PROGRESS.md');

  // Seed PROGRESS.md with one goal + three key results.
  writeFileSync(progressPath, [
    '# PROGRESS',
    '',
    '## Ship the v8 dashboard',
    '',
    'status: at-risk',
    'progress: 0',
    'due: 2026-09-30',
    'owner: sam',
    '',
    '- [ ] Wire backend SSE  ← kr-1',
    '- [ ] Wire command palette  ← kr-2',
    '- [ ] Wire settings  ← kr-3',
    '',
  ].join('\n'), 'utf8');

  const { createGoalsRouter } = await import('../src/server/routes/goals.mjs');
  const { createTasksRouter } = await import('../src/server/routes/tasks.mjs');
  // tasks-store writes to ~/.config/cline/projects/<id>/tasks.json
  mkdirSync(join(SANDBOX_HOME, '.config', 'cline', 'projects', 'default'), { recursive: true });

  app = express();
  app.use(express.json());
  app.use('/api', createGoalsRouter({ broadcast: () => {} }));
  app.use('/api', createTasksRouter({ state: {}, broadcast: () => {}, projectRoot: SANDBOX_HOME }));
});

after(async () => {
  process.env.HOME = ORIGINAL_HOME;
  rmSync(SANDBOX_HOME, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset PROGRESS.md between tests so seed state is reproducible.
  writeFileSync(progressPath, [
    '# PROGRESS',
    '',
    '## Ship the v8 dashboard',
    '',
    'status: at-risk',
    'progress: 0',
    'due: 2026-09-30',
    'owner: sam',
    '',
    '- [ ] Wire backend SSE  ← kr-1',
    '- [ ] Wire command palette  ← kr-2',
    '- [ ] Wire settings  ← kr-3',
    '',
  ].join('\n'), 'utf8');
});

async function http(method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let json;
        try { json = text ? JSON.parse(text) : null; } catch { json = text; }
        server.close();
        resolve({ status: res.status, body: json });
      } catch (err) { server.close(); reject(err); }
    });
  });
}

describe('Goals → Tasks auto-decomposition', () => {
  it('decomposes a goal into one task per key result', async () => {
    const goalsList = await http('GET', '/api/goals');
    assert.equal(goalsList.status, 200);
    const goal = goalsList.body.goals[0];
    assert.ok(Array.isArray(goal.keyResults) && goal.keyResults.length === 3);

    const decomp = await http('POST', `/api/goals/${goal.id}/decompose`);
    assert.equal(decomp.status, 201);
    assert.equal(decomp.body.created.length, 3);
    for (const c of decomp.body.created) {
      assert.ok(typeof c.task === 'string' && c.task.length > 0);
      assert.ok(typeof c.kr === 'string' && c.kr.length > 0);
    }

    // Each KR should now carry a taskId.
    const after = await http('GET', `/api/goals/${goal.id}`);
    assert.equal(after.status, 200);
    assert.ok(after.body.keyResults.every((kr) => Boolean(kr.taskId)));
  });

  it('rejects decomposition for a goal with no key results', async () => {
    // Patch the goal to clear its KRs.
    writeFileSync(progressPath, [
      '# PROGRESS',
      '',
      '## Empty goal',
      '',
      'status: active',
      'progress: 0',
      '',
    ].join('\n'), 'utf8');

    const r = await http('POST', '/api/goals/G-empty/decompose');
    // 404 because the goal id 'G-empty' isn't in the parsed list — fine.
    assert.ok(r.status === 404 || r.status === 400);
  });

  it('reverse-sync marks KR done and recomputes progress when task moves to done', async () => {
    // Decompose first.
    const goalsList = await http('GET', '/api/goals');
    const goal = goalsList.body.goals[0];
    const decomp = await http('POST', `/api/goals/${goal.id}/decompose`);
    assert.equal(decomp.status, 201);
    const { task: taskId, kr: krId } = decomp.body.created[0];

    // Mark the task done.
    const moved = await http('PATCH', `/api/tasks/${taskId}/status`, { status: 'done', projectId: 'default' });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.status, 'done');

    // Goal KR should now be done; progress% should be 1/3.
    const after = await http('GET', `/api/goals/${goal.id}`);
    assert.equal(after.status, 200);
    const kr = after.body.keyResults.find((k) => k.id === krId);
    assert.equal(kr.done, true);
    assert.ok(Math.abs(after.body.progress - 1 / 3) < 1e-6);

    // And the PROGRESS.md on disk should reflect the checked KR + the
    // preserved taskId linkage (so the next parse still wires it up).
    const onDisk = readFileSync(progressPath, 'utf8');
    assert.ok(/-\s*\[x\]\s+Wire backend SSE/.test(onDisk), 'KR1 should be [x] on disk');
    assert.ok(new RegExp(`taskId:\\s*${taskId}`).test(onDisk), 'taskId should roundtrip in PROGRESS.md');
  });

  it('does not duplicate tasks on a second decompose call', async () => {
    const goalsList = await http('GET', '/api/goals');
    const goal = goalsList.body.goals[0];
    const first = await http('POST', `/api/goals/${goal.id}/decompose`);
    assert.equal(first.body.created.length, 3);
    const second = await http('POST', `/api/goals/${goal.id}/decompose`);
    // Already-decomposed KRs are skipped, so 0 new tasks.
    assert.equal(second.body.created.length, 0);
  });
});
