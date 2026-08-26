#!/usr/bin/env node
/**
 * .claude/hooks/__tests__/worktree-archive.test.mjs
 *
 * Unit tests for worktree-archive.mjs — the SubagentStop hook that records
 * an editing agent's worktree branch into ~/.config/bizar/worktree-queue.json
 * so the orchestrator can merge it back into the integration branch.
 *
 * Strategy:
 *   - Create a tempdir git repo with a wt/ branch + matching worktree.
 *   - Spawn the hook with a synthesized SubagentStop input pointing at it.
 *   - Read the queue file at a temp BIZAR_HOME and assert the entry.
 *   - Verify idempotency: a second run for the same agent does NOT append.
 *   - Verify the hook is fail-open on a missing worktree branch.
 */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '..', 'worktree-archive.mjs');

const roots = [];

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'bizar-wt-archive-'));
  roots.push(dir);
  git(dir, ['init', '-q', '-b', 'master']);
  git(dir, ['config', 'user.email', 't@bizar.local']);
  git(dir, ['config', 'user.name', 'Bizar Tests']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'README.md'), '# seed\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'initial']);
  return dir;
}

function addWorktree(repo, branchName) {
  const wt = join(repo, '..', `${branchName}-wt`);
  git(repo, ['checkout', '-q', '-b', branchName]);
  writeFileSync(join(repo, 'feature.txt'), `${branchName}\n`);
  git(repo, ['add', 'feature.txt']);
  git(repo, ['commit', '-q', '-m', `add ${branchName}`]);
  // Switch back to master so the new branch is free for `git worktree add`.
  git(repo, ['checkout', '-q', 'master']);
  git(repo, ['worktree', 'add', wt, branchName]);
  // Track both the repo and the worktree directory so afterEach removes them.
  roots.push(wt);
  return wt;
}

function runHook(input, env = {}) {
  return spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function makeBizarHome() {
  const home = mkdtempSync(join(tmpdir(), 'bizar-home-'));
  roots.push(home);
  return home;
}

test('SubagentStop: appends the agent wt/* branch to the queue', () => {
  const repo = makeRepo();
  const wt = addWorktree(repo, 'wt/todd-fix-hook');
  const home = makeBizarHome();

  const result = runHook(
    {
      hook_event_name: 'SubagentStop',
      agent_type: 'senior-engineer',
      agent_id: 'agent-1',
      cwd: wt,
    },
    { BIZAR_HOME: home },
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'queued');
  assert.equal(payload.branch, 'wt/todd-fix-hook');

  const queue = JSON.parse(readFileSync(join(home, 'worktree-queue.json'), 'utf8'));
  assert.equal(queue.entries.length, 1);
  assert.equal(queue.entries[0].branch, 'wt/todd-fix-hook');
  assert.equal(queue.entries[0].agentType, 'senior-engineer');
  assert.equal(queue.entries[0].agentId, 'agent-1');
});

test('SubagentStop: idempotent — second run for the same agent does not duplicate', () => {
  const repo = makeRepo();
  const wt = addWorktree(repo, 'wt/karen-merge-fix');
  const home = makeBizarHome();

  for (let i = 0; i < 2; i += 1) {
    const result = runHook(
      {
        hook_event_name: 'SubagentStop',
        agent_type: 'principal-engineer',
        agent_id: 'agent-2',
        cwd: wt,
      },
      { BIZAR_HOME: home },
    );
    assert.equal(result.status, 0);
  }

  const queue = JSON.parse(readFileSync(join(home, 'worktree-queue.json'), 'utf8'));
  assert.equal(queue.entries.length, 1);
});

test('SubagentStop: when there is no wt/* branch the hook stays silent and does not write a queue file', () => {
  const repo = makeRepo();
  const home = makeBizarHome();

  // No worktree added; list returns only the main checkout.
  const result = runHook(
    {
      hook_event_name: 'SubagentStop',
      agent_type: 'principal-engineer',
      agent_id: 'agent-3',
      cwd: repo,
    },
    { BIZAR_HOME: home },
  );
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'noop');
  assert.ok(
    !existsSync(join(home, 'worktree-queue.json')),
    'no queue file should be created when no wt/* branch exists',
  );
});

test('SubagentStop: restores a corrupt queue file on the next successful write', () => {
  const repo = makeRepo();
  const wt = addWorktree(repo, 'wt/brenda-cleanup');
  const home = makeBizarHome();
  // Pre-create a corrupt queue to prove the hook survives it.
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'worktree-queue.json'), '{not-json\n');

  const result = runHook(
    {
      hook_event_name: 'SubagentStop',
      agent_type: 'office-coordinator',
      agent_id: 'agent-4',
      cwd: wt,
    },
    { BIZAR_HOME: home },
  );
  assert.equal(result.status, 0, result.stderr);

  const queue = JSON.parse(readFileSync(join(home, 'worktree-queue.json'), 'utf8'));
  assert.equal(queue.entries.length, 1);
  assert.equal(queue.entries[0].branch, 'wt/brenda-cleanup');
});

test('SubagentStop: extracts the branch from the agent transcript when cwd is not the worktree', () => {
  const repo = makeRepo();
  addWorktree(repo, 'wt/todd-transcript');
  const home = makeBizarHome();
  // Transcript contains the branch name (mimics SubagentStart output).
  const transcript = join(repo, 'transcript.jsonl');
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'x1', content: 'Bizar: this editing agent is isolated in a worktree; claim a bizar task scope before modifying shared project paths.\n\nAgent is working on branch wt/todd-transcript. On completion, run `bizar worktree-merge wt/todd-transcript`.' },
      ] } }),
    ].join('\n'),
  );

  const result = runHook(
    {
      hook_event_name: 'SubagentStop',
      agent_type: 'senior-engineer',
      agent_id: 'agent-5',
      cwd: repo,
      agent_transcript_path: transcript,
    },
    { BIZAR_HOME: home },
  );
  assert.equal(result.status, 0, result.stderr);
  const queue = JSON.parse(readFileSync(join(home, 'worktree-queue.json'), 'utf8'));
  assert.equal(queue.entries.length, 1);
  assert.equal(queue.entries[0].branch, 'wt/todd-transcript');
});

test.afterEach(() => {
  while (roots.length) {
    try { rmSync(roots.pop(), { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});