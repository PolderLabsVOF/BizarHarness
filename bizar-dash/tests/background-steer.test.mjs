/**
 * tests/background-steer.test.mjs
 *
 * v5.5.1 — Tests for the steer broker helper. The helper now performs
 * TRUE mid-flight steering (`sdk.sessions.prompt()`) instead of the
 * v5.5.0 kill+respawn path.
 *
 * Validation surface (empty message, missing instance) is the same
 * shape as v5.5.0 — `steerBgAgent` still rejects empty input and
 * unknown instances with structured errors. The success path is
 * covered by the smoke script because it requires a live opencode
 * serve child.
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

test('steerBgAgent with missing instance returns not_found (or unavailable)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'bgspr-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tmp;
  try {
    const r = await steerBgAgent('bgr_definitely_missing', 'go faster');
    assert.equal(r.ok, false);
    assert.match(r.error || '', /instance_not_found|opencode_serve_unavailable|file/);
  } finally {
    process.env.HOME = originalHome;
  }
});

test('steerBgAgent success-shape (when SDK + instance present) is mode=true_midflight + steerCount', async () => {
  // Documentation pin: the success response carries
  // `{ ok: true, mode: 'true_midflight', instanceId, steerCount }` —
  // NOT a `newInstanceId` substitution (the v5.5.0 kill+respawn path).
  // Assert the source carries the new shape so a future regression is
  // caught. The live success-path is exercised in the smoke script.
  const src = (await import('node:fs')).readFileSync(
    new URL('../src/server/bg-spawner.mjs', import.meta.url),
    'utf-8',
  );
  assert.match(src, /mode:\s*["']true_midflight["']/);
  assert.match(src, /steerCount\s*:/);
});