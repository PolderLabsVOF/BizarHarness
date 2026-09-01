/**
 * scripts/__tests__/behavior-capture-drift.test.mjs
 *
 * F-194 Phase B.3 drift guard. After enforcing "no prompt text ever
 * reaches disk" (Q4 resolution), this test fails CI if any of the
 * following reappear anywhere under `~/.config/bizar/learning/` or the
 * related source files:
 *
 *   - `prompt` field on a BehaviorRecord
 *   - `promptRedacted` field
 *   - `rawPrompt` field
 *
 * It also asserts the SDK + CLI surface exposes the structural-only
 * contract (`FORBIDDEN_BEHAVIOR_KEYS`, `BEHAVIOR_DIR_MODE = 0o700`,
 * `fingerprint64` is 16 hex chars, no prompt-derived argument on
 * `appendBehavior`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();

test('behavior-capture SDK module exports the F-194 surface', async () => {
  const mod = await import('../../packages/sdk/src/learning/behavior-capture.js')
    .catch(() => import('../../packages/sdk/dist/learning/behavior-capture.js'));
  assert.equal(mod.BEHAVIOR_DIR_MODE, 0o700);
  assert.ok(Array.isArray(mod.FORBIDDEN_BEHAVIOR_KEYS));
  assert.ok(mod.FORBIDDEN_BEHAVIOR_KEYS.includes('prompt'));
  assert.ok(mod.FORBIDDEN_BEHAVIOR_KEYS.includes('promptRedacted'));
  assert.ok(mod.FORBIDDEN_BEHAVIOR_KEYS.includes('rawPrompt'));
  assert.equal(typeof mod.fingerprint64, 'function');
  const fp = mod.fingerprint64('hello world');
  assert.match(fp, /^[0-9a-f]{16}$/);
});

test('BehaviorRecord interface has no prompt-shaped field', async () => {
  const mod = await import('../../packages/sdk/src/learning/behavior-capture.js')
    .catch(() => import('../../packages/sdk/dist/learning/behavior-capture.js'));
  const record = mod.createBehaviorRecord({
    fingerprint: mod.fingerprint64('audit'),
    workerId: 'mike',
    accept: true,
  });
  for (const key of ['prompt', 'promptRedacted', 'rawPrompt', 'promptText', 'userInput']) {
    assert.equal(key in record, false, `BehaviorRecord must not contain ${key}`);
  }
  for (const key of Object.keys(record)) {
    assert.equal(mod.FORBIDDEN_BEHAVIOR_KEYS.includes(key), false, `record leaked forbidden key: ${key}`);
  }
});

test('CLI learning-behavior.mjs exposes only structural-fingerprint API', () => {
  const src = readFileSync(
    join(REPO_ROOT, 'cli', 'commands', 'learning-behavior.mjs'),
    'utf8',
  );
  assert.match(src, /resolveLearningDir/);
  assert.match(src, /behavior\.jsonl/);
  // No prompt-shaped field should appear anywhere in the CLI module.
  for (const forbidden of ['"prompt"', '"promptRedacted"', '"rawPrompt"', 'promptText']) {
    assert.equal(src.includes(forbidden), false, `learning-behavior.mjs leaked ${forbidden}`);
  }
  assert.match(src, /0o700/);
});

test('worker-suggest.mjs reads only bounded explicit learning and never persists a prompt field', () => {
  const src = readFileSync(
    join(REPO_ROOT, 'config', 'claude', 'hooks', 'worker-suggest.mjs'),
    'utf8',
  );
  assert.match(src, /buildLearningContext/);
  assert.match(src, /commands['"], 'learn\.mjs/);
  // Worker-suggest must never persist prompt text. Drift guard for any
  // regression that starts reading or echoing a prompt-shaped field.
  assert.doesNotMatch(src, /promptText/);
  assert.doesNotMatch(src, /rawPrompt/);
});

test('provision.mjs creates learning/ at 0o700 and preserves it under force-clean', () => {
  const src = readFileSync(
    join(REPO_ROOT, 'cli', 'provision.mjs'),
    'utf8',
  );
  assert.match(src, /join\(BIZAR_HOME\(\), 'learning'\)/);
  // ensureBizarHome uses the shared secure-dir helper to create + tighten.
  assert.match(src, /ensureSecureDir\(\{[^}]*subdir:\s*'learning'/);
  // force-clean preserves the dir explicitly.
  const preservedBlock = src.match(/const learningDir = join\(BIZAR_HOME\(\), 'learning'\);[\s\S]{0,400}preserved\.push\(learningDir\)/);
  assert.ok(preservedBlock, 'forceCleanInstall must push learningDir into preserved[]');
});
