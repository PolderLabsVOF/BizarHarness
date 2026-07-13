/**
 * tests/e2e/ws-chat-roundtrip.mjs
 *
 * Sprint S37 — verifies the v9.3.0 chat WS protocol.
 *
 * Boots the dashboard server against a real tmp project, opens a
 * WebSocket connection, sends a synthetic `chat:message` via the
 * `localBroadcast()` channel, and asserts the client receives the
 * raw envelope. Plus a heartbeat check that the WS upgrade succeeds
 * with the expected handshake response.
 *
 * This doesn't spawn a real Claude Code process — that would require
 * the CLI on PATH and a working API key. Instead it validates the
 * transport contract (event type set, session field, payload shape)
 * the chat surface depends on.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { broadcast, createServer } from '../../bizar-dash/src/server/server.mjs';

const EVIDENCE = process.env.BIZAR_E2E_EVIDENCE ||
  join(tmpdir(), `bizar-ws-chat-${process.pid}.json`);
const PORT = Number(
  (process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1] || 4184,
);

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${tag}  ${step}${detail ? `  -- ${detail}` : ''}`);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const projectDir = mkdtempSync(join(tmpdir(), 'bizar-e2e-chat-'));
mkdirSync(join(projectDir, '.bizar'), { recursive: true });
writeFileSync(
  join(projectDir, '.bizar/PROGRESS.md'),
  '# E2E chat fixture\n\n## Goal — verify chat protocol\n'
);

const boot = await createServer({
  port: PORT,
  projectRoot: projectDir,
  clineConfigDir: join(projectDir, '.config', 'cline'),
  bizarRoot: projectDir,
});
await new Promise((resolve, reject) => {
  boot.server.once('error', reject);
  boot.server.listen(PORT, '127.0.0.1', () => { boot.server.off('error', reject); resolve(); });
});

try {
  // 1. WS handshake
  const ws = new WebSocket(`ws://127.0.0.1:${boot.port}/ws`);
  const received = [];
  const wsReady = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('ws open timeout')), 5_000);
    ws.on('open', () => { clearTimeout(to); resolve(); });
    ws.on('error', (err) => { clearTimeout(to); reject(err); });
  });
  ws.on('message', (raw) => {
    try { received.push(JSON.parse(String(raw))); } catch { /* swallow non-JSON */ }
  });
  await wsReady;
  record('ws.handshake', true, `port=${boot.port}`);

  // 2. Broadcast a synthetic chat:delta and assert it arrives.
  broadcast({ type: 'chat:delta', session: 'sess_test', text: 'hello' });
  await delay(50);
  const delta = received.find((m) => m.type === 'chat:delta');
  record(
    'chat.delta_receive',
    delta !== undefined && delta.session === 'sess_test' && delta.text === 'hello',
    delta ? `session=${delta.session} text.len=${delta.text.length}` : 'no delta received'
  );

  // 3. Broadcast chat:message (final persisted turn).
  broadcast({
    type: 'chat:message',
    session: 'sess_test',
    message: {
      id: 'msg_test',
      ts: new Date().toISOString(),
      role: 'assistant',
      content: 'world',
    },
  });
  await delay(50);
  const final = received.find((m) => m.type === 'chat:message');
  record(
    'chat.message_receive',
    final !== undefined && final.message?.content === 'world' && final.session === 'sess_test',
    final ? `id=${final.message?.id}` : 'no final received'
  );

  // 4. Broadcast chat:done.
  broadcast({ type: 'chat:done', session: 'sess_test' });
  await delay(50);
  const done = received.find((m) => m.type === 'chat:done');
  record('chat.done_receive', done !== undefined && done.session === 'sess_test', done ? `session=${done.session}` : 'no done');

  // 5. Broadcast chat:error.
  broadcast({ type: 'chat:error', session: 'sess_test', error: 'rate_limited', status: 429 });
  await delay(50);
  const err = received.find((m) => m.type === 'chat:error');
  record(
    'chat.error_receive',
    err !== undefined && err.error === 'rate_limited' && err.status === 429,
    err ? `status=${err.status} error=${err.error}` : 'no error'
  );

  // 6. broadcast projects:change and history:new (the other v9.3.0 events).
  broadcast({ type: 'projects:change', active: 'proj_x' });
  broadcast({ type: 'history:new', event: { id: 'h_1', ts: Date.now() } });
  await delay(50);
  const proj = received.find((m) => m.type === 'projects:change');
  const hist = received.find((m) => m.type === 'history:new');
  record(
    'ws.other_v930_events',
    proj?.active === 'proj_x' && hist?.event?.id === 'h_1',
    `proj.active=${proj?.active} history.id=${hist?.event?.id}`
  );

  ws.close();
} catch (err) {
  record('ws.handshake', false, err.message);
} finally {
  await boot.close?.();
}

// Write evidence
try {
  writeFileSync(EVIDENCE, JSON.stringify({ results, port: boot.port }, null, 2));
} catch (err) {
  console.warn('failed to write evidence:', err.message);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} of ${results.length} steps failed`);
  process.exit(1);
}
console.log(`\nAll ${results.length} steps passed; evidence at ${EVIDENCE}`);
process.exit(0);
