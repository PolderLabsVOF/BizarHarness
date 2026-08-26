#!/usr/bin/env node
/**
 * SubagentStop — record the editing agent's worktree branch into the Bizar
 * merge queue (`~/.config/bizar/worktree-queue.json`) so the orchestrator
 * can map "agent finished" → "branch ready to merge".
 *
 * Inputs (from Claude Code):
 *   - agent_type, agent_id
 *   - agent_transcript_path (optional)
 *   - last_assistant_message (optional)
 *   - cwd (optional, used to locate the worktree root via `git`)
 *
 * The hook is fail-open: a missing queue, a corrupt queue, or a git
 * failure must NEVER block the agent's deliverable from being returned
 * to the orchestrator. We only ever append to the queue file.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const WORKTREE_PREFIX = 'wt/';

function resolveBranchFromAdditionalContext(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  let raw = '';
  try { raw = readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  // Match a wt/<agent>-<task> branch name without punctuation so we
  // don't grab the trailing period from `wt/foo. On completion, ...`.
  const match = /\bwt\/[a-z0-9][a-z0-9._-]*[a-z0-9]\b/i.exec(raw);
  return match ? match[0] : null;
}

function resolveBranchFromWorktree(cwd) {
  // If the SubagentStart hook captured a branch, we already have it.
  // Otherwise, list worktrees and find the one whose checkout differs
  // from the main checkout — that is the agent's worktree.
  const dir = resolve(cwd || process.cwd());
  const list = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (list.status !== 0) return null;
  const blocks = list.stdout.split(/\n(?=worktree )/);
  for (const block of blocks) {
    const branchMatch = /^branch refs\/heads\/(.+)$/m.exec(block);
    if (!branchMatch) continue;
    if (branchMatch[1].startsWith(WORKTREE_PREFIX)) return branchMatch[1];
  }
  return null;
}

function queuePath(bizarHome) {
  const home = bizarHome || process.env.BIZAR_HOME || join(homedir(), '.config', 'bizar');
  return join(home, 'worktree-queue.json');
}

function readQueue(path) {
  if (!existsSync(path)) return { version: 1, entries: [] };
  try {
    const raw = readFileSync(path, 'utf8');
    if (!raw.trim()) return { version: 1, entries: [] };
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.entries)) return { version: 1, entries: parsed.entries };
    return { version: 1, entries: [] };
  } catch {
    // Corrupt queue must never block; drop and start fresh on next write.
    return { version: 1, entries: [] };
  }
}

function writeQueue(path, queue) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(queue, null, 2)}\n`, { mode: 0o600 });
}

export function archiveWorktreeEntry(input, options = {}) {
  const agentType = String(input?.agent_type || '');
  const agentId = String(input?.agent_id || '');
  const transcript = input?.agent_transcript_path || input?.transcript_path;
  const cwd = input?.cwd || process.cwd();

  // Only track agents that actually used a worktree branch.
  const branch = resolveBranchFromAdditionalContext(transcript)
    || resolveBranchFromWorktree(cwd);

  if (!branch) return { status: 'noop', reason: 'no wt/* branch detected' };

  const queueFile = queuePath(options.bizarHome);
  const queue = readQueue(queueFile);
  // Idempotent: if the same agent already recorded this branch, skip.
  const duplicate = queue.entries.find(
    (e) => e.branch === branch && (e.agentId === agentId || e.agentType === agentType),
  );
  if (duplicate) return { status: 'noop', reason: 'already queued', branch };

  queue.entries.push({
    branch,
    agentType,
    agentId,
    queuedAt: new Date().toISOString(),
    cwd: resolve(cwd),
  });

  try {
    writeQueue(queueFile, queue);
  } catch {
    // Fail open.
    return { status: 'noop', reason: 'queue write failed (fail-open)' };
  }

  return { status: 'queued', branch };
}

export function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8') || '{}'; } catch { raw = '{}'; }
  let input;
  try { input = JSON.parse(raw); } catch { input = {}; }
  process.stdout.write(`${JSON.stringify(archiveWorktreeEntry(input))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();