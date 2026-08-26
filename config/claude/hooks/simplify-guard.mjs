#!/usr/bin/env node
/**
 * Require a recent `/simplify` review before each commit attempt.
 *
 * The marker is stored in the worktree's Git directory and records the
 * simplify timestamp plus the staged-tree fingerprint. The PreToolUse hook
 * allows the commit only while that exact staged tree remains fresh. We do
 * NOT consume the marker — the hook chain may run more than once for a single
 * bash invocation, and a one-shot rm caused sporadic false denies.
 *
 * Missing or stale markers deny the commit. Hard approval gates (commit,
 * push, gh, publish, deploy) remain in git-workflow-guard.mjs.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findGitCommand } from './git-command-parser.mjs';

const FRESHNESS_WINDOW_MS = 4 * 60 * 60 * 1000;
const TRIVIAL_PATH = /^(?:CHANGELOG\.md|package(-lock)?\.json|.*\/package(-lock)?\.json|packages\/[^/]+\/src\/version\.ts)$/;

function marker(cwd) {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-dir'], {
    cwd,
    encoding: 'utf8',
    timeout: 5_000,
  });
  const gitDir = result.status === 0 ? result.stdout.trim() : '';
  return gitDir ? join(gitDir, 'bizar-simplify.ok') : null;
}

function stagedFingerprint(cwd) {
  const result = spawnSync('git', ['write-tree'], {
    cwd,
    encoding: 'utf8',
    timeout: 5_000,
  });
  const fingerprint = result.status === 0 ? result.stdout.trim() : '';
  return fingerprint || null;
}

function readMarker(path) {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isFinite(value.timestamp) || typeof value.fingerprint !== 'string' || !value.fingerprint) return null;
    return value;
  } catch {
    return null;
  }
}

function isTrivialDiff(cwd) {
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd,
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.status !== 0) return false;
  const paths = result.stdout.split('\n').map((p) => p.trim()).filter(Boolean);
  if (paths.length === 0) return false;
  return paths.every((p) => TRIVIAL_PATH.test(p));
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
    const fingerprint = stagedFingerprint(cwd);
    if (fingerprint) writeFileSync(mark, `${JSON.stringify({ timestamp: Date.now(), fingerprint })}\n`);
    return;
  }
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') return;

  const commandValue = input.tool_input?.command;
  const command = Array.isArray(commandValue) ? commandValue.join(' ') : String(commandValue || '');
  if (!findGitCommand(command, 'commit')) return;

  if (isTrivialDiff(cwd)) return;

  const approval = readMarker(mark);
  const age = approval ? Date.now() - approval.timestamp : Infinity;
  const fingerprint = stagedFingerprint(cwd);
  if (age >= 0 && age <= FRESHNESS_WINDOW_MS && fingerprint && approval?.fingerprint === fingerprint) return;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Run /simplify on the staged diff, apply any justified cleanup, rerun tests, then retry the commit.',
    },
  }) + '\n');
});
