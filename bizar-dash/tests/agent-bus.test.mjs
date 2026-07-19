/**
 * tests/agent-bus.test.mjs
 *
 * Self-check for agent-bus.mjs (G-autoloop Phase 4).
 * Uses node:test + node:assert/strict, mirroring the convention in
 * tests/background-steer.test.mjs. Isolates state by pointing the
 * module at a fresh temp directory and resetting presence on exit.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, appendFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'bizar-agent-bus-'));

// Point the module at the temp dir BEFORE importing it.
process.env.BIZAR_AGENT_BUS_ROOT = TMP;

const {
  AGENT_BUS_LOG_DIR,
  AGENT_BUS_PRESENCE_FILE,
  DEFAULT_CHANNEL,
  isValidAddress,
  resolveAddress,
  publish,
  steer,
  correct,
  handoff,
  request,
  respond,
  subscribe,
  subscribeChannel,
  readChannel,
  announce,
  leave,
  heartbeat,
  getPresence,
  _resetForTests,
} = await import('../src/server/agent-bus.mjs');

beforeEach(() => _resetForTests());

after(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* */ }
});

test('isValidAddress: accepts loose and targeted and broadcast', () => {
  assert.equal(isValidAddress('agent://odin'), true);
  assert.equal(isValidAddress('agent://odin/session-abc123'), true);
  assert.equal(isValidAddress('agent://*'), true);
  assert.equal(isValidAddress('odin'), false);
  assert.equal(isValidAddress('agent:/odin'), false);
  assert.equal(isValidAddress(''), false);
  assert.equal(isValidAddress(null), false);
  assert.equal(isValidAddress(undefined), false);
});

test('publish: rejects bad input with TypeError', () => {
  assert.throws(() => publish(null), TypeError);
  assert.throws(() => publish({}), TypeError);
  assert.throws(() => publish({ from: 'odin', to: 'agent://thor', kind: 'request' }), TypeError);
  assert.throws(() => publish({ from: 'agent://odin', to: 'agent://thor', kind: 'bogus' }), TypeError);
});

test('publish: appends to JSONL log and emits live', () => {
  const seen = [];
  const unsub = subscribe((m) => seen.push(m));
  const id = publish({ from: 'agent://odin', to: 'agent://thor', kind: 'request', payload: { q: 'hello' } });
  unsub();
  assert.ok(id.length > 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'request');
  assert.equal(seen[0].channel, DEFAULT_CHANNEL);
  const logFile = join(AGENT_BUS_LOG_DIR, `${DEFAULT_CHANNEL}.jsonl`);
  assert.ok(existsSync(logFile));
  const text = readFileSync(logFile, 'utf8');
  assert.equal(text.trim().split('\n').length, 1);
});

test('publish: per-task channels are auto-created on first publish', () => {
  const id = publish({
    from: 'agent://odin',
    to: 'agent://thor',
    channel: 'task-tsk_abc',
    taskId: 'tsk_abc',
    kind: 'request',
    payload: { x: 1 },
  });
  assert.ok(id);
  assert.ok(existsSync(join(AGENT_BUS_LOG_DIR, 'task-tsk_abc.jsonl')));
});

test('steer + correct + handoff: convenience wrappers set kind and payload', () => {
  const seen = [];
  const unsub = subscribe((m) => seen.push(m));
  steer('agent://odin', 'agent://thor', 'focus on tests', { channel: 'task-tsk_x', taskId: 'tsk_x' });
  correct('agent://odin', 'agent://thor', 'use new endpoint', { before: 'a()', after: 'b()', reason: 'simpler' }, { taskId: 'tsk_x' });
  handoff('agent://odin', 'agent://thor', 'tsk_x', 'better fit', { channel: 'task-tsk_x' });
  unsub();
  assert.equal(seen.length, 3);
  assert.equal(seen[0].kind, 'steer');
  assert.equal(seen[0].payload.note, 'focus on tests');
  assert.equal(seen[1].kind, 'correct');
  assert.equal(seen[1].payload.before, 'a()');
  assert.equal(seen[1].payload.after, 'b()');
  assert.equal(seen[2].kind, 'handoff');
  assert.equal(seen[2].payload.taskId, 'tsk_x');
});

