import test from 'node:test';
import assert from 'node:assert/strict';

import { enabledModels, workerClaudeArgs } from './worker.mjs';

test('worker native alias pool is the four OmniRoute combos', () => {
  assert.deepEqual(enabledModels(null), ['sonnet', 'haiku', 'opus', 'fable']);
});

test('worker starts a top-level Claude process with the requested native alias', () => {
  const args = workerClaudeArgs({
    id: 'worker-12345678', worktree: '/tmp/repo-worker', model: 'opus', agent: 'todd', task: 'Review one file',
  });
  assert.deepEqual(args.slice(0, 9), [
    '--print', '--name', 'bizar-worker-12345678', '--model', 'opus',
    '--permission-mode', 'acceptEdits', '--agent', 'todd',
  ]);
  assert.match(args.at(-1), /Do not spawn subagents/);
  assert.match(args.at(-1), /commit one logical change locally/);
});
