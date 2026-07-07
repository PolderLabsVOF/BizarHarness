/**
 * Smoke test for the v2 plugin↔dashboard protocol.
 *
 * Spins up a minimal Express app with the v2 router, runs through:
 *   1. GET  /health                              (public, 200)
 *   2. GET  /api/v2/sessions without auth        (401)
 *   3. GET  /api/v2/sessions with auth           (200, [])
 *   4. POST /api/v2/sessions with auth           (201, session returned)
 *   5. GET  /api/v2/event without auth           (401)
 *   6. POST /api/v2/event + GET /api/v2/event    (subscriber receives the published event)
 *   7. GET  /doc                                 (200, OpenAPI YAML)
 *
 * Run with: node tests/smoke-v2.mjs
 */

import express from 'express';
import { createServer } from 'node:http';
import { V2EventBus } from '../src/server/v2-event-bus.mjs';
import { loadOrCreateAuth } from '../src/server/v2-auth-file.mjs';
import { createV2Router } from '../src/server/routes-v2/index.mjs';
import { setTimeout as sleep } from 'node:timers/promises';

const tests = [];
let pass = 0;
let fail = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function main() {
  // Setup
  const v2Auth = loadOrCreateAuth({ port: 0 }); // 0 = ephemeral file path
  const v2Bus = new V2EventBus({ logger: { log() {}, warn() {}, error() {} } });
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(
    '/api/v2',
    createV2Router({
      eventBus: v2Bus,
      getPassword: () => v2Auth.password,
      version: '0.7.0-alpha.1',
      startedAt: Date.now(),
    }),
  );
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const authHeader =
    'Basic ' + Buffer.from(`cline:${v2Auth.password}`).toString('base64');

  console.log(`\nSmoke test server listening on ${baseUrl}`);
  console.log(`Auth: ${authHeader.slice(0, 32)}...\n`);

  // 1. GET /health (public)
  test('1. GET /health returns 200 (public)', async () => {
    const r = await fetch(`${baseUrl}/api/v2/health`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const body = await r.json();
    if (body.status !== 'ok') throw new Error(`body ${JSON.stringify(body)}`);
  });

  // 2. GET /api/v2/sessions without auth
  test('2. GET /api/v2/sessions without auth returns 401', async () => {
    const r = await fetch(`${baseUrl}/api/v2/sessions`);
    if (r.status !== 401) throw new Error(`status ${r.status}`);
    const body = await r.json();
    if (body.name !== 'DashboardError') throw new Error(`body ${JSON.stringify(body)}`);
  });

  // 3. GET /api/v2/sessions with auth
  test('3. GET /api/v2/sessions with auth returns 200 []', async () => {
    const r = await fetch(`${baseUrl}/api/v2/sessions`, { headers: { Authorization: authHeader } });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const body = await r.json();
    if (!Array.isArray(body)) throw new Error(`not an array: ${JSON.stringify(body)}`);
  });

  // 4. POST /api/v2/sessions with auth
  test('4. POST /api/v2/sessions with auth creates session and returns 201', async () => {
    const r = await fetch(`${baseUrl}/api/v2/sessions`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'mimir', prompt: 'hello' }),
    });
    if (r.status !== 201) throw new Error(`status ${r.status}`);
    const body = await r.json();
    if (!body.id?.startsWith('bgr_')) throw new Error(`bad id: ${body.id}`);
    if (body.agent !== 'mimir') throw new Error(`bad agent: ${body.agent}`);
  });

  // 5. GET /api/v2/event without auth
  test('5. GET /api/v2/event without auth returns 401', async () => {
    const r = await fetch(`${baseUrl}/api/v2/event`, {
      headers: { Accept: 'text/event-stream' },
    });
    if (r.status !== 401) throw new Error(`status ${r.status}`);
  });

  // 6. Subscribe + publish end-to-end
  test('6. SSE subscriber receives published event end-to-end', async () => {
    // Open subscriber
    const subResponse = await fetch(`${baseUrl}/api/v2/event`, {
      headers: { Authorization: authHeader, Accept: 'text/event-stream' },
    });
    if (subResponse.status !== 200) throw new Error(`sub status ${subResponse.status}`);
    if (!subResponse.body) throw new Error('no response body');

    const reader = subResponse.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    // Collect events in the background
    const received = [];
    const collectDone = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // Split on \n\n (SSE event boundary)
          let idx = buf.indexOf('\n\n');
          while (idx !== -1) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            // Parse "event: <type>\ndata: <json>"
            const eventMatch = raw.match(/^event: (.+)$/m);
            const dataMatch = raw.match(/^data: (.+)$/m);
            if (eventMatch && dataMatch) {
              received.push({ type: eventMatch[1], data: JSON.parse(dataMatch[1]) });
            }
            idx = buf.indexOf('\n\n');
          }
        }
      } catch {
        // stream closed
      }
    })();

    // Wait briefly for the dashboard.connected event.
    await sleep(150);

    // Publish an event via POST.
    const publishResponse = await fetch(`${baseUrl}/api/v2/event`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'session.created',
        properties: { sessionId: 'ses_test_1', agent: 'thor' },
      }),
    });
    if (publishResponse.status !== 204) {
      throw new Error(`publish status ${publishResponse.status}`);
    }

    // Wait for the published event to arrive.
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (received.some((e) => e.type === 'session.created')) break;
      await sleep(50);
    }

    // Cleanup: cancel the subscriber.
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }

    if (!received.some((e) => e.type === 'dashboard.connected')) {
      throw new Error('did not receive dashboard.connected');
    }
    if (!received.some((e) => e.type === 'session.created')) {
      throw new Error('did not receive published session.created');
    }
    await collectDone.catch(() => {});
  });

  // 7. GET /doc
  test('7. GET /doc returns OpenAPI YAML', async () => {
    const r = await fetch(`${baseUrl}/api/v2/doc`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('yaml')) throw new Error(`bad content-type: ${ct}`);
    const text = await r.text();
    if (!text.startsWith('openapi:')) throw new Error(`not YAML: ${text.slice(0, 80)}`);
  });

  // Run tests
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  PASS  ${t.name}`);
      pass += 1;
    } catch (err) {
      console.log(`  FAIL  ${t.name}`);
      console.log(`        ${err.message}`);
      fail += 1;
    }
  }

  // Cleanup
  await new Promise((resolve) => server.close(resolve));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(2);
});
