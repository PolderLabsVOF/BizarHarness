/**
 * tests/background-spawn-from-ui.test.mjs
 *
 * v5.x — Validates the spawner's input-validation surface only —
 * doesn't actually launch `cline run` (that would block).
 *
 * The full happy-path test lives in a manual run-script (see
 * scripts/bg-spawn-smoke.mjs, future work) because the dashboard
 * sandbox can't guarantee cline is installed + auth'd.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { spawnBgAgent } from '../src/server/bg-spawner.mjs';

test('spawnBgAgent rejects empty args', async () => {
  const r = await spawnBgAgent({});
  assert.equal(r.error, 'missing_required_fields');
  assert.equal(r.instanceId, '');
});

test('spawnBgAgent rejects missing prompt', async () => {
  const r = await spawnBgAgent({ agent: 'mimir', worktree: '/tmp' });
  assert.equal(r.error, 'missing_required_fields');
});

test('spawnBgAgent rejects missing agent', async () => {
  const r = await spawnBgAgent({ prompt: 'hi', worktree: '/tmp' });
  assert.equal(r.error, 'missing_required_fields');
});

test('spawnBgAgent rejects missing worktree', async () => {
  const r = await spawnBgAgent({ agent: 'mimir', prompt: 'hi' });
  assert.equal(r.error, 'missing_required_fields');
});
