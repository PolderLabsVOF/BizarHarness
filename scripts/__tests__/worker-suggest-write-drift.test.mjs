/**
 * scripts/__tests__/worker-suggest-write-drift.test.mjs
 *
 * F-194 Phase D — drift guard for the worker-suggest write side.
 *
 * The hook (`config/claude/hooks/worker-suggest.mjs`) must:
 *   1. Export / destructure `recordSuggestion` from `cli/worker-dispatcher.mjs`.
 *   2. Call `recordSuggestion({ matches, cwd, env })` after dispatch().
 *   3. The dispatcher must expose `recordSuggestion` as an exported async
 *      function that delegates to `appendWorkerSuggestion`.
 *   4. `appendWorkerSuggestion` must live in `cli/commands/learning-behavior.mjs`
 *      and use the secure-dir helper to write to behavior.jsonl.
 *   5. `config/trigger-patterns.json` must declare at least 27 workers.
 *
 * Removing any of these breaks the closed-loop: prompts would be ranked
 * but never recorded, so future sessions could not learn from prior
 * operator feedback.
 *
 * Run with `node --test scripts/__tests__/worker-suggest-write-drift.test.mjs`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK_PATH = join(REPO_ROOT, 'config', 'claude', 'hooks', 'worker-suggest.mjs');
const DISPATCH_PATH = join(REPO_ROOT, 'cli', 'worker-dispatcher.mjs');
const LEARNING_PATH = join(REPO_ROOT, 'cli', 'commands', 'learning-behavior.mjs');
const PATTERNS_PATH = join(REPO_ROOT, 'config', 'trigger-patterns.json');

test('worker-suggest.mjs destructures recordSuggestion from dispatcher', () => {
  const src = readFileSync(HOOK_PATH, 'utf8');
  assert.match(
    src,
    /\{\s*dispatch\s*,\s*recordSuggestion\s*\}\s*=\s*await\s+import\(/,
    'hook must destructure { dispatch, recordSuggestion } from the dispatcher import',
  );
});

test('worker-suggest.mjs calls recordSuggestion after dispatch', () => {
  const src = readFileSync(HOOK_PATH, 'utf8');
  // recordSuggestion call must appear AFTER the `suggestions` variable is built.
  const suggestionsIdx = src.indexOf('Bizar workers suggest the following');
  const recordIdx = src.indexOf('recordSuggestion({');
  assert.ok(suggestionsIdx > 0, 'expected suggestions block in hook');
  assert.ok(recordIdx > 0, 'expected recordSuggestion call in hook');
  assert.ok(recordIdx < suggestionsIdx, 'recordSuggestion must run before suggestions are emitted to stderr');
});

test('cli/worker-dispatcher.mjs exports async recordSuggestion', () => {
  const src = readFileSync(DISPATCH_PATH, 'utf8');
  assert.match(
    src,
    /export\s+async\s+function\s+recordSuggestion\s*\(/,
    'dispatcher must export async recordSuggestion({ matches, cwd, env })',
  );
  // The write-side helper must be called inside.
  assert.match(
    src,
    /appendWorkerSuggestion\s*\(/,
    'recordSuggestion must delegate to appendWorkerSuggestion',
  );
});

test('learning-behavior.mjs exports appendWorkerSuggestion using secure-dir helper', () => {
  const src = readFileSync(LEARNING_PATH, 'utf8');
  assert.match(
    src,
    /export\s+function\s+appendWorkerSuggestion\s*\(/,
    'learning-behavior must export appendWorkerSuggestion',
  );
  // Must use the secure-dir helper (0o700) for the learning dir, NOT a hand-rolled mkdirSync.
  assert.match(
    src,
    /ensureLearningDir\s*\(/,
    'appendWorkerSuggestion must resolve the learning dir via ensureLearningDir',
  );
  assert.match(
    src,
    /fingerprint64\s*\(/,
    'appendWorkerSuggestion must compute a 16-char fingerprint via fingerprint64()',
  );
  assert.match(
    src,
    /validateBehaviorRecord\s*\(/,
    'appendWorkerSuggestion must validate every row via validateBehaviorRecord (Q4 invariant)',
  );
});

test('trigger-patterns.json declares at least 27 workers', () => {
  assert.ok(existsSync(PATTERNS_PATH), 'trigger-patterns.json must exist');
  const raw = JSON.parse(readFileSync(PATTERNS_PATH, 'utf8'));
  assert.ok(Array.isArray(raw.workers), 'workers must be an array');
  assert.ok(
    raw.workers.length >= 27,
    `expected at least 27 workers (Phase D v2), got ${raw.workers.length}`,
  );
  // Every worker MUST have an id and at least one regex (or it cannot surface).
  for (const w of raw.workers) {
    assert.ok(typeof w.id === 'string' && w.id.length > 0, `worker missing id: ${JSON.stringify(w)}`);
    assert.ok(
      Array.isArray(w.regex) && w.regex.length > 0,
      `worker ${w.id} must declare at least one regex`,
    );
  }
  // The 16 shipped agents must each appear as at least one worker's `agent`
  // (or be reachable through another worker's mapping).
  const requiredAgents = [
    'mike', 'brenda', 'greg', 'oscar', 'paul', 'linda',
    'todd', 'karen', 'pam', 'steve', 'susan', 'janet',
    'carl', 'kevin', 'brad', 'ria',
  ];
  const allAgents = new Set();
  for (const w of raw.workers) {
    if (typeof w.agent === 'string') allAgents.add(w.agent);
  }
  for (const required of requiredAgents) {
    assert.ok(
      allAgents.has(required),
      `trigger-patterns must map at least one worker to agent ${required}`,
    );
  }
});
