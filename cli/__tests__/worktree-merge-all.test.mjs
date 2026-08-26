// Tests for `bizar worktree-merge --all` — the multi-branch merge sequencer.
//
// Each test sets up a throwaway git repo in a tempdir, creates three
// feature branches (wt/*), and exercises the dry-run plan, the real
// merge, and the conflict-stop path. We assert:
//   - the plan lists every wt/* branch in deterministic order
//   - each merge produces an archive tag at the source branch tip
//   - each merge produces a non-FF merge commit
//   - merged worktrees are removed and source branches are deleted
//   - a conflict on the second branch aborts the sequencer at step 2
//
// The script under test lives at cli/commands/worktree-merge.mjs (it now
// owns both the single-branch and the --all sequencer).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands', 'worktree-merge.mjs');

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wt-merge-all-'));
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

function makeFeatureBranch(dir, name, files) {
  // Create a wt/<name> branch with a unique commit and a matching worktree.
  // We always return the repo to master so consecutive branches share a
  // common ancestor (the initial commit) and divergent edits produce real
  // conflicts at merge time.
  const branch = `wt/${name}`;
  const wtPath = join(dir, '..', `${name}-wt`);
  git(dir, ['checkout', '-q', '-b', branch]);
  for (const [path, content] of files) {
    writeFileSync(join(dir, path), content);
    git(dir, ['add', path]);
  }
  git(dir, ['commit', '-q', `-m`, `add ${name}`]);
  git(dir, ['worktree', 'add', wtPath, branch]);
  git(dir, ['checkout', '-q', 'master']);
  return { branch, wtPath };
}

function runScript(dir, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
}

test('worktree-merge --all --dry-run prints the plan in deterministic order', () => {
  const dir = initRepo();
  try {
    makeFeatureBranch(dir, 'alpha', [['alpha.txt', 'a\n']]);
    makeFeatureBranch(dir, 'beta', [['beta.txt', 'b\n']]);
    makeFeatureBranch(dir, 'gamma', [['gamma.txt', 'g\n']]);

    git(dir, ['checkout', '-q', 'master']);

    const r = runScript(dir, ['--all', '--dry-run']);
    assert.equal(r.status, 0, `dry-run failed: ${r.stderr}`);
    assert.match(r.stdout, /Plan: merge 3 branch\(es\) in this order/);
    // Lexicographic ascending: wt/alpha, wt/beta, wt/gamma.
    const alphaIdx = r.stdout.indexOf('wt/alpha');
    const betaIdx = r.stdout.indexOf('wt/beta');
    const gammaIdx = r.stdout.indexOf('wt/gamma');
    assert.ok(alphaIdx > -1 && betaIdx > alphaIdx && gammaIdx > betaIdx,
      `expected wt/alpha < wt/beta < wt/gamma in plan, got:\n${r.stdout}`);
  } finally {
    cleanup(dir);
  }
});

test('worktree-merge --all merges every wt/* branch with archive tags and removes worktrees', () => {
  const dir = initRepo();
  try {
    const a = makeFeatureBranch(dir, 'alpha', [['alpha.txt', 'a\n']]);
    const b = makeFeatureBranch(dir, 'beta', [['beta.txt', 'b\n']]);
    const g = makeFeatureBranch(dir, 'gamma', [['gamma.txt', 'g\n']]);
    git(dir, ['checkout', '-q', 'master']);

    const r = runScript(dir, ['--all']);
    assert.equal(r.status, 0, `--all failed: ${r.stderr}\n${r.stdout}`);

    // Archive tag for each source branch should exist.
    for (const branch of [a.branch, b.branch, g.branch]) {
      const tags = git(dir, ['tag', '--list', `merge-archive/${branch.replace(/[^a-zA-Z0-9._-]/g, '-')}-*`]).stdout;
      assert.match(tags, new RegExp(`merge-archive/${branch.replace(/[^a-zA-Z0-9._-]/g, '-')}-[0-9a-f]{7}`),
        `missing archive tag for ${branch}; tags=${tags}`);
    }

    // Merge commits should appear in git log --graph.
    const log = git(dir, ['log', '--oneline', '--graph']).stdout;
    assert.match(log, /Merge|merge:/, `expected merge commit, got:\n${log}`);

    // Source branches should be deleted (default behavior).
    for (const branch of [a.branch, b.branch, g.branch]) {
      const listed = git(dir, ['branch', '--list', branch]).stdout;
      assert.equal(listed.trim(), '', `expected ${branch} deleted, got: ${listed}`);
    }

    // Worktrees should be removed (the directories may or may not exist
    // on disk, but `git worktree list` should not show them).
    const wt = git(dir, ['worktree', 'list', '--porcelain']).stdout;
    assert.doesNotMatch(wt, new RegExp(a.branch), 'wt/alpha should be pruned');
    assert.doesNotMatch(wt, new RegExp(b.branch), 'wt/beta should be pruned');
    assert.doesNotMatch(wt, new RegExp(g.branch), 'wt/gamma should be pruned');
  } finally {
    cleanup(dir);
  }
});

