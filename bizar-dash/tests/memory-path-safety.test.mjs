/**
 * tests/memory-path-safety.test.mjs
 *
 * Tests for path traversal and injection attacks against resolveSafe() and
 * the writeNote / readNote / deleteNote surface.
 *
 * Gap closed: memory-system-map §8.2 HIGH gap #9 "Path traversal safety" and
 * §9 Layer 1 "resolveSafe() path traversal — ../, null bytes, absolute paths,
 * symlink escapes".
 *
 * Each attack vector is tested against writeNote (should throw), readNote
 * (should return null), and deleteNote (should return false).
 *
 * NOTE: If any of these paths are NOT rejected by the current implementation,
 * that IS a finding — document it here (do NOT fix it; the test documents
 * expected behaviour vs actual behaviour).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, existsSync, lstatSync } from 'node:fs';

const TEST_MEMORY_STORE = await import('../src/server/memory-store.mjs').then((m) => m);

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Returns a valid minimal note for passing schema validation. */
function validNote(overrides = {}) {
  return {
    frontmatter: {
      memory_id: `path-safety-${uid().slice(0, 8)}`,
      type: 'session_summary',
      project_id: 'path-safety-test',
      status: 'active',
      confidence: 'verified',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      tags: [],
      title: 'Path safety test',
      ...overrides.frontmatter,
    },
    body: 'path safety body content',
  };
}

describe('memory-path-safety: resolveSafe() via writeNote', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `path-safety-${uid()}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
    TEST_MEMORY_STORE.saveConfig(projectRoot, {
      version: 1,
      backend: 'bizar-local',
      projectId: 'path-safety-test',
      memoryRepo: {
        mode: 'local-only',
        path: join(projectRoot, '.obsidian'),
        remote: null,
        branch: 'main',
        namespace: null,
      },
      namespaces: {
        project: 'projects/path-safety-test',
        global: 'global/bizar',
        user: 'users/tester',
      },
      lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
      git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(path-safety): {summary}' },
    });
    TEST_MEMORY_STORE.initVault(projectRoot);
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // Each entry: path, whether resolveSafe rejects it (true=rejected/throws),
  // and a note explaining the finding if it's not rejected as expected.
  const attackPaths = [
    {
      label: '../../../etc/passwd',
      path: '../../../etc/passwd',
      shouldReject: true,
      finding: null,
    },
    {
      label: '/etc/passwd (absolute)',
      path: '/etc/passwd',
      shouldReject: true,
      finding: null,
    },
    {
      label: 'notes/../escape.md (mid-path dotdot — now rejected by segment check)',
      path: 'notes/../escape.md',
      shouldReject: true,
      finding: null,
    },
    {
      label: 'notes\\x00null.md (null byte — correctly rejected)',
      path: 'notes\x00null.md',
      shouldReject: true,
      finding: null,
    },
    {
      label: 'notes/../../global/bizar/secret.md (cross-namespace)',
      path: 'notes/../../global/bizar/secret.md',
      shouldReject: true,
      finding: null,
    },
    {
      label: '../projects/other/escape.md',
      path: '../projects/other/escape.md',
      shouldReject: true,
      finding: null,
    },
    {
      label: '..\\..\\etc\\passwd (backslash variant)',
      path: '..\\..\\etc\\passwd',
      shouldReject: true,
      finding: null,
    },
    {
      label: 'global/../../etc/passwd',
      path: 'global/../../etc/passwd',
      shouldReject: true,
      finding: null,
    },
  ];

  for (const { label, path, shouldReject, finding } of attackPaths) {
    if (shouldReject) {
      it(`writeNote REJECTS: ${label}`, () => {
        assert.throws(
          () => TEST_MEMORY_STORE.writeNote(projectRoot, path, validNote()),
          /Invalid note path/i,
          `[${label}] writeNote should throw for path: ${path}`,
        );
      });
    } else {
      // Document the finding: path is NOT rejected
      it(`FINDING — writeNote ACCEPTS: ${label}`, () => {
        let thrown = false;
        let result;
        try {
          result = TEST_MEMORY_STORE.writeNote(projectRoot, path, validNote());
        } catch (e) {
          thrown = true;
        }
        // This documents the ACTUAL behaviour (not the desired behaviour)
        assert.strictEqual(
          thrown,
          false,
          `[FINDING] ${label}: path was unexpectedly rejected. Update this test if the behaviour changes.`,
        );
        assert.ok(
          result?.relPath,
          `[FINDING] ${label}: writeNote accepted this path; relPath=${result?.relPath}. ${finding}`,
        );
      });
    }
  }
});

describe('memory-path-safety: resolveSafe() via readNote', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `path-safety-read-${uid()}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
    TEST_MEMORY_STORE.saveConfig(projectRoot, {
      version: 1,
      backend: 'bizar-local',
      projectId: 'path-safety-test',
      memoryRepo: {
        mode: 'local-only',
        path: join(projectRoot, '.obsidian'),
        remote: null,
        branch: 'main',
        namespace: null,
      },
      namespaces: {
        project: 'projects/path-safety-test',
        global: 'global/bizar',
        user: 'users/tester',
      },
      lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
      git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(path-safety): {summary}' },
    });
    TEST_MEMORY_STORE.initVault(projectRoot);
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const attackPaths = [
    { label: '../etc/passwd', path: '../../../etc/passwd' },
    { label: '/etc/passwd absolute', path: '/etc/passwd' },
    { label: 'notes/../escape.md', path: 'notes/../escape.md' },
    { label: 'null byte injection', path: 'notes\x00null.md' },
    { label: 'cross-namespace escape', path: 'notes/../../global/bizar/secret.md' },
  ];

  for (const { label, path } of attackPaths) {
    it(`readNote returns null for: ${label}`, () => {
      const result = TEST_MEMORY_STORE.readNote(projectRoot, path);
      assert.strictEqual(result, null, `[${label}] readNote should return null for path: ${path}`);
    });
  }
});