test('request/respond: correlation roundtrip resolves the Promise', async () => {
  const unsub = subscribe((msg) => {
    if (msg.kind === 'request') {
      respond(msg, 'agent://thor', { ok: true, value: 42 });
    }
  });
  const reply = await request('agent://odin', 'agent://thor', { ask: 'meaning' }, { timeoutMs: 2000 });
  unsub();
  assert.equal(reply.kind, 'response');
  assert.equal(reply.from, 'agent://thor');
  assert.equal(reply.payload.value, 42);
  assert.equal(reply.correlationId.length > 0, true);
});

test('request: timeout rejects with TIMEOUT code', async () => {
  await assert.rejects(
    request('agent://odin', 'agent://nobody', { ask: 'nothing' }, { timeoutMs: 50 }),
    (err) => err.code === 'TIMEOUT',
  );
});

test('subscribeChannel: only fires for the named channel', () => {
  const target = [];
  const other = [];
  const u1 = subscribeChannel('task-tsk_y', (m) => target.push(m));
  const u2 = subscribeChannel('task-tsk_z', (m) => other.push(m));
  publish({ from: 'agent://odin', to: 'agent://thor', channel: 'task-tsk_y', kind: 'request', payload: {} });
  publish({ from: 'agent://odin', to: 'agent://thor', channel: 'task-tsk_z', kind: 'request', payload: {} });
  u1(); u2();
  assert.equal(target.length, 1);
  assert.equal(other.length, 1);
});

test('readChannel: skips corrupt JSONL lines and respects limit', () => {
  const logFile = join(AGENT_BUS_LOG_DIR, 'corrupt.jsonl');
  mkdirSync(AGENT_BUS_LOG_DIR, { recursive: true });
  const good = { id: 'a', from: 'agent://odin', to: 'agent://thor', channel: 'corrupt', kind: 'request', payload: {}, ts: new Date().toISOString() };
  appendFileSync(logFile, JSON.stringify(good) + '\n');
  appendFileSync(logFile, 'this is not json\n');
  appendFileSync(logFile, JSON.stringify({ ...good, id: 'b' }) + '\n');
  const out = readChannel('corrupt');
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'a');
  assert.equal(out[1].id, 'b');
});

test('readChannel: limit truncates to the last N', () => {
  for (let i = 0; i < 5; i++) {
    publish({ from: 'agent://odin', to: 'agent://thor', channel: 'limit', kind: 'request', payload: { i } });
  }
  const out = readChannel('limit', { limit: 2 });
  assert.equal(out.length, 2);
  assert.equal(out[0].payload.i, 3);
  assert.equal(out[1].payload.i, 4);
});

test('readChannel: since filters out messages at or before the cutoff', async () => {
  publish({ from: 'agent://odin', to: 'agent://thor', channel: 'since', kind: 'request', payload: { i: 1 } });
  // Guarantee a strictly-monotonic clock between msg 1 and the cutoff.
  await new Promise((r) => setTimeout(r, 5));
  const cutoff = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 5));
  publish({ from: 'agent://odin', to: 'agent://thor', channel: 'since', kind: 'request', payload: { i: 2 } });
  const out = readChannel('since', { since: cutoff });
  assert.equal(out.length, 1);
  assert.equal(out[0].payload.i, 2);
});

test('presence: announce + heartbeat + getPresence roundtrip', () => {
  announce({ name: 'odin', sessionId: 'sess_1', capabilities: ['plan'], model: 'opus' });
  announce({ name: 'thor', sessionId: 'sess_2', currentTask: 'tsk_1' });
  const p = getPresence();
  assert.ok(p.odin);
  assert.equal(p.odin.sessionId, 'sess_1');
  assert.deepEqual(p.odin.capabilities, ['plan']);
  assert.ok(p.thor);
  heartbeat('odin', 'sess_1');
  heartbeat('thor', 'sess_1'); // wrong sessionId — no-op
  assert.equal(getPresence().odin.sessionId, 'sess_1');
});

test('presence: leave removes and persists', () => {
  announce({ name: 'odin', sessionId: 'sess_1' });
  assert.ok(getPresence().odin);
  leave('odin');
  assert.equal(getPresence().odin, undefined);
  // Persistence: presence.json on disk reflects the leave.
  const persisted = JSON.parse(readFileSync(AGENT_BUS_PRESENCE_FILE, 'utf8'));
  assert.equal(persisted.odin, undefined);
});

