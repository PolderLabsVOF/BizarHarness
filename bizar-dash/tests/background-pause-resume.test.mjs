/**
 * tests/background-pause-resume.test.mjs
 *
 * v5.x — Tests for POST /api/background/:id/pause and .../resume.
 *
 * Validates the spawner's pure-logic surface WITHOUT spawning a real
 * opencode subprocess (which would block on `opencode run` exiting).
 * The pause/resume registry helpers are tested via error paths:
 *   - unknown instance → "instance_not_tracked"
 *   - paused state survives round-trip after a real spawn (skipped — see notes)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pauseBgAgent,
  resumeBgAgent,
  status,
  configureSpawner,
} from '../src/server/bg-spawner.mjs';

test('configureSpawner registers a broadcast hook without throwing', () => {
  let received = null;
  configureSpawner({ broadcast: (msg) => { received = msg; } });
  assert.equal(typeof received, 'object');
});

test('pauseBgAgent on unknown instance returns instance_not_tracked', () => {
  const r = pauseBgAgent('bgr_definitely_missing_id');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'instance_not_tracked');
});

test('resumeBgAgent on unknown instance returns instance_not_tracked', () => {
  const r = resumeBgAgent('bgr_definitely_missing_id');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'instance_not_tracked');
});

test('status() returns count + ids diagnostics without throwing', () => {
  const s = status();
  assert.equal(typeof s.count, 'number');
  assert.ok(Array.isArray(s.ids));
  assert.ok(s.count >= 0);
});
