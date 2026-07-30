#!/usr/bin/env node
/**
 * Require one successful simplify skill run for every commit attempt.
 * The marker is stored in the worktree's Git directory and consumed once.
 */

import { closeSync, existsSync, openSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function marker(cwd) {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-dir'], {
    cwd,
    encoding: 'utf8',
    timeout: 5_000,
  });
  const gitDir = result.status === 0 ? result.stdout.trim() : '';
  return gitDir ? join(gitDir, 'bizar-simplify.ok') : null;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { input = {}; }
  const cwd = String(input.cwd || process.cwd());
  const mark = marker(cwd);
  if (!mark) return;

  if (input.hook_event_name === 'PostToolUse' && input.tool_name === 'Skill' && input.tool_input?.skill === 'simplify') {
    closeSync(openSync(mark, 'w'));
    return;
  }
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') return;

  const commandValue = input.tool_input?.command;
  const command = Array.isArray(commandValue) ? commandValue.join(' ') : String(commandValue || '');
  if (!/\bgit\s+(?:-\S+\s+)*commit\b/i.test(command)) return;
  if (existsSync(mark)) {
    rmSync(mark, { force: true });
    return;
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Run /simplify on the staged diff, apply any justified cleanup, rerun tests, then retry the commit.',
    },
  }) + '\n');
});
