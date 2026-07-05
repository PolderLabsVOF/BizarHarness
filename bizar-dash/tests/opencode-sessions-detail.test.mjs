/**
 * tests/opencode-sessions-detail.test.mjs — v4.2.4
 *
 * Tests the opencode session-detail router (GET messages, POST send,
 * GET stream SSE proxy). Strategy: stand up a fake opencode serve child
 * on a random port, point readServeInfo() at it by writing a tmp
 * serve.json to the first candidate path (~/.cache/bizar/serve.json).
 * For the "plugin offline" case, move our tmp serve.json aside so
 * readServeInfo() finds nothing.
 *
 * We restore the original serve.json (if any) in `after()`.
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
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:http';
import express from 'express';

import { createOpencodeSessionDetailRouter } from '../src/server/routes/opencode-session-detail.mjs';

// ── fake upstream (opencode serve child) ──────────────────────────────────

let upstreamServer, upstreamPort;
const upstream = { promptHits: [], lastPromptBody: null, streamChunks: [] };

function startUpstream() {
  return new Promise((resolve) => {
    upstreamServer = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/event') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        for (const c of upstream.streamChunks) res.write(c);
        setTimeout(() => res.end(), 50);
        return;
      }
      const promptM = url.pathname.match(/^\/api\/session\/([^/]+)\/prompt$/);
      if (promptM && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          upstream.promptHits.push({ sessionId: promptM[1], body });
          try { upstream.lastPromptBody = JSON.parse(body); } catch { /* ignore */ }
          if (promptM[1] === 'sess-fail') {
            res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('not found'); return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}');
        });
        return;
      }
      if (url.pathname === '/api/session' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'sess-1', title: 'Test', time: { created: 1, updated: 2, archived: null }, location: { directory: '/tmp/session-worktree' } }] }));
        return;
      }
      const msgM = url.pathname.match(/^\/api\/session\/([^/]+)\/message$/);
      if (msgM && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [
          { info: { id: 'm1', role: 'user', time: { created: 1000 } }, parts: [{ type: 'text', text: 'hello' }] },
          { info: { id: 'm2', role: 'assistant', time: { created: 2000 } }, parts: [{ type: 'text', text: 'hi' }] },
        ] }));
        return;
      }
      res.writeHead(404); res.end('not found');
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
  app.use('/api', createOpencodeSessionDetailRouter());
  dashboardServer = createServer(app);
  await new Promise((r) => dashboardServer.listen(0, '127.0.0.1', r));
  dashboardBaseUrl = `http://127.0.0.1:${dashboardServer.address().port}`;
}

let dashboardServer, dashboardBaseUrl, tmpDir;
let SERVE_JSON_PATH;
let originalServeJson;

before(async () => {
  SERVE_JSON_PATH = `${tmpdir()}/bizar-test-serve-detail-${process.pid}-${Date.now()}.json`;
  process.env.BIZAR_SERVE_JSON_PATH = SERVE_JSON_PATH;
  await startUpstream();
  await startDashboard();
  tmpDir = mkdtempSync(join(tmpdir(), 'opencode-sessions-detail-'));
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
  upstream.promptHits = [];
  upstream.lastPromptBody = null;
  upstream.streamChunks = [];
});

function writeServeJson(worktree) {
  writeFileSync(SERVE_JSON_PATH, JSON.stringify({ port: upstreamPort, password: 'test-pw', worktree, pid: 99999, startedAt: Date.now() }), 'utf8');
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

function parseSseStream(text) {
  const out = [];
  let event = null, dataLines = [];
  for (const line of text.split(/\r?\n/)) {
    if (line === '') {
      if (event !== null || dataLines.length > 0) out.push({ event, data: dataLines.join('\n') });
      event = null; dataLines = [];
      continue;
    }
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  return out;
}

// ── tests ─────────────────────────────────────────────────────────────────

test('GET messages returns 503 plugin_offline when no serve.json', async () => {
  moveServeJsonAside();
  try {
    const res = await fetch(`${dashboardBaseUrl}/api/opencode-sessions/sess-1/messages`);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'plugin_offline');
  } finally {
    // Restore — the next test wants serve.json present again.
    if (originalServeJson !== undefined) writeServeJson(JSON.parse(originalServeJson).worktree);
  }
});

test('GET messages returns 200 with normalized message list', async () => {
  writeServeJson('/tmp/session-worktree');
  const res = await fetch(`${dashboardBaseUrl}/api/opencode-sessions/sess-1/messages`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].id, 'm1');
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages[0].content, 'hello');
  assert.equal(body.messages[0].ts, 1000);
  assert.equal(body.messages[1].role, 'assistant');
  assert.equal(body.messages[1].content, 'hi');
  assert.equal(body.messages[1].ts, 2000);
});

