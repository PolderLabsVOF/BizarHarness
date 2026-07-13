/**
 * src/server/routes/agents-cc.test.mjs
 *
 * Sprint S10 — Unit tests for the cc-agents helper internals.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internals } from './agents-cc.mjs';
const { enrichSession, listAgents } = _internals;

test('enrichSession returns agent unchanged when no sessionId', () => {
  const a = { id: 'x' };
  assert.deepEqual(enrichSession(a), a);
});

test('enrichSession is a no-op when session directory is missing', () => {
  const a = { id: 'nonexistent-12345', sessionId: 'nonexistent-12345' };
  const out = enrichSession(a);
  assert.equal(out, a);
  assert.equal(out.lastMessageAt, undefined);
});

test('listAgents returns a result object with ts/agents/error fields', async () => {
  const r = await listAgents({ force: true });
  assert.equal(typeof r.ts, 'number');
  assert.ok(Array.isArray(r.agents));
  assert.ok(r.error === null || typeof r.error === 'string');
});

test('listAgents cache hits within TTL without re-running', async () => {
  const first = await listAgents({ force: true });
  const second = await listAgents();
  assert.equal(second.ts, first.ts, 'second call should hit the cache (same ts)');
});