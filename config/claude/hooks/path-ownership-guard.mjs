#!/usr/bin/env node
// PreToolUse — Bizar path-ownership guard.
//
// F-176 (full permissions + advisory hooks):
//   Hooks never return `deny` or `ask`. They inject guidance via
//   `additionalContext` and always return `"allow"`. The hook still
//   consults OpenKan `.ok/` scopes so an agent who IS
//   tripping over a sibling's live claim gets a clear reminder, but the
//   trip is a hint, not a block.
//
// F-200 loosening (still in force under F-176):
//   - Files outside the repo root (e.g. /tmp/foo, scratch dirs, any path
//     outside `repoRoot`) are ALWAYS allowed.
//   - Files inside the repo are allowed unless a sibling active task
//     holds a live lease on the same path (SCOPE_OWNED).
//   - The active task in the caller's workspace does NOT restrict
//     itself — its scope is a claim against OTHER concurrent workers.
//   - Completed, integrated, blocked, and pending tasks no longer
//     reserve scopes. Only active-with-lease tasks block siblings.

import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { ownerOfOpenKanPath } from '../../../cli/openkan-store.mjs';

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

  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    timeout: 3_000,
  });
  const repoRoot = top.status === 0 && top.stdout.trim()
    ? resolve(top.stdout.trim())
    : cwd;

  try {
    const ownership = ownerOfOpenKanPath({
      root: repoRoot,
      cwd,
      filePath,
      taskId: String(input.task_id || input.task?.id || process.env.BIZAR_TASK_ID || ''),
    });
    if (ownership) {
      const target = ownership.path || filePath;
      const taskTag = ownership.taskId ? ` (OpenKan task ${ownership.taskId})` : '';
      const out = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason:
            `OpenKan path ownership advisory for ${target}${taskTag}.`,
          additionalContext:
          `[advisory] Heads up: ${target}${taskTag} is held by a sibling OpenKan task ` +
            `(scope ${ownership.scope}). Under F-176 the edit is allowed, but you may be ` +
            `stepping on a concurrent worker — coordinate via @mike before continuing, ` +
            `or pick a disjoint file scope.`,
        },
      };
      process.stdout.write(JSON.stringify(out) + '\n');
      return;
    }
    process.stdout.write('{}\n');
  } catch (error) {
    // F-176: OpenKan workspace errors never block edits; we surface the error
    // as an advisory so the agent can decide whether to continue.
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason:
          `OpenKan path ownership advisory: WORKSPACE_UNAVAILABLE (${error.message || String(error)}).`,
        additionalContext:
          `[advisory] Heads up: OpenKan .ok workspace was unreachable ` +
          `(${error.message || String(error)}). Edits to in-repo paths proceed ` +
          `without sibling-scope checks. Re-run the audit once the ledger is healthy.`,
      },
    };
    process.stdout.write(JSON.stringify(out) + '\n');
  }
});
