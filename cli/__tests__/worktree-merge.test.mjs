// Tests for bizar worktree-merge: archive-tag creation + --no-ff merge.
// Each test sets up a throwaway git repo in a tempdir, runs the subcommand,
// and inspects the resulting tag and merge topology.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands', 'worktree-merge.mjs');

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wt-merge-'));
  git(dir, ['init', '-q', '-b', 'master']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'README.md'), '# seed\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'initial']);
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

test('worktree-merge: tags source branch tip as merge-archive/<branch>-<sha>', () => {
  const dir = initRepo();
  try {
    git(dir, ['checkout', '-q', '-b', 'feat-x']);
    writeFileSync(join(dir, 'feature.txt'), 'hello\n');
    git(dir, ['add', 'feature.txt']);
    git(dir, ['commit', '-q', '-m', 'add feature']);

    const r = spawnSync(process.execPath, [SCRIPT, 'feat-x'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `subcommand failed: ${r.stderr}`);

    const tags = git(dir, ['tag', '--list', 'merge-archive/feat-x-*']);
    assert.match(tags.stdout, /^merge-archive\/feat-x-[0-9a-f]{7}$/m);
  } finally {
    cleanup(dir);
  }
});

test('worktree-merge: produces a merge commit (--no-ff preserves topology)', () => {
  const dir = initRepo();
  try {
    git(dir, ['checkout', '-q', '-b', 'feat-y']);
    writeFileSync(join(dir, 'feature-y.txt'), 'y\n');
    git(dir, ['add', 'feature-y.txt']);
    git(dir, ['commit', '-q', '-m', 'add y']);

    // Force a non-FF-eligible state: change on master after feature branch
    // was forked. Without this, --no-ff is a no-op fast-forward.
    git(dir, ['checkout', '-q', 'master']);
    writeFileSync(join(dir, 'master-only.txt'), 'm\n');
    git(dir, ['add', 'master-only.txt']);
    git(dir, ['commit', '-q', '-m', 'master change']);

    const r = spawnSync(process.execPath, [SCRIPT, 'feat-y'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `subcommand failed: ${r.stderr}`);

    const log = git(dir, ['log', '--oneline', '--graph']);
    assert.match(log.stdout, /Merge|merge:/, `expected merge commit, got:\n${log.stdout}`);
  } finally {
    cleanup(dir);
  }
});

test('worktree-merge: refuses when branch does not exist', () => {
  const dir = initRepo();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, 'does-not-exist'], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
  } finally {
    cleanup(dir);
  }
});

test('worktree-merge: refuses when no branch argument given', () => {
  const dir = initRepo();
  try {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage: bizar worktree-merge/);
  } finally {
    cleanup(dir);
  }
});
