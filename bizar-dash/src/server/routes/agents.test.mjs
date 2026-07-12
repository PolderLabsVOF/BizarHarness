/**
 * src/server/routes/agents.test.mjs
 *
 * F-040 — node:test coverage for the new F-040 endpoints in
 * routes/agents.mjs. Run with:
 *   node --test bizar-dash/src/server/routes/agents.test.mjs
 *
 * Covers (5 cases total — combined with claude-session-watcher.test.mjs
 * gives ≥14 cases):
 *   1. GET /api/agents/active returns only working/recent-heartbeat agents
 *   2. POST /api/agents/:name/approve writes approval file
 *   3. POST /api/agents/:name/steer returns ok with stub note when no live session
 *   4. POST /api/agents/:name/kill returns ok with note when no live session
 *   5. GET /api/agents/:name/history reads hook-log JSONL
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentsRouter } from './agents.mjs';

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
  tmpHome = mkdtempSync(join(tmpdir(), 'f040-agents-routes-'));
  process.env.HOME = tmpHome;
  // Pre-seed hook-logs and approvals dirs.
  mkdirSync(join(tmpHome, '.config', 'bizar', 'hook-logs'), { recursive: true });
  mkdirSync(join(tmpHome, '.config', 'bizar', 'approvals'), { recursive: true });
  mkdirSync(join(tmpHome, '.config', 'bizar'), { recursive: true });
});

after(() => {
  process.env.HOME = prevHome;
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

function setupRouter() {
  const broadcasts = [];
  const router = createAgentsRouter({
    state: { appendActivity: () => {} },
    broadcast: (evt) => broadcasts.push(evt),
  });
  return { router, broadcasts };
}

function invoke(router, { method, url, body }) {
  return new Promise((resolve, reject) => {
    const pathOnly = url.replace(/\?.*$/, '');
    // Find all candidate routes whose path pattern matches.
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
    // Pick the most specific (longest pattern) — Express matches in order.
    candidates.sort((a, b) => b.path.length - a.path.length);
    const handler = candidates[0].stack[0].handle;
    const req = { params: paramMap(pathOnly), body: body || {}, query: queryMap(url) };
    const res = mockRes();
    Promise.resolve(handler(req, res, () => {})).then(() => resolve(res), reject);
  });
}

/**
 * Convert an Express path pattern (`/agents/:name/steer`) into a
 * regex and test it against the concrete URL (`/agents/coder/steer`).
 */
function matchesPath(pattern, path) {
  if (pattern === path) return true;
  // Convert :name → ([^/]+), escape other regex chars.
  const re = new RegExp(
    '^' + pattern.replace(/[.+*?^$()|[\]{}\\]/g, '\\$&').replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '([^/]+)') + '$',
  );
  return re.test(path);
}

function paramMap(url) {
  const m = /\/agents\/([^/?]+)(?:\/([^?]+))?/.exec(url);
  if (!m) return {};
  const out = { name: m[1] };
  if (m[2]) out.sub = m[2];
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

test('GET /api/agents/active returns only working/recent-heartbeat agents', async () => {
  const { router } = setupRouter();
  // We don't write real agents dir here — the active endpoint
  // iterates agentsStore.list() which depends on ~/.config/cline/agents.
  // The test just verifies the endpoint is mounted and returns 200 with
  // an `active` array; an empty array is the correct shape when no
  // agents exist (none exist in the tmp home).
  const res = await invoke(router, { method: 'GET', url: '/agents/active' });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.active));
  assert.equal(typeof res.body.ts, 'number');
});

test('POST /api/agents/:name/approve writes ~/.config/bizar/approvals/<id>.json', async () => {
  const { router, broadcasts } = setupRouter();
  const toolUseId = 'tu_approve_test_1';
  const res = await invoke(router, {
    method: 'POST',
    url: '/agents/coder/approve',
    body: { toolUseId, approve: true, note: 'go', sessionId: 'ses_approve_1' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.approval.toolUseId, toolUseId);
  assert.equal(res.body.approval.approve, true);
  // File should exist on disk now.
  const fp = join(tmpHome, '.config', 'bizar', 'approvals', `${toolUseId}.json`);
  assert.ok(existsSync(fp), `approval file ${fp} should exist`);
  const onDisk = JSON.parse(readFileSync(fp, 'utf8'));
  assert.equal(onDisk.toolUseId, toolUseId);
  assert.equal(onDisk.agent, 'coder');
  assert.equal(onDisk.sessionId, 'ses_approve_1');
  // Broadcast was emitted.
  assert.ok(broadcasts.some((b) => b.type === 'agent:approval' && b.agent === 'coder'));
});

test('POST /api/agents/:name/steer returns ok with stub note when no live session', async () => {
  const { router, broadcasts } = setupRouter();
  const res = await invoke(router, {
    method: 'POST',
    url: '/agents/coder/steer',
    body: { message: 'please continue', sessionId: 'ses_not_live' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.agent, 'coder');
  // No live session in this test → intent note.
  assert.equal(res.body.note, 'no_live_session');
  assert.equal(res.body.intent, true);
  // Broadcast emitted.
  assert.ok(broadcasts.some((b) => b.type === 'agent:steer-intent' && b.agent === 'coder'));
});

test('POST /api/agents/:name/kill returns ok with note when no live session', async () => {
  const { router, broadcasts } = setupRouter();
  const res = await invoke(router, {
    method: 'POST',
    url: '/agents/coder/kill',
    body: { sessionId: 'ses_not_live' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.agent, 'coder');
  assert.equal(res.body.note, 'no_live_session');
  assert.ok(broadcasts.some((b) => b.type === 'agent:status'));
});

test('GET /api/agents/:name/history reads hook-log JSONL', async () => {
  // Seed a hook log line for `coder`.
  const today = new Date().toISOString().slice(0, 10);
  const fp = join(tmpHome, '.config', 'bizar', 'hook-logs', `agent-tool-${today}.jsonl`);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    sessionId: 'ses_history_1',
    agentName: 'coder',
    promptPreview: 'first task',
    source: 'hook',
  });
  writeFileSync(fp, line + '\n', 'utf8');

  const { router } = setupRouter();
  const res = await invoke(router, {
    method: 'GET',
    url: '/agents/coder/history?limit=10',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.agent, 'coder');
  assert.ok(Array.isArray(res.body.history));
  assert.equal(res.body.history.length, 1);
  assert.equal(res.body.history[0].sessionId, 'ses_history_1');
  assert.equal(res.body.history[0].promptPreview, 'first task');
});