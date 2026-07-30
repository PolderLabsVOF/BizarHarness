import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { enqueueControlMessage } from './control-store.mjs';

const HOOK = resolve(import.meta.dirname, '..', '.claude', 'hooks', 'control-inbox.mjs');
const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

test('control inbox hook injects targeted messages as additional context', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-control-hook-'));
  roots.push(root);
  enqueueControlMessage(root, {
    from: 'openkan',
    toSession: 'session-1',
    text: 'Continue with the verified plan.',
  });

  const result = spawnSync(process.execPath, [HOOK], {
    cwd: root,
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'SessionStart',
      session_id: 'session-1',
      agent_type: 'mike',
      cwd: root,
    }),
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.continue, true);
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /Continue with the verified plan/,
  );
});
