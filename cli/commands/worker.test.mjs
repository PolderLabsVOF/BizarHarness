import test from 'node:test';
import assert from 'node:assert/strict';

import { enabledModels, workerClaudeArgs } from './worker.mjs';

test('exact-model workers admit only enabled global selections and honor disabled providers', () => {
  const models = enabledModels({
    disabledProviders: ['anthropic'],
    userSelected: { models: ['minimax/MiniMax-M3', 'anthropic/claude-sonnet-4', 'codex/gpt-5.6-sol'] },
  });
  assert.deepEqual(models, ['minimax/MiniMax-M3', 'codex/gpt-5.6-sol']);
});

test('exact-model worker starts a top-level Claude process with the literal selected model', () => {
  const args = workerClaudeArgs({
    id: 'worker-12345678', worktree: '/tmp/repo-worker', model: 'codex/gpt-5.6-sol', agent: 'todd', task: 'Review one file',
  });
  assert.deepEqual(args.slice(0, 9), [
    '--print', '--name', 'bizar-worker-12345678', '--model', 'codex/gpt-5.6-sol',
    '--permission-mode', 'acceptEdits', '--agent', 'todd',
  ]);
  assert.match(args.at(-1), /Do not spawn subagents/);
  assert.match(args.at(-1), /commit one logical change locally/);
});
