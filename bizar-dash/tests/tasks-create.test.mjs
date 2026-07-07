/**
 * tasks-create.test.mjs — tests for POST /api/tasks (no agent selection).
 *
 * Run with: node --test bizar-dash/tests/tasks-create.test.mjs
 *
 * Strategy: build a minimal Express app with just the tasks router
 * (mounted on /api). Sandbox HOME so the tasks-store writes to a
 * tmpdir instead of ~/.config/bizar. Pass an explicit projectId in
 * every request body so we don't depend on the active project.
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
  SANDBOX_HOME = mkdtempSync(join(tmpdir(), `bizar-tasks-test-${Date.now()}-`));
  ORIGINAL_HOME = process.env.HOME;
  process.env.HOME = SANDBOX_HOME;
  // tasksStore writes to ~/.config/cline/projects/<id>/tasks.json
  // (projects-store.mjs:PROJECTS_DIR).
  tasksFilePath = join(SANDBOX_HOME, '.config', 'cline', 'projects', 'test-proj', 'tasks.json');
});

after(() => {
  process.env.HOME = ORIGINAL_HOME;
  try { rmSync(SANDBOX_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(async () => {
  broadcastEvents = [];
  // Reset file between tests so each one starts clean.
  try { rmSync(tasksFilePath); } catch { /* ignore */ }
  // Fresh import of the router — build a minimal app.
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
      const bodyStr = body ? JSON.stringify(body) : '';
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: bodyStr
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
          : {},
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          server.close();
          try {
            resolveP({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolveP({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  });
}

describe('POST /api/tasks — simplified create flow (no agent selection)', () => {
  it('creates a task with just title + description, returning 201', async () => {
    const res = await request('POST', '/api/tasks', {
      projectId: 'test-proj',
      title: 'Test task',
      description: 'A simple task without any agent field.',
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.id, 'response should include id');
    assert.equal(res.body.title, 'Test task');
    assert.equal(res.body.description, 'A simple task without any agent field.');
  });

  it('does not store any agent-related field when none is provided', async () => {
    const res = await request('POST', '/api/tasks', {
      projectId: 'test-proj',
      title: 'No agent task',
      description: 'Just title and description.',
    });
    assert.equal(res.status, 201);
    // The store does not have an `agent` field — it has `assignee`
    // and `workedBy`. Both must be null/empty since no agent was picked.
    assert.equal(res.body.assignee, null, 'assignee should be null when not provided');
    assert.equal(res.body.workedBy, null, 'workedBy should be null when not provided');
    // Defensive: no field literally named `agent` should leak through.
    assert.equal(res.body.agent, undefined, 'response should not have an `agent` field');
  });

  it('still respects an explicitly passed assignee (backward compat)', async () => {
    // The store API has always accepted `assignee`. We don't break it —
    // we just don't ask for it in the simplified UI. Tests that callers
    // can still set it explicitly when they want to.
    const res = await request('POST', '/api/tasks', {
      projectId: 'test-proj',
      title: 'Manually assigned',
      description: 'Caller passed assignee explicitly.',
      assignee: 'odin',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.assignee, 'odin');
  });

  it('ignores an unrecognized `agent` field (does not store it)', async () => {
    const res = await request('POST', '/api/tasks', {
      projectId: 'test-proj',
      title: 'With unknown field',
      description: 'Caller passed agent field by mistake.',
      agent: 'thor',
    });
    assert.equal(res.status, 201);
    // The store doesn't have an `agent` field. Any incoming `agent`
    // is just an unknown prop and should not appear on the stored task.
    assert.equal(res.body.agent, undefined, 'agent field should not be stored');
    assert.equal(res.body.assignee, null, 'assignee should remain null');
  });

  it('persists the task to disk with no agent data', async () => {
    const res = await request('POST', '/api/tasks', {
      projectId: 'test-proj',
      title: 'Persisted',
      description: 'Check disk state.',
    });
    assert.equal(res.status, 201);

    assert.ok(existsSync(tasksFilePath), 'tasks.json should be written to disk');
    const stored = JSON.parse(readFileSync(tasksFilePath, 'utf8'));
    assert.equal(stored.tasks.length, 1);
    const task = stored.tasks[0];
    assert.equal(task.title, 'Persisted');
    assert.equal(task.assignee, null);
    assert.equal(task.workedBy, null);
    assert.equal(task.agent, undefined);
  });

  it('rejects create without a title (non-201 with title-related error)', async () => {
    const res = await request('POST', '/api/tasks', {
      projectId: 'test-proj',
      description: 'No title — should fail.',
    });
    assert.notEqual(res.status, 201, 'should not succeed without a title');
    assert.ok(
      res.body.message?.toLowerCase().includes('title'),
      `error message should mention title, got: ${JSON.stringify(res.body)}`,
    );
  });

  it('emits a tasks:change broadcast event', async () => {
    const res = await request('POST', '/api/tasks', {
      projectId: 'test-proj',
      title: 'Broadcast test',
      description: 'Should fire tasks:change.',
    });
    assert.equal(res.status, 201);
    assert.equal(broadcastEvents.length, 1, 'should emit exactly one event');
    assert.equal(broadcastEvents[0].type, 'tasks:change');
    assert.equal(broadcastEvents[0].task.title, 'Broadcast test');
  });
});