test('POST send returns 400 when body is empty', async () => {
  writeServeJson('/tmp/session-worktree');
  const r = await fetch(`${dashboardBaseUrl}/api/opencode-sessions/sess-1/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
});

test('POST send returns 400 when agent is missing', async () => {
  writeServeJson('/tmp/session-worktree');
  const r = await fetch(`${dashboardBaseUrl}/api/opencode-sessions/sess-1/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi' }),
  });
  assert.equal(r.status, 400);
});

test('POST send returns 400 when message is empty string', async () => {
  writeServeJson('/tmp/session-worktree');
  const r = await fetch(`${dashboardBaseUrl}/api/opencode-sessions/sess-1/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '', agent: 'odin' }),
  });
  assert.equal(r.status, 400);
});

test('POST send returns ok=true with synthesized messageId', async () => {
  writeServeJson('/tmp/session-worktree');
  const r = await fetch(`${dashboardBaseUrl}/api/opencode-sessions/sess-1/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hello there', agent: 'odin' }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.ok(body.messageId.startsWith('msg_'));
  assert.equal(upstream.promptHits.length, 1);
  assert.equal(upstream.lastPromptBody.prompt.text, 'hello there');
  assert.equal(upstream.lastPromptBody.agent, 'odin');
  assert.equal(upstream.lastPromptBody.id, body.messageId);
});

test('POST send returns 502 opencode_error when upstream 404s', async () => {
  writeServeJson('/tmp/session-worktree');
  const r = await fetch(`${dashboardBaseUrl}/api/opencode-sessions/sess-fail/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi', agent: 'odin' }),
  });
  assert.equal(r.status, 502);
  const body = await r.json();
  assert.equal(body.error, 'opencode_error');
  assert.ok(body.message.length > 0);
});

test('SSE stream forwards only events for the requested session', async () => {
  writeServeJson('/tmp/session-worktree');
  upstream.streamChunks = [
    'event: message.updated\ndata: {"type":"message.updated","properties":{"sessionID":"our-id","messageID":"m1"}}\n\n',
    'event: message.updated\ndata: {"type":"message.updated","properties":{"sessionID":"OTHER-id","messageID":"m9"}}\n\n',
    'event: sync\ndata: {"type":"sync","syncEvent":{"type":"session.idle.1","data":{"sessionID":"our-id"}}}\n\n',
  ];
  const res = await fetch(`${dashboardBaseUrl}/api/opencode-sessions/our-id/stream`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.match(res.headers.get('cache-control'), /no-cache/);
  assert.equal(res.headers.get('x-accel-buffering'), 'no');
  const events = parseSseStream(await res.text());
  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'message.updated');
  const d0 = JSON.parse(events[0].data);
  assert.equal(d0.sessionID, 'our-id');
  assert.equal(d0.messageID, 'm1');
  assert.equal(events[1].event, 'session.idle');
  assert.equal(JSON.parse(events[1].data).sessionID, 'our-id');
});

test('SSE stream unwraps sync envelopes and strips version suffix', async () => {
  writeServeJson('/tmp/session-worktree');
  upstream.streamChunks = [
    'event: sync\ndata: {"type":"sync","syncEvent":{"type":"message.updated.1","data":{"sessionID":"our-id","messageID":"m3"}}}\n\n',
  ];
  const res = await fetch(`${dashboardBaseUrl}/api/opencode-sessions/our-id/stream`);
  assert.equal(res.status, 200);
  const events = parseSseStream(await res.text());
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'message.updated');
  const d = JSON.parse(events[0].data);
  assert.equal(d.sessionID, 'our-id');
  assert.equal(d.messageID, 'm3');
});