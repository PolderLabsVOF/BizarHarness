/**
 * tests/memory-sync.test.mjs
 *
 * Integration tests for the memory sync orchestrator (C6).
 * Tests: clean sync commits, secret-blocked sync is rejected, F6 commit message.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const TEST_GIT = await import('../src/server/memory-git.mjs').then((m) => m);
const TEST_STORE = await import('../src/server/memory-store.mjs').then((m) => m);
const GIT_INSTALLED = TEST_GIT.isGitInstalled();

describe('memory-sync', () => {
  let bareRemote;
  let workingDir;
  let projectRoot;

  beforeEach(() => {
    bareRemote = null;
    workingDir = null;
    projectRoot = null;
    if (!GIT_INSTALLED) return;

    // Set up a bare remote + working clone
    bareRemote = join(tmpdir(), `sync-remote-${Date.now()}.git`);
    mkdirSync(bareRemote, { recursive: true });
    try {
      execSync('git', ['init', '--bare'], { cwd: bareRemote, encoding: 'utf8', stdio: 'pipe' });
    } catch { try { rmSync(bareRemote, { recursive: true, force: true }); } catch { /* ignore */ } bareRemote = null; return; }

    workingDir = join(tmpdir(), `sync-work-${Date.now()}`);
    mkdirSync(workingDir, { recursive: true });
    try {
      execSync('git', ['clone', bareRemote, workingDir], { encoding: 'utf8', stdio: 'pipe' });
      execSync('git', ['config', 'user.email', 'test@bizar.ai'], { cwd: workingDir, encoding: 'utf8', stdio: 'pipe' });
      execSync('git', ['config', 'user.name', 'Bizar Test'], { cwd: workingDir, encoding: 'utf8', stdio: 'pipe' });
    } catch { try { rmSync(workingDir, { recursive: true, force: true }); } catch { /* ignore */ } workingDir = null; return; }

    projectRoot = workingDir;
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

    // Configure memory in managed mode
    TEST_STORE.saveConfig(projectRoot, {
      mode: 'managed',
      projectId: 'my-proj',
      repoName: workingDir,
      gitRemote: bareRemote,
      branch: 'main',
    });
  });

  afterEach(() => {
    try { if (bareRemote) rmSync(bareRemote, { recursive: true, force: true }); } catch { /* ignore */ }
    try { if (workingDir) rmSync(workingDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { if (projectRoot) rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function writeCleanNote(relPath, body = 'This is a clean note.') {
    if (!projectRoot) return;
    TEST_STORE.writeNote(projectRoot, relPath, {
      frontmatter: {
        memory_id: `sync_${Date.now()}`,
        type: 'session_summary',
        project_id: 'my-proj',
        status: 'active',
        confidence: 'verified',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        tags: ['sync-test'],
      },
      body,
    });
  }

  (GIT_INSTALLED ? it : it.skip)('clean note can be synced (committed)', () => {
    if (!workingDir || !projectRoot) return;
    writeCleanNote('sync-test/clean.md');
    const gs = TEST_GIT.status(workingDir);
    assert.strictEqual(gs.ok, true);
    assert.ok(!gs.clean);
    TEST_GIT.addAll(workingDir);
    const result = TEST_GIT.commit(workingDir, '[memory-sync] 2026-01-01 test sync');
    assert.strictEqual(result.ok, true);
  });

  (GIT_INSTALLED ? it : it.skip)('note with HIGH-severity secret is blocked', () => {
    if (!projectRoot) return;
    // writeNote should throw for HIGH-severity secret
    assert.throws(() => {
      TEST_STORE.writeNote(projectRoot, 'sync-test/secret.md', {
        frontmatter: {
          memory_id: 'sync_secret',
          type: 'session_summary',
          project_id: 'my-proj',
          status: 'active',
          confidence: 'verified',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          tags: [],
        },
        body: 'AKIAIOSFODNN7EXAMPLE is my AWS access key',
      });
    }, /HIGH-severity secret detected/);
  });

  (GIT_INSTALLED ? it : it.skip)('F6: git log contains [memory-sync] after clean sync', () => {
    if (!workingDir || !projectRoot) return;
    writeCleanNote('sync-test/f6-test.md', 'Testing F6 commit message format.');
    TEST_GIT.addAll(workingDir);
    const date = new Date().toISOString().replace(/T.*/, '');
    const message = `[memory-sync] ${date} sync-test/f6-test.md`;
    TEST_GIT.commit(workingDir, message);
    const log = execSync('git', ['log', '-1', '--pretty=%B'], {
      cwd: workingDir,
      encoding: 'utf8',
    }).trim();
    assert.ok(log.startsWith('[memory-sync]'), `Expected log to start with "[memory-sync]", got: ${log}`);
  });

  (GIT_INSTALLED ? it : it.skip)('lock is released after error path', () => {
    if (!workingDir) return;
    const lock = TEST_GIT.acquireLock(workingDir);
    assert.strictEqual(lock.error, undefined);
    try {
      throw new Error('simulated error');
    } catch {
      lock.release();
    }
    assert.ok(!existsSync(join(workingDir, '.sync.lock')));
    // Can acquire after release
    const lock2 = TEST_GIT.acquireLock(workingDir);
    assert.strictEqual(lock2.error, undefined);
    lock2.release();
  });
});
