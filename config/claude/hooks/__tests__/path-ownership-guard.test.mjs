import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { TaskLedger } from '../../../../cli/task-ledger.mjs';

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
  // Silent pass writes `{}` → permissionDecision is undefined.
  // Anything that sets a decision returns 'allow', 'deny', or 'ask'.
  return result.hookSpecificOutput?.permissionDecision;
}

function assertSilent(result, label) {
  const d = decision(result);
  assert.ok(d === undefined || d === null, `${label}: expected silent pass; got ${JSON.stringify(d)}`);
}

function context(result) {
  return result.hookSpecificOutput?.additionalContext ?? null;
}

function assertAdvisoryAllow(result, reasonFragment) {
  assert.equal(decision(result), 'allow', `expected allow, got ${decision(result)}`);
  const ctx = context(result);
  assert.ok(ctx, 'expected additionalContext to be set');
  assert.match(ctx, /Heads up/, 'advisory context should start with Heads up');
  if (reasonFragment) {
    assert.match(ctx, new RegExp(reasonFragment));
  }
}

// F-176 (full permissions + advisory hooks):
//   `path-ownership-guard.mjs` ALWAYS returns `permissionDecision:
//   "allow"`. When a sibling worker holds the file under SCOPE_OWNED the
//   agent sees an advisory reminder; otherwise the hook stays silent.

test('edit hook enforces sibling claims as advisory reminders, never blocks', () => {
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

  // Active task editing inside its own scope → silent allow.
  const allowed = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    cwd: isolated,
    tool_input: { file_path: join(isolated, 'src', 'index.ts') },
  }, dbPath);
  assertSilent(allowed, 'in-scope edit');

  // F-200 loosening: active task editing OUTSIDE its own scope (still
  // inside its workspace) → silent allow. Scopes are sibling claims, not
  // self-restrictions.
  const outOfScope = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    cwd: isolated,
    tool_input: { file_path: join(isolated, 'docs', 'design.md') },
  }, dbPath);
  assertSilent(outOfScope, 'out-of-scope edit');

  // Different workspace, file in active task's scope → ALLOW with
  // advisory reminder that a sibling worker holds the scope (F-176
  // used to be a hard deny).
  const siblingOwned = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    cwd: main,
    tool_input: { file_path: join(main, 'src', 'index.ts') },
  }, dbPath);
  assertAdvisoryAllow(siblingOwned, 'SCOPE_OWNED');
  assert.match(
    siblingOwned.hookSpecificOutput.permissionDecisionReason,
    /SCOPE_OWNED/,
  );
});

test('edit hook allows /tmp and other scratch paths with no git repo', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-path-guard-'));
  roots.push(root);
  const scratch = join(root, 'scratch');
  mkdirSync(scratch, { recursive: true });

  // No ledger exists for this fake repo — the hook should short-circuit.
  const result = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    cwd: scratch,
    tool_input: { file_path: join(scratch, 'note.txt') },
  }, join(root, 'missing-tasks.sqlite'));
  assertSilent(result, 'no-ledger scratch path');
});

test('edit hook allows /tmp/foo from a project cwd outside the repo', () => {
  const result = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    cwd: '/home/drb0rk/projects/BizarHarness',
    tool_input: { file_path: '/tmp/foo.txt' },
  }, '/nonexistent/tasks.sqlite');
  assertSilent(result, 'scratch path under project cwd');
});