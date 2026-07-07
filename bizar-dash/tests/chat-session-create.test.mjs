/**
 * tests/chat-session-create.test.mjs — v4.2.5
 *
 * Tests the session-mutation endpoints on the cline-sessions router:
 *
 *   POST   /api/cline-sessions/new
 *   PATCH  /api/cline-sessions/:id
 *   DELETE /api/cline-sessions/:id
 *
 * Strategy: stand up a fake cline serve child on a random port,
 * point readServeInfo() at it by writing a tmp serve.json to
 * ~/.cache/bizar/serve.json. The fake serves:
 *
 *   POST   /api/session?directory=...   → returns { data: { id, ... } }
 *   PATCH  /api/session/:id?directory=. → echoes the body as { id }
 *   DELETE /api/session/:id?directory=. → returns 200 or 404
 *
 * For "plugin offline" tests we move serve.json aside, then restore.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  copyFileSync,
  unlinkSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import express from 'express';

import { createClineSessionsRouter } from '../src/server/routes/cline-sessions.mjs';

// ── fake upstream (cline serve child) ──────────────────────────────────

let upstreamServer, upstreamPort;
const upstream = {
  createHits: [],
  patchHits: [],
  deleteHits: [],
  nextCreateStatus: 200,
  nextCreateId: null,
  // Behavior knobs tests can flip:
  failNextCreate: false,
};

function startUpstream() {
  return new Promise((resolve) => {
    upstreamServer = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');

      // CREATE: POST /api/session?directory=...
      if (
        url.pathname === '/api/session' &&
        req.method === 'POST'
      ) {
        let body = '';
        req.on('data', (c) => {
          body += c;
        });
        req.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(body); } catch { parsed = {}; }
          upstream.createHits.push({ url: req.url, body: parsed });
          if (upstream.failNextCreate) {
            upstream.failNextCreate = false;
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'fake-upstream-failure' }));
            return;
          }
          res.writeHead(upstream.nextCreateStatus, {
            'Content-Type': 'application/json',
          });
          const id =
            upstream.nextCreateId ||
            `sess-new-${upstream.createHits.length}`;
          upstream.nextCreateId = null;
          res.end(JSON.stringify({ data: { id, title: parsed.title, agent: parsed.agent } }));
        });
        return;
      }

      // RENAME: PATCH /api/session/:id?directory=...
      const patchM = url.pathname.match(/^\/api\/session\/([^/]+)$/);
      if (patchM && req.method === 'PATCH') {
        let body = '';
        req.on('data', (c) => {
          body += c;
        });
        req.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(body); } catch { parsed = {}; }
          upstream.patchHits.push({ id: patchM[1], url: req.url, body: parsed });
          if (patchM[1] === 'sess-missing') {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: patchM[1], title: parsed.title }));
        });
        return;
      }

      // DELETE: DELETE /api/session/:id?directory=...
      const deleteM = url.pathname.match(/^\/api\/session\/([^/]+)$/);
      if (deleteM && req.method === 'DELETE') {
        upstream.deleteHits.push({ id: deleteM[1], url: req.url });
        if (deleteM[1] === 'sess-gone') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'gone' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: deleteM[1] }));
        return;
      }

      res.writeHead(404);
      res.end('not found');
    });
    upstreamServer.listen(0, '127.0.0.1', () => {
      upstreamPort = upstreamServer.address().port;
      resolve();
    });
  });
}

async function startDashboard() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createClineSessionsRouter());
  dashboardServer = createServer(app);
  await new Promise((r) => dashboardServer.listen(0, '127.0.0.1', r));
  dashboardBaseUrl = `http://127.0.0.1:${dashboardServer.address().port}`;
}

let dashboardServer, dashboardBaseUrl, tmpDir;
let SERVE_JSON_PATH;
let originalServeJson;

before(async () => {
  SERVE_JSON_PATH = `${tmpdir()}/bizar-test-serve-create-${process.pid}-${Date.now()}.json`;
  process.env.BIZAR_SERVE_JSON_PATH = SERVE_JSON_PATH;
  await startUpstream();
  await startDashboard();
  tmpDir = mkdtempSync(join(tmpdir(), 'cline-sessions-create-'));
  if (existsSync(SERVE_JSON_PATH)) {
    originalServeJson = readFileSync(SERVE_JSON_PATH, 'utf8');
  }
});

after(async () => {
  if (originalServeJson !== undefined) {
    writeFileSync(SERVE_JSON_PATH, originalServeJson, 'utf8');
  } else if (existsSync(SERVE_JSON_PATH)) {
    rmSync(SERVE_JSON_PATH);
  }
  if (dashboardServer) await new Promise((r) => dashboardServer.close(r));
  if (upstreamServer) await new Promise((r) => upstreamServer.close(r));
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.BIZAR_SERVE_JSON_PATH;
});

beforeEach(() => {
  upstream.createHits = [];
  upstream.patchHits = [];
  upstream.deleteHits = [];
  upstream.nextCreateStatus = 200;
  upstream.nextCreateId = null;
  upstream.failNextCreate = false;
});

function writeServeJson(worktree = '/tmp/new-session-worktree') {
  writeFileSync(
    SERVE_JSON_PATH,
    JSON.stringify({
      port: upstreamPort,
      password: 'test-pw',
      worktree,
      pid: 99999,
      startedAt: Date.now(),
    }),
    'utf8',
  );
}

/** Move serve.json aside so readServeInfo() returns null.
 *  Uses copy + unlink because rename across filesystems (e.g.
 *  /home/* → /tmp/*) throws EXDEV on Linux. */
