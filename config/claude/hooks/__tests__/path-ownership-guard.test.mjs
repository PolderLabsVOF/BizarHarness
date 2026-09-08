import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const HOOK = join(import.meta.dirname, '..', 'path-ownership-guard.mjs');
const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function runHook(input) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env },
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
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  const taskDir = join(root, '.ok', 'tasks', 'tsk-source');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(taskDir, 'task.json'), JSON.stringify({
    schema: 'ok.task.v2', id: 'tsk-source', owner: 'todd', status: 'in_progress', scopes: ['src/**'],
  }));

  // Active task editing inside its own scope → silent allow.
  const allowed = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    cwd: root,
    task_id: 'tsk-source',
    tool_input: { file_path: join(root, 'src', 'index.ts') },
  });
  assertSilent(allowed, 'in-scope edit');

  // F-200 loosening: active task editing OUTSIDE its own scope (still
  // inside its workspace) → silent allow. Scopes are sibling claims, not
  // self-restrictions.
  const outOfScope = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    cwd: root,
    task_id: 'tsk-source',
    tool_input: { file_path: join(root, 'docs', 'design.md') },
  });
  assertSilent(outOfScope, 'out-of-scope edit');

  // Different workspace, file in active task's scope → ALLOW with
  // advisory reminder that a sibling worker holds the scope (F-176
  // used to be a hard deny).
  const siblingOwned = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    cwd: root,
    tool_input: { file_path: join(root, 'src', 'index.ts') },
  });
  assertAdvisoryAllow(siblingOwned, 'scope src');
  assert.match(
    siblingOwned.hookSpecificOutput.permissionDecisionReason,
    /OpenKan path ownership advisory/,
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
  });
  assertSilent(result, 'no-ledger scratch path');
});

test('edit hook allows /tmp/foo from a project cwd outside the repo', () => {
  const result = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    cwd: '/home/drb0rk/projects/BizarHarness',
    tool_input: { file_path: '/tmp/foo.txt' },
  });
  assertSilent(result, 'scratch path under project cwd');
});
