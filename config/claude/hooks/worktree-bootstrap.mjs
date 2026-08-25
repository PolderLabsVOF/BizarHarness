#!/usr/bin/env node
// SubagentStart — initialize an isolated editing worktree without sharing
// mutable build output or task state with sibling agents.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { input = {}; }

  const cwd = resolve(String(input.cwd || process.cwd()));
  const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR || cwd);
  const setup = join(projectDir, 'scripts', 'worktree-setup.sh');
  if (!existsSync(setup)) {
    process.stdout.write('{}\n');
    return;
  }

  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  });
  const list = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd,
    encoding: 'utf8',
  });
  if (top.status !== 0 || list.status !== 0) {
    process.stdout.write('{}\n');
    return;
  }

  const worktree = resolve(top.stdout.trim());
  const main = /^worktree (.+)$/m.exec(list.stdout)?.[1];
  if (!main || resolve(main) === worktree) {
    process.stdout.write('{}\n');
    return;
  }

  const result = spawnSync('bash', [setup, worktree], {
    cwd: projectDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const reason = (result.stderr || result.stdout || 'unknown error').trim();
    process.stdout.write(JSON.stringify({
      continue: false,
      stopReason: `Bizar worktree bootstrap failed: ${reason}`,
    }) + '\n');
    return;
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext:
        'Bizar: this editing agent is isolated in a worktree; claim a bizar task scope before modifying shared project paths.',
    },
  }) + '\n');
});
