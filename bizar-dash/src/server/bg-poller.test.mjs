/**
 * src/server/bg-poller.test.mjs
 *
 * Sprint S10 — Digest test for the CC-agents change detector.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _pollerInternals } from './bg-poller.mjs';
const { digestAgents } = _pollerInternals;

test('digestAgents stable for identical input', () => {
  const a = [{ id: '1', status: 'busy' }];
  const b = [{ id: '1', status: 'busy' }];
  assert.equal(digestAgents(a), digestAgents(b));
});

test('digestAgents changes when status changes', () => {
  const a = [{ id: '1', status: 'busy' }];
  const b = [{ id: '1', status: 'idle' }];
  assert.notEqual(digestAgents(a), digestAgents(b));
});

test('digestAgents order-independent', () => {
  const a = [{ id: '1' }, { id: '2' }];
  const b = [{ id: '2' }, { id: '1' }];
  assert.equal(digestAgents(a), digestAgents(b));
});