test('worktree-merge --all --keep-branch preserves the source branches', () => {
  const dir = initRepo();
  try {
    makeFeatureBranch(dir, 'alpha', [['alpha.txt', 'a\n']]);
    makeFeatureBranch(dir, 'beta', [['beta.txt', 'b\n']]);
    git(dir, ['checkout', '-q', 'master']);

    const r = runScript(dir, ['--all', '--keep-branch']);
    assert.equal(r.status, 0, `--all --keep-branch failed: ${r.stderr}`);

    for (const branch of ['wt/alpha', 'wt/beta']) {
      const listed = git(dir, ['branch', '--list', branch]).stdout.trim();
      assert.equal(listed, branch, `expected ${branch} preserved, got: ${listed}`);
    }
  } finally {
    cleanup(dir);
  }
});

test('worktree-merge --all --order honors the explicit merge order', () => {
  const dir = initRepo();
  try {
    makeFeatureBranch(dir, 'alpha', [['alpha.txt', 'a\n']]);
    makeFeatureBranch(dir, 'beta', [['beta.txt', 'b\n']]);
    makeFeatureBranch(dir, 'gamma', [['gamma.txt', 'g\n']]);
    git(dir, ['checkout', '-q', 'master']);

    const r = runScript(dir, ['--all', '--order', 'wt/gamma,wt/alpha,wt/beta', '--dry-run']);
    assert.equal(r.status, 0, `dry-run --order failed: ${r.stderr}`);

    const gammaIdx = r.stdout.indexOf('wt/gamma');
    const alphaIdx = r.stdout.indexOf('wt/alpha');
    const betaIdx = r.stdout.indexOf('wt/beta');
    assert.ok(gammaIdx > -1 && alphaIdx > gammaIdx && betaIdx > alphaIdx,
      `expected wt/gamma < wt/alpha < wt/beta in plan, got:\n${r.stdout}`);
  } finally {
    cleanup(dir);
  }
});

test('worktree-merge --all stops on conflict and exits non-zero', () => {
  const dir = initRepo();
  try {
    // alpha and beta both edit README.md to different values; merging
    // both into master in the default order will conflict on the second.
    const a = makeFeatureBranch(dir, 'alpha', [['README.md', '# alpha\n']]);
    const b = makeFeatureBranch(dir, 'beta', [['README.md', '# beta\n']]);
    git(dir, ['checkout', '-q', 'master']);

    const r = runScript(dir, ['--all']);
    assert.notEqual(r.status, 0, `expected non-zero exit on conflict; got 0`);
    assert.match(r.stderr, /conflict/i);

    // The first branch should still have its archive tag.
    const tags = git(dir, ['tag', '--list', `merge-archive/wt-alpha-*`]).stdout;
    assert.match(tags, /merge-archive\/wt-alpha-[0-9a-f]{7}/, 'first branch should still be archived');
  } finally {
    cleanup(dir);
  }
});

test('worktree-merge --all --json emits a JSON plan', () => {
  const dir = initRepo();
  try {
    makeFeatureBranch(dir, 'alpha', [['alpha.txt', 'a\n']]);
    git(dir, ['checkout', '-q', 'master']);

    const r = runScript(dir, ['--all', '--dry-run', '--json']);
    assert.equal(r.status, 0, `dry-run --json failed: ${r.stderr}`);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.status, 'plan');
    assert.equal(payload.branchCount, 1);
    assert.equal(payload.plan[0].branch, 'wt/alpha');
    assert.match(payload.plan[0].tag, /^merge-archive\/wt-alpha-[0-9a-f]{7}$/);
  } finally {
    cleanup(dir);
  }
});

test('worktree-merge --all rejects unknown --order entries', () => {
  const dir = initRepo();
  try {
    makeFeatureBranch(dir, 'alpha', [['alpha.txt', 'a\n']]);
    git(dir, ['checkout', '-q', 'master']);

    const r = runScript(dir, ['--all', '--order', 'wt/nonexistent']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown branches/);
  } finally {
    cleanup(dir);
  }
});

test('worktree-merge (single-branch) refuses when --all is omitted and a flag is passed', () => {
  const dir = initRepo();
  try {
    const r = runScript(dir, ['--keep-branch']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /only valid with --all/);
  } finally {
    cleanup(dir);
  }
});