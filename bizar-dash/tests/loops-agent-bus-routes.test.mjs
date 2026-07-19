/**
 * tests/loops-agent-bus-routes.test.mjs
 *
 * Integration check for /api/loops and /api/agent-bus routers (Phase 5).
 * Pure HTTP — Express + supertest-free; we wrap the router and fire
 * fetch via the running process is overkill. Just call the router
 * with a fake req/res pair. Both routers mount under /api/<path>.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point both modules at the same temp dir BEFORE importing them.
const TMP = mkdtempSync(join(tmpdir(), 'bizar-routes-'));
process.env.BIZAR_LOOPS_ROOT = TMP;
process.env.BIZAR_AGENT_BUS_ROOT = TMP;

const { createLoopsRouter } = await import('../src/server/routes/loops.mjs');
const { createAgentBusRouter } = await import('../src/server/routes/agent-bus.mjs');
const { _dropInProcessTimers } = await import('../src/server/loop-runtime.mjs');
const { _resetForTests: busReset } = await import('../src/server/agent-bus.mjs');

after(() => {
  _dropInProcessTimers();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* */ }
});

beforeEach(() => busReset());

// ---- fake req/res helpers ------------------------------------------------

function handler(router, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      originalUrl: path,
      params: extractParams(router, path),
      body: body || {},
      query: extractQuery(path),
    };
    const headers = {};
    const res = {
      statusCode: 200,
      headers,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        this.headers['content-type'] = 'application/json';
        resolve({ status: this.statusCode, body: payload, headers });
      },
      end() { resolve({ status: this.statusCode, body: null, headers }); },
    };
    try {
      router(req, res, (err) => {
        if (err) reject(err);
        else reject(new Error(`unhandled: ${method} ${path}`));
      });
    } catch (err) {
      reject(err);
    }
  });
}

function extractParams(router, path) {
  // Naive: scan router.stack for routes with the same path-pattern.
  const stack = router.stack || [];
  for (const layer of stack) {
    if (!layer.route) continue;
    const keys = [];
    const re = layer.route.path.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
    const m = new RegExp(`^${re}$`).exec(path);
    if (m) {
      const params = {};
      keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return params;
    }
  }
  return {};
}

function extractQuery(path) {
  const i = path.indexOf('?');
  if (i < 0) return {};
  const out = {};
  for (const part of path.slice(i + 1).split('&')) {
    const [k, v] = part.split('=');
    if (k) out[decodeURIComponent(k)] = v == null ? '' : decodeURIComponent(v);
  }
  return out;
}

// ---- /api/loops ----------------------------------------------------------

test('loops: GET /loops returns empty registry', async () => {
  const r = createLoopsRouter();
  const res = await handler(r, 'GET', '/loops');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { loops: [], count: 0 });
});

test('loops: POST /loops creates a pending loop', async () => {
  const r = createLoopsRouter();
  const res = await handler(r, 'POST', '/loops', { projectId: 'p1', name: 'nightly', intervalMs: 5000 });
  assert.equal(res.status, 201);
  assert.equal(res.body.projectId, 'p1');
  assert.equal(res.body.name, 'nightly');
  assert.equal(res.body.status, 'pending');
  assert.equal(res.body.intervalMs, 5000);
});

test('loops: POST /loops rejects missing projectId with 400', async () => {
  const r = createLoopsRouter();
  const res = await handler(r, 'POST', '/loops', {});
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'bad_request');
});

test('loops: GET /loops/:id returns 404 for unknown', async () => {
  const r = createLoopsRouter();
  const res = await handler(r, 'GET', '/loops/loop_nope');
  assert.equal(res.status, 404);
});

