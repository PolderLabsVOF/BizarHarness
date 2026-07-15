/**
 * tasks-patch-routes.test.mjs — v10.0.3-S1 unit tests for the two
 * PATCH routes added to close the umbrella-brief bug surface.
 *
 * Covers:
 *   - PATCH /api/tasks/:id         — TaskDetail.tsx:81 calls this for
 *                                    title/description/priority edits.
 *                                    Server previously only exposed
 *                                    PUT /api/tasks/:id → 404 on edit.
 *   - PATCH /api/tasks/bulk-status — TasksView.tsx:142 sends this for
 *                                    the bulk action bar. Server
 *                                    previously only had POST /api/tasks/bulk
 *                                    → 404 on every multi-select move.
 *
 * Strategy: build a minimal Express app with just the tasks router
 * mounted on /api. Sandbox HOME so tasks-store writes to a tmpdir
 * instead of ~/.config/bizar. Pass explicit projectId in every body.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = resolve(import.meta.dirname, '..', '..');

let SANDBOX_HOME;
let ORIGINAL_HOME;
let app;
let broadcastEvents;
let tasksFilePath;

before(async () => {
  SANDBOX_HOME = mkdtempSync(join(tmpdir(), `bizar-tasks-patch-${Date.now()}-`));
  ORIGINAL_HOME = process.env.HOME;
  process.env.HOME = SANDBOX_HOME;
  tasksFilePath = join(SANDBOX_HOME, '.config', 'cline', 'projects', 'test-proj', 'tasks.json');
});

after(() => {
  process.env.HOME = ORIGINAL_HOME;
  try { rmSync(SANDBOX_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(async () => {
  broadcastEvents = [];
  try { rmSync(tasksFilePath); } catch { /* ignore */ }
  const { createTasksRouter } = await import(
    `${REPO}/bizar-dash/src/server/routes/tasks.mjs`
  );
  app = express();
  app.use(express.json());
  app.use('/api', createTasksRouter({
    state: {},
    broadcast: (msg) => broadcastEvents.push(msg),
    projectRoot: SANDBOX_HOME,
  }));
});

async function request(method, path, body) {
  const http = await import('node:http');
  return new Promise((resolveP, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const bodyStr = body ? JSON.stringify(body) : {};
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {},
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          server.close();
          try { resolveP({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolveP({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (bodyStr && bodyStr !== '{}') req.write(bodyStr);
      req.end();
    });
  });
}

describe('PATCH /api/tasks/:id — TaskDetail edit path (v10.0.3-S1)', () => {
  it('updates title and persists to tasks.json', async () => {
    const created = await request('POST', '/api/tasks', {
      projectId: 'test-proj',
      title: 'Original title',
      status: 'queued',
      priority: 'normal',
    });
    assert.equal(created.status, 201, `create status=${created.status} body=${JSON.stringify(created.body)}`);
    const taskId = created.body.id;

    const patched = await request('PATCH', `/api/tasks/${taskId}`, {
      projectId: 'test-proj',
      title: 'Edited title',
      priority: 'high',
    });
    assert.equal(patched.status, 200, `patch status=${patched.status} body=${JSON.stringify(patched.body)}`);
    assert.equal(patched.body.title, 'Edited title');
    assert.equal(patched.body.priority, 'high');

    // Persistence proof — read the on-disk file.
    assert.ok(existsSync(tasksFilePath), `tasks.json should exist at ${tasksFilePath}`);
    const onDisk = JSON.parse(readFileSync(tasksFilePath, 'utf8'));
    const found = onDisk.tasks.find((t) => t.id === taskId);
    assert.ok(found, `task ${taskId} should be in tasks.json`);
    assert.equal(found.title, 'Edited title');
    assert.equal(found.priority, 'high');

    // Broadcast proof — UI listens for tasks:change.
    const change = broadcastEvents.find((e) => e.type === 'tasks:change' && e.task?.id === taskId);
    assert.ok(change, 'tasks:change broadcast expected');
  });

  it('returns 404 for unknown task id', async () => {
    const res = await request('PATCH', '/api/tasks/tsk_does_not_exist', {
      projectId: 'test-proj',
      title: 'phantom',
    });
    assert.equal(res.status, 404);
  });
});

describe('PATCH /api/tasks/bulk-status — TasksView bulk action bar (v10.0.3-S1)', () => {
  it('moves multiple tasks in one call and broadcasts per task', async () => {
    const a = await request('POST', '/api/tasks', { projectId: 'test-proj', title: 'bulk-A', status: 'queued' });
    const b = await request('POST', '/api/tasks', { projectId: 'test-proj', title: 'bulk-B', status: 'queued' });
    const c = await request('POST', '/api/tasks', { projectId: 'test-proj', title: 'bulk-C', status: 'queued' });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(c.status, 201);

    broadcastEvents.length = 0;
    const moved = await request('PATCH', '/api/tasks/bulk-status', {
      projectId: 'test-proj',
      ids: [a.body.id, b.body.id, c.body.id],
      status: 'doing',
    });
    assert.equal(moved.status, 200, `bulk-status status=${moved.status} body=${JSON.stringify(moved.body)}`);
    assert.equal(moved.body.count, 3, `expected 3 moved, got ${moved.body.count}`);
    assert.equal(moved.body.failed.length, 0);

    // Persistence proof.
    const onDisk = JSON.parse(readFileSync(tasksFilePath, 'utf8'));
    for (const id of [a.body.id, b.body.id, c.body.id]) {
      const found = onDisk.tasks.find((t) => t.id === id);
      assert.ok(found, `task ${id} missing from disk`);
      assert.equal(found.status, 'doing');
    }

    // Broadcast proof — 3 tasks:change events.
    const changes = broadcastEvents.filter((e) => e.type === 'tasks:change');
    assert.equal(changes.length, 3, `expected 3 tasks:change broadcasts, got ${changes.length}`);
  });

  it('rejects empty ids array with 400', async () => {
    const res = await request('PATCH', '/api/tasks/bulk-status', {
      projectId: 'test-proj',
      ids: [],
      status: 'doing',
    });
    assert.equal(res.status, 400);
  });

  it('rejects invalid status with 400', async () => {
    const res = await request('PATCH', '/api/tasks/bulk-status', {
      projectId: 'test-proj',
      ids: ['tsk_fake'],
      status: 'nonsense',
    });
    assert.equal(res.status, 400);
  });

  it('reports per-id failure when task not found', async () => {
    const real = await request('POST', '/api/tasks', { projectId: 'test-proj', title: 'real', status: 'queued' });
    const res = await request('PATCH', '/api/tasks/bulk-status', {
      projectId: 'test-proj',
      ids: [real.body.id, 'tsk_missing_1'],
      status: 'done',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.failed.length, 1);
    assert.equal(res.body.failed[0].id, 'tsk_missing_1');
  });
});