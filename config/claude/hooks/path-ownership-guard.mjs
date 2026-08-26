#!/usr/bin/env node
// PreToolUse — Bizar path-ownership guard.
//
// Behaviour (F-200 loosening):
//   - Files outside the repo root (e.g. /tmp/foo, scratch dirs, any path
//     outside `repoRoot`) are ALWAYS allowed.
//   - Files inside the repo are allowed unless a sibling active task
//     holds a live lease on the same path (SCOPE_OWNED).
//   - The active task in the caller's workspace does NOT restrict
//     itself — its scope is a claim against OTHER concurrent workers,
//     not a restriction on the claimant. Agents can edit any file in
//     their workspace that isn't a git-tracked secret.
//   - Completed, integrated, blocked, and pending tasks no longer
//     reserve scopes. Only active-with-lease tasks block siblings.
//
// This is implemented in `cli/task-ledger.mjs` `authorizeEdit`. This
// hook is a thin wrapper that runs the ledger lookup and maps the
// `allowed: false` result into a Claude Code `deny` decision.
//
// F-145 history: removed the per-edit `git worktree list --porcelain`
// fork and the `requireTask` gate. The hook is a single in-memory
// ledger lookup now.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { TaskLedger, resolveTaskDatabase } from '../../../cli/task-ledger.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { input = {}; }

  const toolName = String(input.tool_name || '');
  if (!/^(Write|Edit|MultiEdit)$/.test(toolName)) {
    process.stdout.write('{}\n');
    return;
  }
  const filePath = String(input.tool_input?.file_path || '');
  const cwd = resolve(String(input.cwd || process.cwd()));
  if (!filePath) {
    process.stdout.write('{}\n');
    return;
  }

  const dbPath = resolveTaskDatabase(cwd);
  if (!existsSync(dbPath)) {
    process.stdout.write('{}\n');
    return;
  }

  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    timeout: 3_000,
  });
  const repoRoot = top.status === 0 && top.stdout.trim()
    ? resolve(top.stdout.trim())
    : cwd;

  let ledger;
  try {
    ledger = new TaskLedger({ dbPath });
    const authorization = ledger.authorizeEdit({
      cwd,
      filePath,
      repoRoot,
      requireTask: false,
    });
    if (!authorization.allowed) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `Bizar path ownership: ${authorization.reason} for ` +
            `${authorization.path || filePath}` +
            `${authorization.taskId ? ` (task ${authorization.taskId})` : ''}.`,
        },
      }) + '\n');
      return;
    }
    process.stdout.write('{}\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Bizar path ownership: LEDGER_UNAVAILABLE (${error.message || String(error)}).`,
      },
    }) + '\n');
  } finally {
    try { ledger?.close(); } catch { /* process is exiting */ }
  }
});