test('loops: GET /loops/:id returns the loop after POST', async () => {
  const r = createLoopsRouter();
  const created = await handler(r, 'POST', '/loops', { projectId: 'p1' });
  const res = await handler(r, 'GET', `/loops/${created.body.loopId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.loopId, created.body.loopId);
});

test('loops: PATCH /loops/:id merges allowed fields', async () => {
  const r = createLoopsRouter();
  const created = await handler(r, 'POST', '/loops', { projectId: 'p1' });
  const res = await handler(r, 'PATCH', `/loops/${created.body.loopId}`, {
    name: 'renamed',
    intervalMs: 1000,
    illegalField: 'should not appear',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'renamed');
  assert.equal(res.body.intervalMs, 1000);
  assert.equal(res.body.illegalField, undefined);
});

test('loops: POST /loops/:id/start flips to running and stop flips to stopped', async () => {
  const r = createLoopsRouter();
  const created = await handler(r, 'POST', '/loops', { projectId: 'p1', intervalMs: 60000 });
  const start = await handler(r, 'POST', `/loops/${created.body.loopId}/start`, { dry: true });
  assert.equal(start.status, 200);
  assert.equal(start.body.status, 'running');
  const stop = await handler(r, 'POST', `/loops/${created.body.loopId}/stop`, {});
  assert.equal(stop.status, 200);
  assert.equal(stop.body.status, 'stopped');
});

test('loops: DELETE /loops/:id removes the loop and is 404 on subsequent GET', async () => {
  const r = createLoopsRouter();
  const created = await handler(r, 'POST', '/loops', { projectId: 'p1' });
  const del = await handler(r, 'DELETE', `/loops/${created.body.loopId}`, {});
  assert.equal(del.status, 204);
  const after = await handler(r, 'GET', `/loops/${created.body.loopId}`);
  assert.equal(after.status, 404);
});

// ---- /api/agent-bus ------------------------------------------------------

test('agent-bus: GET /agent-bus/presence returns empty when nobody announced', async () => {
  const r = createAgentBusRouter();
  const res = await handler(r, 'GET', '/agent-bus/presence');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { agents: {}, count: 0 });
});

test('agent-bus: POST /agent-bus/announce adds an agent to presence', async () => {
  const r = createAgentBusRouter();
  const res = await handler(r, 'POST', '/agent-bus/announce', {
    name: 'odin', sessionId: 'sess_1', capabilities: ['plan'], model: 'opus',
  });
  assert.equal(res.status, 200);
  const p = await handler(r, 'GET', '/agent-bus/presence');
  assert.equal(p.body.agents.odin.sessionId, 'sess_1');
});

test('agent-bus: POST /agent-bus/announce rejects missing sessionId', async () => {
  const r = createAgentBusRouter();
  const res = await handler(r, 'POST', '/agent-bus/announce', { name: 'odin' });
  assert.equal(res.status, 400);
});

test('agent-bus: DELETE /agent-bus/agents/:name removes from presence', async () => {
  const r = createAgentBusRouter();
  await handler(r, 'POST', '/agent-bus/announce', { name: 'odin', sessionId: 'sess_1' });
  const del = await handler(r, 'DELETE', '/agent-bus/agents/odin', {});
  assert.equal(del.status, 204);
  const p = await handler(r, 'GET', '/agent-bus/presence');
  assert.equal(p.body.agents.odin, undefined);
});

test('agent-bus: GET /agent-bus/channels enumerates *.jsonl files', async () => {
  const r = createAgentBusRouter();
  // Publish to two channels to create JSONL logs.
  await handler(r, 'POST', '/agent-bus/channels/chanA/publish', {
    from: 'agent://odin', to: 'agent://thor', kind: 'request', payload: {},
  });
  await handler(r, 'POST', '/agent-bus/channels/chanB/publish', {
    from: 'agent://thor', to: 'agent://odin', kind: 'ack', payload: {},
  });
  const res = await handler(r, 'GET', '/agent-bus/channels', {});
  assert.equal(res.status, 200);
  const names = res.body.channels.map((c) => c.name).sort();
  assert.deepEqual(names, ['chanA', 'chanB']);
});

test('agent-bus: GET /agent-bus/channels/:name returns recent messages', async () => {
  const r = createAgentBusRouter();
  await handler(r, 'POST', '/agent-bus/channels/chanR/publish', {
    from: 'agent://odin', to: 'agent://thor', kind: 'request', payload: { q: 'hi' },
  });
  const res = await handler(r, 'GET', '/agent-bus/channels/chanR?limit=10', {});
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.messages[0].payload.q, 'hi');
});

test('agent-bus: POST /agent-bus/channels/:name/publish rejects bad addresses', async () => {
  const r = createAgentBusRouter();
  const res = await handler(r, 'POST', '/agent-bus/channels/x/publish', {
    from: 'odin', to: 'agent://thor', kind: 'request', payload: {},
  });
  assert.equal(res.status, 400);
});

test('agent-bus: POST /agent-bus/channels/:name/publish rejects bad kind', async () => {
  const r = createAgentBusRouter();
  const res = await handler(r, 'POST', '/agent-bus/channels/x/publish', {
    from: 'agent://odin', to: 'agent://thor', kind: 'bogus', payload: {},
  });
  assert.equal(res.status, 400);
});

test('agent-bus: POST /agent-bus/channels/:name/publish accepts valid request', async () => {
  const r = createAgentBusRouter();
  const res = await handler(r, 'POST', '/agent-bus/channels/chanP/publish', {
    from: 'agent://odin', to: 'agent://thor', kind: 'request', payload: { a: 1 },
  });
  assert.equal(res.status, 202);
  assert.ok(res.body.id);
});

test('agent-bus: steer/correct/handoff convenience endpoints', async () => {
  const r = createAgentBusRouter();
  const s = await handler(r, 'POST', '/agent-bus/steer', {
    from: 'agent://odin', to: 'agent://thor', note: 'focus on tests',
  });
  assert.equal(s.status, 202);
  const c = await handler(r, 'POST', '/agent-bus/correct', {
    from: 'agent://odin', to: 'agent://thor', note: 'use new endpoint',
    before: 'a()', after: 'b()',
  });
  assert.equal(c.status, 202);
  const h = await handler(r, 'POST', '/agent-bus/handoff', {
    from: 'agent://odin', to: 'agent://thor', taskId: 'tsk_1', reason: 'specialty',
  });
  assert.equal(h.status, 202);
});

test('agent-bus: steer rejects missing to/from', async () => {
  const r = createAgentBusRouter();
  const res = await handler(r, 'POST', '/agent-bus/steer', { from: 'agent://odin' });
  assert.equal(res.status, 400);
});

test('agent-bus: handoff rejects missing taskId', async () => {
  const r = createAgentBusRouter();
  const res = await handler(r, 'POST', '/agent-bus/handoff', {
    from: 'agent://odin', to: 'agent://thor',
  });
  assert.equal(res.status, 400);
});

test('agent-bus: publish broadcasts a message event', async () => {
  const events = [];
  const r = createAgentBusRouter({ broadcast: (e) => events.push(e) });
  await handler(r, 'POST', '/agent-bus/channels/chanB/publish', {
    from: 'agent://odin', to: 'agent://thor', kind: 'request', payload: {},
  });
  assert.ok(events.find((e) => e.type === 'agent-bus:message' && e.channel === 'chanB'));
});