function moveServeJsonAside() {
  if (!existsSync(SERVE_JSON_PATH)) return;
  const tmp = join(tmpDir, `serve-aside-${Date.now()}-${process.pid}.json`);
  copyFileSync(SERVE_JSON_PATH, tmp);
  unlinkSync(SERVE_JSON_PATH);
}

// ── tests ─────────────────────────────────────────────────────────────────

test('POST /api/cline-sessions/new returns 201 with id+title+agent on happy path', async () => {
  writeServeJson();
  upstream.nextCreateId = 'sess-fresh-1';
  const r = await fetch(`${dashboardBaseUrl}/api/cline-sessions/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Hello world', agent: 'odin' }),
  });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.id, 'sess-fresh-1');
  assert.equal(body.title, 'Hello world');
  assert.equal(body.agent, 'odin');
  assert.ok(typeof body.directory === 'string' && body.directory.length > 0);
  assert.ok(typeof body.createdAt === 'number' && body.createdAt > 0);
  assert.equal(upstream.createHits.length, 1);
  assert.equal(upstream.createHits[0].body.title, 'Hello world');
  assert.equal(upstream.createHits[0].body.agent, 'odin');
});

test('POST /api/cline-sessions/new returns 400 when body is missing', async () => {
  writeServeJson();
  const r = await fetch(`${dashboardBaseUrl}/api/cline-sessions/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.message, /agent.*required/i);
});

test('POST /api/cline-sessions/new returns 400 when agent missing', async () => {
  writeServeJson();
  const r = await fetch(`${dashboardBaseUrl}/api/cline-sessions/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'no-agent' }),
  });
  assert.equal(r.status, 400);
});

test('POST /api/cline-sessions/new returns 400 when agent is invalid', async () => {
  writeServeJson();
  const r = await fetch(`${dashboardBaseUrl}/api/cline-sessions/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent: 'has space and !' }),
  });
  assert.equal(r.status, 400);
});

test('POST /api/cline-sessions/new returns 502 when upstream 500s', async () => {
  writeServeJson();
  upstream.failNextCreate = true;
  const r = await fetch(`${dashboardBaseUrl}/api/cline-sessions/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent: 'odin' }),
  });
  assert.equal(r.status, 502);
  const body = await r.json();
  assert.equal(body.error, 'cline_error');
  assert.ok(body.message.length > 0);
});

test('POST /api/cline-sessions/new returns 503 plugin_offline when no serve.json', async () => {
  moveServeJsonAside();
  try {
    const r = await fetch(`${dashboardBaseUrl}/api/cline-sessions/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'odin' }),
    });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, 'plugin_offline');
  } finally {
    if (originalServeJson !== undefined)
      writeFileSync(SERVE_JSON_PATH, originalServeJson, 'utf8');
    else writeServeJson('/tmp/session-worktree');
  }
});

test('POST /api/cline-sessions/new defaults title to "Chat: <agent>"', async () => {
  writeServeJson();
  upstream.nextCreateId = 'sess-defaulted-1';
  const r = await fetch(`${dashboardBaseUrl}/api/cline-sessions/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent: 'tyr' }),
  });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.title, 'Chat: tyr');
  assert.equal(upstream.createHits[0].body.title, 'Chat: tyr');
});

test('PATCH /api/cline-sessions/:id renames the session (200)', async () => {
  writeServeJson();
  const r = await fetch(
    `${dashboardBaseUrl}/api/cline-sessions/sess-1`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New title' }),
    },
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.id, 'sess-1');
  assert.equal(body.title, 'New title');
  assert.equal(upstream.patchHits.length, 1);
  assert.equal(upstream.patchHits[0].body.title, 'New title');
});

test('PATCH /api/cline-sessions/:id returns 400 when title missing', async () => {
  writeServeJson();
  const r = await fetch(
    `${dashboardBaseUrl}/api/cline-sessions/sess-1`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  assert.equal(r.status, 400);
});

test('PATCH /api/cline-sessions/:id returns 400 when title is empty', async () => {
  writeServeJson();
  const r = await fetch(
    `${dashboardBaseUrl}/api/cline-sessions/sess-1`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    },
  );
  assert.equal(r.status, 400);
});

test('PATCH /api/cline-sessions/:id returns 404 when upstream 404s', async () => {
  writeServeJson();
  const r = await fetch(
    `${dashboardBaseUrl}/api/cline-sessions/sess-missing`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'whatever' }),
    },
  );
  assert.equal(r.status, 404);
});

test('DELETE /api/cline-sessions/:id returns 200 with { deleted: true }', async () => {
  writeServeJson();
  const r = await fetch(
    `${dashboardBaseUrl}/api/cline-sessions/sess-1`,
    { method: 'DELETE' },
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body, { id: 'sess-1', deleted: true });
  assert.equal(upstream.deleteHits.length, 1);
});

test('DELETE /api/cline-sessions/:id is idempotent (returns 200 even when upstream 404s)', async () => {
  // Idempotent semantics: a "session already gone" response is the
  // desired terminal state — we don't surface that to the client as
  // an error.
  writeServeJson();
  const r = await fetch(
    `${dashboardBaseUrl}/api/cline-sessions/sess-gone`,
    { method: 'DELETE' },
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body, { id: 'sess-gone', deleted: true });
});

test('DELETE /api/cline-sessions/:id returns 400 when id is invalid', async () => {
  writeServeJson();
  const r = await fetch(
    `${dashboardBaseUrl}/api/cline-sessions/has space`,
    { method: 'DELETE' },
  );
  assert.equal(r.status, 400);
});
