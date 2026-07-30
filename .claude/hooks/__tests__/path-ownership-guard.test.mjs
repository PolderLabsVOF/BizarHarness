import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { TaskLedger } from '../../../cli/task-ledger.mjs';

const HOOK = join(import.meta.dirname, '..', 'path-ownership-guard.mjs');
const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function runHook(input, dbPath) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, BIZAR_TASK_DB: dbPath },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function decision(result) {
  return result.hookSpecificOutput?.permissionDecision;
}

test('edit hook enforces task scopes across isolated and main workspaces', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-path-guard-'));
  roots.push(root);
  const main = join(root, 'main');
  const isolated = join(root, 'isolated');
  mkdirSync(join(main, 'src'), { recursive: true });
  mkdirSync(join(isolated, 'src'), { recursive: true });
  mkdirSync(join(isolated, 'docs'), { recursive: true });

  const dbPath = join(root, 'tasks.sqlite');
  const ledger = new TaskLedger({ dbPath });
  ledger.createTask({ id: 'source', title: 'Source', scopes: ['src/**'] });
  ledger.claimTask({ taskId: 'source', owner: 'todd', workspace: isolated });
  ledger.close();

  const allowed = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    cwd: isolated,
    tool_input: { file_path: join(isolated, 'src', 'index.ts') },
  }, dbPath);
  assert.notEqual(decision(allowed), 'deny');

  const outOfScope = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    cwd: isolated,
    tool_input: { file_path: join(isolated, 'docs', 'design.md') },
  }, dbPath);
  assert.equal(decision(outOfScope), 'deny');
  assert.match(
    outOfScope.hookSpecificOutput.permissionDecisionReason,
    /OUT_OF_SCOPE/,
  );

  const siblingOwned = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    cwd: main,
    tool_input: { file_path: join(main, 'src', 'index.ts') },
  }, dbPath);
  assert.equal(decision(siblingOwned), 'deny');
  assert.match(
    siblingOwned.hookSpecificOutput.permissionDecisionReason,
    /SCOPE_OWNED/,
  );
});