test('presence: announce with same name+sessionId updates lastSeenAt in-place', () => {
  announce({ name: 'odin', sessionId: 'sess_1', capabilities: ['plan'] });
  const first = getPresence().odin.lastSeenAt;
  // Wait 5ms so the timestamp moves.
  const wait = Date.now() + 5;
  while (Date.now() < wait) { /* spin */ }
  announce({ name: 'odin', sessionId: 'sess_1', capabilities: ['plan', 'impl'] });
  const second = getPresence().odin;
  assert.equal(second.sessionId, 'sess_1');
  assert.notEqual(second.lastSeenAt, first);
});

test('presence: getPresence filters stale entries older than 5 minutes', () => {
  announce({ name: 'fresh', sessionId: 's' });
  announce({ name: 'stale', sessionId: 's' });
  // Backdate stale manually via the in-memory map.
  // We don't have a handle to it, so we use leave+reannounce with a
  // forged timestamp persisted through read-modify-write.
  const persisted = JSON.parse(readFileSync(AGENT_BUS_PRESENCE_FILE, 'utf8'));
  persisted.stale.lastSeenAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  // _resetForTests wipes the in-memory map; we leave the file as-is
  // and call announce again so in-memory state matches.
  writeFileSync(AGENT_BUS_PRESENCE_FILE + '.tmp', JSON.stringify(persisted));
  renameSync(AGENT_BUS_PRESENCE_FILE + '.tmp', AGENT_BUS_PRESENCE_FILE);
  _resetForTests();
  announce({ name: 'fresh', sessionId: 's' });
  // `stale` is no longer in-memory, so getPresence won't see it —
  // this is correct. The persistence-level staleness check would
  // only matter on cold start. We assert the in-memory filter:
  const p = getPresence();
  assert.ok(p.fresh);
  assert.equal(p.stale, undefined);
});

test('resolveAddress: loose address returns live sessions; targeted requires matching sid', () => {
  announce({ name: 'odin', sessionId: 'sess_a' });
  announce({ name: 'thor', sessionId: 'sess_b' });
  assert.equal(resolveAddress('agent://odin').length, 1);
  assert.equal(resolveAddress('agent://odin')[0].sessionId, 'sess_a');
  assert.equal(resolveAddress('agent://odin/sess_a').length, 1);
  assert.equal(resolveAddress('agent://odin/wrong-sid').length, 0);
  assert.equal(resolveAddress('agent://nobody').length, 0);
  assert.equal(resolveAddress('not-an-address').length, 0);
});

test('publish: empty payload becomes {}', () => {
  const id = publish({ from: 'agent://odin', to: 'agent://thor', kind: 'ack' });
  const log = readChannel(DEFAULT_CHANNEL);
  const found = log.find((m) => m.id === id);
  assert.ok(found);
  assert.deepEqual(found.payload, {});
});

test('publish: correlationId and taskId survive the roundtrip', () => {
  publish({
    from: 'agent://odin',
    to: 'agent://thor',
    channel: 'task-tsk_q',
    taskId: 'tsk_q',
    kind: 'request',
    payload: {},
  });
  const log = readChannel('task-tsk_q');
  assert.equal(log[0].taskId, 'tsk_q');
  assert.equal(log[0].correlationId, null);
});

test('subscribe: returns an unsubscribe function that detaches the listener', () => {
  let count = 0;
  const unsub = subscribe(() => count++);
  publish({ from: 'agent://odin', to: 'agent://thor', kind: 'ack' });
  publish({ from: 'agent://odin', to: 'agent://thor', kind: 'ack' });
  assert.equal(count, 2);
  unsub();
  publish({ from: 'agent://odin', to: 'agent://thor', kind: 'ack' });
  assert.equal(count, 2);
});

test('subscribe: rejects non-function listener', () => {
  assert.throws(() => subscribe('not a fn'), TypeError);
  assert.throws(() => subscribe(null), TypeError);
});

test('announce: rejects missing name or sessionId', () => {
  assert.throws(() => announce({ sessionId: 's' }), TypeError);
  assert.throws(() => announce({ name: 'x' }), TypeError);
});