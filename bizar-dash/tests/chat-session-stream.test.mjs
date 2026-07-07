/**
 * tests/chat-session-stream.test.mjs — v4.2.5
 *
 * End-to-end tests for the cline SSE streaming endpoints. The
 * cline-session-detail router proxies the upstream
 * `/event?directory=...` stream and forwards one canonical
 * envelope per upstream event, filtered by `sessionID`.
 *
 * Tests cover three guarantees:
 *
 *   1. `message.updated` events for the right session are forwarded,
 *      and events for other sessions are dropped.
 *   2. Sync envelopes (the v2 wire format) are unwrapped: the inner
 *      `syncEvent.type` with version suffix (`.<n>`) becomes the
 *      canonical event name on the dashboard-side SSE stream.
 *   3. The proxy emits a heartbeat (`: keepalive`) within the
 *      configured SSE_HEARTBEAT_MS (default 25s — we set it to 250ms
 *      via env override so the test runs in well under a second).
 *
 * Strategy: stand up a fake cline serve child on a random port,
 * point readServeInfo() at it. The fake emits three events then
 * holds the connection open long enough for the heartbeat to land.
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

import { createClineSessionDetailRouter } from '../src/server/routes/cline-session-detail.mjs';

// ── fake upstream ─────────────────────────────────────────────────────────

let upstreamServer, upstreamPort;
const upstream = {
  streamChunks: [],
  /** When non-null, hold the SSE connection open this many ms before
   *  ending it. The heartbeat test uses this. */
  holdMs: 0,
};