describe('memory-path-safety: resolveSafe() via deleteNote', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `path-safety-del-${uid()}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
    TEST_MEMORY_STORE.saveConfig(projectRoot, {
      version: 1,
      backend: 'bizar-local',
      projectId: 'path-safety-test',
      memoryRepo: {
        mode: 'local-only',
        path: join(projectRoot, '.obsidian'),
        remote: null,
        branch: 'main',
        namespace: null,
      },
      namespaces: {
        project: 'projects/path-safety-test',
        global: 'global/bizar',
        user: 'users/tester',
      },
      lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
      git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(path-safety): {summary}' },
    });
    TEST_MEMORY_STORE.initVault(projectRoot);
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const attackPaths = [
    { label: '../etc/passwd', path: '../../../etc/passwd' },
    { label: '/etc/passwd absolute', path: '/etc/passwd' },
    { label: 'notes/../escape.md', path: 'notes/../escape.md' },
    { label: 'null byte injection', path: 'notes\x00null.md' },
    { label: 'cross-namespace escape', path: 'notes/../../global/bizar/secret.md' },
  ];

  for (const { label, path } of attackPaths) {
    it(`deleteNote returns false for: ${label}`, () => {
      const result = TEST_MEMORY_STORE.deleteNote(projectRoot, path);
      assert.strictEqual(result, false, `[${label}] deleteNote should return false for path: ${path}`);
    });
  }
});

describe('memory-path-safety: symlink traversal', () => {
  let projectRoot;
  let vaultRoot;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `path-safety-sym-${uid()}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
    vaultRoot = join(projectRoot, '.obsidian');
    mkdirSync(vaultRoot, { recursive: true });

    TEST_MEMORY_STORE.saveConfig(projectRoot, {
      version: 1,
      backend: 'bizar-local',
      projectId: 'path-safety-test',
      memoryRepo: {
        mode: 'local-only',
        path: vaultRoot,
        remote: null,
        branch: 'main',
        namespace: null,
      },
      namespaces: {
        project: 'projects/path-safety-test',
        global: 'global/bizar',
        user: 'users/tester',
      },
      lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
      git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(path-safety): {summary}' },
    });
    TEST_MEMORY_STORE.initVault(projectRoot);
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(join(tmpdir(), `symlink-outside-${uid().slice(0, 8)}.md`), { force: true }); } catch { /* ignore */ }
  });

  it('REGRESSION: symlink inside vault pointing to outside file — writeNote now REJECTS (symlink guard)', () => {
    // Symlink guard (Fix 2): resolveSafe() now refuses to write through a
    // pre-existing symlink inside the vault. The previous behaviour followed
    // the symlink, allowing the outside file to be overwritten.

    const outsideFile = join(tmpdir(), `symlink-outside-${uid()}.md`);
    writeFileSync(outsideFile, 'ORIGINAL CONTENT — should not be overwritten', 'utf8');

    const symlinkPath = join(vaultRoot, 'escape-symlink.md');
    symlinkSync(outsideFile, symlinkPath);

    try {
      assert.throws(
        () => TEST_MEMORY_STORE.writeNote(projectRoot, 'escape-symlink.md', validNote()),
        /Invalid note path/i,
        'writeNote should refuse to follow a pre-existing symlink',
      );

      // Verify: the outside file is UNTOUCHED
      const content = readFileSync(outsideFile, 'utf8');
      assert.ok(
        !content.includes('memory_id:'),
        'Outside file should NOT be overwritten — symlink guard prevented write through symlink',
      );
      assert.strictEqual(
        content,
        'ORIGINAL CONTENT — should not be overwritten',
        'Outside file content should be exactly what we wrote',
      );
    } finally {
      try { rmSync(outsideFile, { force: true }); } catch { /* ignore */ }
      try { rmSync(symlinkPath, { force: true }); } catch { /* ignore */ }
    }
  });

  it('REGRESSION: readNote via symlink returns null (symlink guard blocks info disclosure)', () => {
    // Symlink guard (Fix 2): readNote now refuses to follow a pre-existing
    // symlink, so the outside file's content is NOT returned.

    const outsideFile = join(tmpdir(), `symlink-read-outside-${uid()}.md`);
    const secretContent = 'SECRET FROM OUTSIDE THE VAULT — information disclosure';
    writeFileSync(outsideFile, secretContent, 'utf8');

    const symlinkPath = join(vaultRoot, 'disclose-symlink.md');
    symlinkSync(outsideFile, symlinkPath);

    try {
      const result = TEST_MEMORY_STORE.readNote(projectRoot, 'disclose-symlink.md');
      assert.strictEqual(
        result,
        null,
        'readNote should return null for a symlink path (symlink guard)',
      );
    } finally {
      try { rmSync(outsideFile, { force: true }); } catch { /* ignore */ }
      try { rmSync(symlinkPath, { force: true }); } catch { /* ignore */ }
    }
  });

  it('REGRESSION: filenames containing `..` as a substring (not as a segment) are still accepted', () => {
    // Fix 3: segment-level check rejects `..` SEGMENTS but allows substrings.
    // `my..note.md` is a valid filename.

    const note = validNote();
    const relPath = 'decisions/my..note.md';
    const result = TEST_MEMORY_STORE.writeNote(projectRoot, relPath, note);
    assert.strictEqual(result.relPath, relPath, 'filename with `..` substring should be accepted');

    const readBack = TEST_MEMORY_STORE.readNote(projectRoot, relPath);
    assert.ok(readBack, 'readBack should succeed');
    assert.strictEqual(readBack.relPath, relPath, 'readBack relPath should match');

    // Cleanup
    TEST_MEMORY_STORE.deleteNote(projectRoot, relPath);
  });

  it('REGRESSION: dangling symlink (target does not exist) is also rejected by symlink guard', () => {
    // The symlink guard must use lstatSync directly — existsSync follows
    // symlinks and returns false for dangling ones, which would have
    // bypassed the original guard. This test ensures the dangling case
    // is covered too.

    const danglingTarget = join(tmpdir(), `dangling-symlink-target-${uid()}.md`);
    // Do NOT create danglingTarget — it should remain non-existent.

    const symlinkPath = join(vaultRoot, 'dangling-symlink.md');
    symlinkSync(danglingTarget, symlinkPath);

    try {
      // Sanity: existsSync says false (follows the symlink), lstatSync says
      // true (does not follow).
      assert.strictEqual(
        existsSync(symlinkPath),
        false,
        'precondition: existsSync returns false for dangling symlink',
      );
      assert.strictEqual(
        lstatSync(symlinkPath).isSymbolicLink(),
        true,
        'precondition: lstatSync identifies the symlink correctly',
      );

      assert.throws(
        () => TEST_MEMORY_STORE.writeNote(projectRoot, 'dangling-symlink.md', validNote()),
        /Invalid note path/i,
        'writeNote should refuse dangling symlinks too (uses lstatSync directly)',
      );

      assert.strictEqual(
        TEST_MEMORY_STORE.readNote(projectRoot, 'dangling-symlink.md'),
        null,
        'readNote should return null for dangling symlinks',
      );

      assert.strictEqual(
        TEST_MEMORY_STORE.deleteNote(projectRoot, 'dangling-symlink.md'),
        false,
        'deleteNote should refuse dangling symlinks',
      );
    } finally {
      try { rmSync(symlinkPath, { force: true }); } catch { /* ignore */ }
    }
  });
});
