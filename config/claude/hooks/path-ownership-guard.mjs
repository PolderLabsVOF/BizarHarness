#!/usr/bin/env node
// PreToolUse — deny edits outside the current task scope or inside a path
// leased by a sibling worktree.
//
// F-145 loosening: removed the per-edit `git worktree list --porcelain`
// fork and the `requireTask` gate. The hook is now a single in-memory
// ledger lookup. Edits inside the project are allowed by default; only
// an active lease held by another agent on the same path denies.

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
