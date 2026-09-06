/**
 * config/claude/hooks/__tests__/alias-routing.test.mjs
 *
 * Regression fence for the post-cutover alias routing contract.
 *
 *   1. `worker-suggest.mjs` emits an `additionalContext` that mentions
 *      all four native aliases (`haiku`/`sonnet`/`opus`/`fable`) and
 *      explicitly forbids raw gateway IDs and `args.routing`.
 *   2. The hooks directory no longer contains any of the removed
 *      model-router/picker files (`agent-model-guard.mjs`,
 *      `sessionstart-model-sync.mjs`, `thinking-route.mjs`).
 *   3. No hook in scope references `bizar models` or the global router.
 *
 * Run with `node --test config/claude/hooks/__tests__/alias-routing.test.mjs`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = join(__dirname, '..');
const WORKER_SUGGEST = join(HOOKS_DIR, 'worker-suggest.mjs');
const README = join(HOOKS_DIR, 'README.md');

const src = readFileSync(WORKER_SUGGEST, 'utf8');

test('worker-suggest: policy text names all four static aliases', () => {
  assert.match(src, /pick ONE of the four native aliases/);
  for (const alias of ['haiku', 'sonnet', 'opus', 'fable']) {
    assert.ok(src.includes('`' + alias + '`'), `worker-suggest must name ${alias}`);
  }
});

test('worker-suggest: policy text forbids raw gateway IDs and args.routing', () => {
  assert.match(src, /Do NOT pass a raw gateway ID/);
  assert.match(src, /Do NOT read model-router state/);
  assert.match(src, /Do NOT construct `args\.routing`/);
});

test('worker-suggest: policy text names OmniRoute as the failover handler', () => {
  assert.match(src, /OmniRoute handles ordered failover/);
});

test('hooks: deleted model-router/picker files are absent', () => {
  for (const name of [
    'agent-model-guard.mjs',
    'sessionstart-model-sync.mjs',
    'thinking-route.mjs',
    '__tests__/agent-model-guard.test.mjs',
    '__tests__/sessionstart-model-sync.test.mjs',
    '__tests__/thinking-route.test.mjs',
  ]) {
    assert.ok(!existsSync(join(HOOKS_DIR, name)), `${name} must be deleted`);
  }
});

test('hooks README: documents the static-alias architecture', () => {
  const readme = readFileSync(README, 'utf8');
  assert.match(readme, /Static alias architecture/);
  assert.match(readme, /haiku/);
  assert.match(readme, /sonnet/);
  assert.match(readme, /opus/);
  assert.match(readme, /fable/);
});

test('hooks README: explicitly enumerates the removed surfaces', () => {
  const readme = readFileSync(README, 'utf8');
  assert.match(readme, /Removed surfaces/);
  assert.match(readme, /agent-model-guard\.mjs/);
  assert.match(readme, /sessionstart-model-sync\.mjs/);
  assert.match(readme, /thinking-route\.mjs/);
});