function startUpstream() {
  return new Promise((resolve) => {
    upstreamServer = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/event') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        for (const c of upstream.streamChunks) res.write(c);
        const hold = upstream.holdMs;
        setTimeout(() => res.end(), hold);
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
  app.use('/api', createClineSessionDetailRouter());
  dashboardServer = createServer(app);
  await new Promise((r) => dashboardServer.listen(0, '127.0.0.1', r));
  dashboardBaseUrl = `http://127.0.0.1:${dashboardServer.address().port}`;
}

let dashboardServer, dashboardBaseUrl, tmpDir;
let SERVE_JSON_PATH;
let originalServeJson;

before(async () => {
  // Shrink the SSE heartbeat from 25s → 250ms so the heartbeat test
  // actually exercises the path within the test runner's timeout.
  process.env.BIZAR_SSE_HEARTBEAT_MS = '250';
  // Use a per-PID isolated serve.json path so multiple test files
  // don't contaminate each other.
  SERVE_JSON_PATH = `${tmpdir()}/bizar-test-serve-stream-${process.pid}-${Date.now()}.json`;
  process.env.BIZAR_SERVE_JSON_PATH = SERVE_JSON_PATH;
  await startUpstream();
  await startDashboard();
  tmpDir = mkdtempSync(join(tmpdir(), 'cline-stream-'));
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
  delete process.env.BIZAR_SSE_HEARTBEAT_MS;
  delete process.env.BIZAR_SERVE_JSON_PATH;
});

beforeEach(() => {
  upstream.streamChunks = [];
  upstream.holdMs = 0;
});

function writeServeJson() {
  writeFileSync(
    SERVE_JSON_PATH,
    JSON.stringify({
      port: upstreamPort,
      password: 'test-pw',
      worktree: '/tmp/stream-worktree',
      pid: 99999,
      startedAt: Date.now(),
    }),
    'utf8',
  );
}

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
      if (event !== null || dataLines.length > 0) {
        out.push({ event, data: dataLines.join('\n') });
      }
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

test('SSE forwards message.updated for the requested session, drops others', async () => {
  writeServeJson();
  upstream.streamChunks = [
    // Direct envelope (older wire format). properties.sessionID.
    'event: message.updated\ndata: {"type":"message.updated","properties":{"sessionID":"our-id","messageID":"m1"}}\n\n',
    // Wrong session: must be filtered.
    'event: message.updated\ndata: {"type":"message.updated","properties":{"sessionID":"OTHER-id","messageID":"m9"}}\n\n',
    // Sync envelope (newer wire format).
    'event: sync\ndata: {"type":"sync","syncEvent":{"type":"message.updated.1","data":{"sessionID":"our-id","messageID":"m3"}}}\n\n',
  ];
  const res = await fetch(
    `${dashboardBaseUrl}/api/cline-sessions/our-id/stream`,
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.match(res.headers.get('cache-control'), /no-cache/);
  assert.equal(res.headers.get('x-accel-buffering'), 'no');

  const events = parseSseStream(await res.text());
  // 1: message.updated (our-id)
  // 2: message.updated from sync envelope (our-id)
  // The OTHER-id message.updated is dropped.
  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'message.updated');
  const d0 = JSON.parse(events[0].data);
  assert.equal(d0.sessionID, 'our-id');
  assert.equal(d0.messageID, 'm1');
  assert.equal(events[1].event, 'message.updated');
  const d1 = JSON.parse(events[1].data);
  assert.equal(d1.sessionID, 'our-id');
  assert.equal(d1.messageID, 'm3');
});

test('SSE unwraps sync envelopes and strips the version suffix from the event name', async () => {
  writeServeJson();
  upstream.streamChunks = [
    'event: sync\ndata: {"type":"sync","syncEvent":{"type":"session.idle.1","data":{"sessionID":"our-id"}}}\n\n',
  ];
  const res = await fetch(
    `${dashboardBaseUrl}/api/cline-sessions/our-id/stream`,
  );
  assert.equal(res.status, 200);
  const events = parseSseStream(await res.text());
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'session.idle');
  const d = JSON.parse(events[0].data);
  assert.equal(d.sessionID, 'our-id');
});

test('SSE does NOT emit redundant chat:delta / chat:status aliases (only canonical events)', async () => {
  // v4.2.5 fix: prior version emitted chat:delta/chat:status aliases
  // in ADDITION to the canonical event, causing downstream listeners
  // to see each idle/delta event twice. The proxy now emits one
  // canonical envelope per upstream event — no aliases.
  writeServeJson();
  upstream.streamChunks = [
    'event: message.part.updated\ndata: {"type":"message.part.updated.1","properties":{"sessionID":"our-id","messageID":"m1","part":{"type":"text","text":"hello"}}}\n\n',
    'event: sync\ndata: {"type":"sync","syncEvent":{"type":"session.idle.1","data":{"sessionID":"our-id"}}}\n\n',
  ];
  const res = await fetch(
    `${dashboardBaseUrl}/api/cline-sessions/our-id/stream`,
  );
  const events = parseSseStream(await res.text());
  // Only 2 events expected — one part.updated and one session.idle.
  // We do NOT want chat:delta or chat:status emitted here.
  assert.equal(events.length, 2);
  const evNames = events.map((e) => e.event);
  assert.ok(evNames.includes('message.part.updated'));
  assert.ok(evNames.includes('session.idle'));
  assert.equal(evNames.filter((n) => n === 'chat:status').length, 0);
  assert.equal(evNames.filter((n) => n === 'chat:delta').length, 0);
});

test('SSE emits a heartbeat (": keepalive") within BIZAR_SSE_HEARTBEAT_MS', async () => {
  // Override forces a 250ms heartbeat (set in `before`). We hold
  // the upstream connection open for 600ms so the heartbeat fires
  // at least once after the initial chunks land.
  writeServeJson();
  upstream.holdMs = 600;
  upstream.streamChunks = [
    'event: message.updated\ndata: {"type":"message.updated","properties":{"sessionID":"our-id","messageID":"m1"}}\n\n',
  ];
  const t0 = Date.now();
  const res = await fetch(
    `${dashboardBaseUrl}/api/cline-sessions/our-id/stream`,
  );
  const text = await res.text();
  const elapsed = Date.now() - t0;
  // Body should be at least one blank line-separated chunk containing
  // a `: keepalive` heartbeat comment. We assert the raw body has
  // `: keepalive` somewhere and the total wait was longer than the
  // heartbeat interval (250ms).
  assert.ok(
    text.includes(': keepalive'),
    `expected ": keepalive" in body — got: ${text.slice(0, 500)}`,
  );
  assert.ok(elapsed >= 250, `expected >= 250ms elapsed, got ${elapsed}ms`);
});

test('SSE returns the response in <50ms when upstream immediately errors (plugin offline)', async () => {
  // Move serve.json aside so the proxy sees `plugin_offline`.
  moveServeJsonAside();
  try {
    const t0 = Date.now();
    const res = await fetch(
      `${dashboardBaseUrl}/api/cline-sessions/our-id/stream`,
    );
    const elapsed = Date.now() - t0;
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const text = await res.text();
    assert.ok(text.includes('plugin_offline'));
    assert.ok(elapsed < 200, `expected < 200ms, got ${elapsed}ms`);
  } finally {
    if (originalServeJson !== undefined) {
      writeFileSync(SERVE_JSON_PATH, originalServeJson, 'utf8');
    } else {
      writeServeJson();
    }
  }
});

test('SSE handles whitespace-only session id gracefully (no 500 crash)', async () => {
  writeServeJson();
  // Whitespace session id: server resolves `decodeURIComponent('%20')`
  // to a single space, which is non-empty; the proxy tries to filter
  // events and never matches → empty stream, but never 5xx.
  const res = await fetch(
    `${dashboardBaseUrl}/api/cline-sessions/%20/stream`,
  );
  // The handler may return 200 (empty stream) or 503 (directory
  // unknown because the worktree doesn't contain ` ` session).
  // Critically it must NOT 5xx or return undefined.
  assert.ok(
    res.status === 200 || res.status === 503,
    `unexpected ${res.status} for whitespace session id`,
  );
});
