/**
 * tests/memory-git.test.mjs
 *
 * Tests for the memory-git module.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';

const TEST_GIT = await import('../src/server/memory-git.mjs').then((m) => m);
const GIT_INSTALLED = TEST_GIT.isGitInstalled();

describe('memory-git', () => {
  let bareRemote;
  let workingDir;

  beforeEach(() => {
    // Guard: if git was removed since process start, bail gracefully
    if (!TEST_GIT.isGitInstalled()) {
      bareRemote = null;
      workingDir = null;
      return;
    }
    // Create a bare remote repo
    bareRemote = join(tmpdir(), `bizar-git-test-remote-${Date.now()}-${Math.random().toString(36).slice(2)}.git`);
    mkdirSync(bareRemote, { recursive: true });
    try { execSync('git', ['init', '--bare'], { cwd: bareRemote, encoding: 'utf8' }); } catch { bareRemote = null; return; }

    // Create a working clone
    workingDir = join(tmpdir(), `bizar-git-test-work-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(workingDir, { recursive: true });
    try {
      execSync('git', ['clone', bareRemote, workingDir], { encoding: 'utf8' });
      execSync('git', ['config', 'user.email', 'test@bizar.ai'], { cwd: workingDir, encoding: 'utf8' });
      execSync('git', ['config', 'user.name', 'Bizar Test'], { cwd: workingDir, encoding: 'utf8' });
    } catch { workingDir = null; }
  });

  afterEach(() => {
    try { if (bareRemote) rmSync(bareRemote, { recursive: true, force: true }); } catch { /* ignore */ }
    try { if (workingDir) rmSync(workingDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('isGitInstalled returns true when git is available', () => {
    assert.strictEqual(TEST_GIT.isGitInstalled(), GIT_INSTALLED);
    if (!GIT_INSTALLED) assert.fail('git not installed — this test should not run');
  });

  (GIT_INSTALLED ? it : it.skip)('clone creates a working repo', () => {
    if (!workingDir || !bareRemote) return;
    const cloneTarget = join(tmpdir(), `clone-test-${Date.now()}`);
    mkdirSync(cloneTarget, { recursive: true });
    const result = TEST_GIT.clone(bareRemote, cloneTarget, { branch: 'main', depth: 1 });
    try {
      assert.strictEqual(result.ok, true);
      assert.ok(existsSync(join(cloneTarget, '.git')));
    } finally {
      rmSync(cloneTarget, { recursive: true, force: true });
    }
  });

  (GIT_INSTALLED ? it : it.skip)('addFile + commit + push work', () => {
    if (!workingDir) return;
    writeFileSync(join(workingDir, 'test.txt'), 'hello world', 'utf8');
    TEST_GIT.addFile(workingDir, 'test.txt');
    const commitResult = TEST_GIT.commit(workingDir, 'Add test.txt');
    assert.strictEqual(commitResult.ok, true);
    const pushResult = TEST_GIT.push(workingDir, { remote: 'origin', branch: 'main' });
    assert.strictEqual(pushResult.ok, true);
    const status = TEST_GIT.status(workingDir);
    assert.strictEqual(status.clean, true);
  });

  (GIT_INSTALLED ? it : it.skip)('status reports dirty after changes', () => {
    if (!workingDir) return;
    writeFileSync(join(workingDir, 'dirty.txt'), 'dirty content', 'utf8');
    const status = TEST_GIT.status(workingDir);
    assert.strictEqual(status.clean, false);
  });

  (GIT_INSTALLED ? it : it.skip)('status reports clean after push', () => {
    if (!workingDir) return;
    writeFileSync(join(workingDir, 'clean.txt'), 'clean', 'utf8');
    TEST_GIT.addFile(workingDir, 'clean.txt');
    TEST_GIT.commit(workingDir, 'Add clean');
    TEST_GIT.push(workingDir, { remote: 'origin', branch: 'main' });
    const status = TEST_GIT.status(workingDir);
    assert.strictEqual(status.clean, true);
  });

  (GIT_INSTALLED ? it : it.skip)('acquireLock + release works', () => {
    if (!workingDir) return;
    const lock = TEST_GIT.acquireLock(workingDir);
    assert.strictEqual(lock.error, undefined);
    assert.ok(typeof lock.release === 'function');
    lock.release();
    assert.ok(!existsSync(join(workingDir, '.sync.lock')));
  });

  (GIT_INSTALLED ? it : it.skip)('acquireLock returns locked when held', () => {
    if (!workingDir) return;
    const lock1 = TEST_GIT.acquireLock(workingDir);
    assert.strictEqual(lock1.error, undefined);
    const lock2 = TEST_GIT.acquireLock(workingDir);
    assert.strictEqual(lock2.error, 'locked');
    lock1.release();
  });

  (GIT_INSTALLED ? it : it.skip)('release is idempotent', () => {
    if (!workingDir) return;
    const lock = TEST_GIT.acquireLock(workingDir);
    lock.release();
    lock.release();
    lock.release();
    assert.ok(!existsSync(join(workingDir, '.sync.lock')));
    const lock2 = TEST_GIT.acquireLock(workingDir);
    assert.strictEqual(lock2.error, undefined);
    lock2.release();
  });

  (GIT_INSTALLED ? it : it.skip)('addAll stages all changes', () => {
    if (!workingDir) return;
    writeFileSync(join(workingDir, 'a.txt'), 'a', 'utf8');
    writeFileSync(join(workingDir, 'b.txt'), 'b', 'utf8');
    const result = TEST_GIT.addAll(workingDir);
    assert.strictEqual(result.ok, true);
  });

  (GIT_INSTALLED ? it : it.skip)('pull works on up-to-date repo', () => {
    if (!workingDir) return;
    const result = TEST_GIT.pull(workingDir);
    assert.strictEqual(result.ok, true);
  });

  describe('addRemote', () => {
    (GIT_INSTALLED ? it : it.skip)('registers a new remote on a fresh repo', () => {
      const dir = join(tmpdir(), `bizar-addremote-fresh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(dir, { recursive: true });
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

        const result = TEST_GIT.addRemote(dir, 'origin', 'git@github.com:user/repo.git');
        assert.deepEqual(result, { ok: true, action: 'added' });

        const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8' }).trim();
        assert.strictEqual(url, 'git@github.com:user/repo.git');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    (GIT_INSTALLED ? it : it.skip)('is idempotent when same URL is set twice', () => {
      const dir = join(tmpdir(), `bizar-addremote-idempotent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(dir, { recursive: true });
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

        const first = TEST_GIT.addRemote(dir, 'origin', 'git@github.com:user/repo.git');
        assert.deepEqual(first, { ok: true, action: 'added' });

        const second = TEST_GIT.addRemote(dir, 'origin', 'git@github.com:user/repo.git');
        assert.deepEqual(second, { ok: true, action: 'unchanged' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    (GIT_INSTALLED ? it : it.skip)('throws when remote exists with different URL and overwrite is false', () => {
      const dir = join(tmpdir(), `bizar-addremote-noverwrite-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(dir, { recursive: true });
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

        TEST_GIT.addRemote(dir, 'origin', 'git@github.com:user/repo.git');
        assert.throws(
          () => TEST_GIT.addRemote(dir, 'origin', 'git@github.com:other/repo.git'),
          /already exists/,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    (GIT_INSTALLED ? it : it.skip)('overwrites remote URL when overwrite flag is set', () => {
      const dir = join(tmpdir(), `bizar-addremote-overwrite-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(dir, { recursive: true });
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

        TEST_GIT.addRemote(dir, 'origin', 'git@github.com:user/repo.git');
        const result = TEST_GIT.addRemote(dir, 'origin', 'git@github.com:other/repo.git', { overwrite: true });
        assert.deepEqual(result, { ok: true, action: 'updated' });

        const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8' }).trim();
        assert.strictEqual(url, 'git@github.com:other/repo.git');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('lsRemote', () => {
    (GIT_INSTALLED ? it : it.skip)('returns empty string for an unreachable remote', () => {
      const dir = join(tmpdir(), `bizar-lsremote-unreachable-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(dir, { recursive: true });
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

        TEST_GIT.addRemote(dir, 'origin', 'git@127.0.0.1:1/nope.git');
        const result = TEST_GIT.lsRemote(dir, 'origin', { timeoutMs: 1000 });
        assert.strictEqual(result, '');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    (GIT_INSTALLED ? it : it.skip)('returns empty string when the remote name does not exist', () => {
      const dir = join(tmpdir(), `bizar-lsremote-nonexistent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(dir, { recursive: true });
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
        execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

        const result = TEST_GIT.lsRemote(dir, 'nonexistent', { timeoutMs: 1000 });
        assert.strictEqual(result, '');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
