/**
 * tests/background-steer.test.mjs
 *
 * v5.x — Tests for the steer-broker helper. Validates that the
 * helper accepts a non-empty message and rejects empty input. We do
 * NOT exercise the kill+respawn path here because it requires a real
 * `opencode` binary on PATH; see background-spawn-from-ui.test.mjs
 * for that path.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { steerBgAgent } from '../src/server/bg-spawner.mjs';

test('steerBgAgent rejects empty message', async () => {
  const r = await steerBgAgent('bgr_nope', '');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'message_empty');
});

test('steerBgAgent rejects whitespace-only message', async () => {
  const r = await steerBgAgent('bgr_nope', '   ');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'message_empty');
});

test('steerBgAgent with missing instance returns not_found', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'bgspr-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tmp;
  try {
    const r = await steerBgAgent('bgr_definitely_missing', 'go faster');
    assert.equal(r.ok, false);
    assert.match(r.error || '', /instance_not_found|file/);
  } finally {
    process.env.HOME = originalHome;
  }
});
