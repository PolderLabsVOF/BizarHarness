/**
 * tests/memory-store.test.mjs
 *
 * Tests for the MarkdownMemoryStore.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';

const TEST_MEMORY_STORE = await import('../src/server/memory-store.mjs').then((m) => m);

describe('memory-store', () => {
  let projectRoot;
  let otherRoot;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `bizar-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    otherRoot = join(tmpdir(), `bizar-test-other-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(otherRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(otherRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── resolveVault ──────────────────────────────────────────────────────────────

  describe('resolveVault', () => {
    it('returns .obsidian path in local-only mode', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      const { vaultRoot, mode } = TEST_MEMORY_STORE.resolveVault(projectRoot);
      assert.strictEqual(mode, 'local-only');
      assert.strictEqual(vaultRoot, join(projectRoot, '.obsidian'));
    });

    it('returns shared repo path in managed mode with ~ expanded', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'managed', path: '~/data/memory', remote: null, branch: 'main', namespace: 'projects/my-proj' },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      const { vaultRoot, projectVaultRoot, mode } = TEST_MEMORY_STORE.resolveVault(projectRoot);
      assert.strictEqual(mode, 'managed');
      assert.ok(vaultRoot.includes('data/memory'), 'vaultRoot should include data/memory');
      assert.ok(projectVaultRoot.includes('projects'), 'projectVaultRoot should include projects');
      assert.ok(projectVaultRoot.includes('my-proj'), 'projectVaultRoot should include my-proj');
      assert.ok(projectVaultRoot.startsWith(vaultRoot), 'projectVaultRoot should be under vaultRoot');
    });
  });

  // ── initVault ────────────────────────────────────────────────────────────────

  describe('initVault', () => {
    it('creates .obsidian/ with subdirs in local-only mode', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      const result = TEST_MEMORY_STORE.initVault(projectRoot);
      assert.ok(result.ok);
      assert.ok(existsSync(join(projectRoot, '.obsidian')));
      assert.ok(existsSync(join(projectRoot, '.obsidian', 'decisions')));
      assert.ok(existsSync(join(projectRoot, '.obsidian', 'patterns')));
      assert.ok(existsSync(join(projectRoot, '.obsidian', 'api')));
    });

    // F7: project namespace is NOT created at initVault time (only the shared
    // repo parent dirs — projects/, global/, users/ — are created)
    it('F7: does NOT create project namespace directory at initVault in managed mode', () => {
      const sharedRepo = join(tmpdir(), `shared-repo-${Date.now()}`);
      mkdirSync(sharedRepo, { recursive: true });

      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'managed', path: sharedRepo, remote: null, branch: 'main', namespace: 'projects/my-proj' },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });

      const result = TEST_MEMORY_STORE.initVault(projectRoot);
      assert.ok(result.ok);
      // projects/ directory should exist (created by initVault)
      assert.ok(existsSync(join(sharedRepo, 'projects')));
      // But the project-specific namespace (projects/my-proj/) should NOT be created yet
      const expectedNsDir = join(sharedRepo, 'projects', 'my-proj');
      assert.ok(!existsSync(expectedNsDir), 'project namespace should NOT be created at initVault');
    });
  });

  // ── writeNote / readNote / listNotes ─────────────────────────────────────────

  describe('writeNote + readNote', () => {
    it('writes and reads a note back', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      TEST_MEMORY_STORE.initVault(projectRoot);

      const note = {
        frontmatter: {
          memory_id: 'test_note_1',
          type: 'architecture_decision',
          project_id: 'my-proj',
          status: 'active',
          confidence: 'verified',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          tags: ['arch', 'api'],
        },
        body: '# Architecture\n\nThis is the body.',
      };

      const written = TEST_MEMORY_STORE.writeNote(projectRoot, 'decisions/adrs.md', note);
      assert.strictEqual(written.relPath, 'decisions/adrs.md');
      assert.strictEqual(written.schemaValid, true);

      const readBack = TEST_MEMORY_STORE.readNote(projectRoot, 'decisions/adrs.md');
      assert.ok(readBack);
      assert.strictEqual(readBack.frontmatter.type, 'architecture_decision');
      assert.ok(readBack.body.includes('Architecture'));
    });

    it('F7: creates project namespace directory on first writeNote', () => {
      const sharedRepo = join(tmpdir(), `shared-repo-writer-${Date.now()}`);
      mkdirSync(sharedRepo, { recursive: true });
      mkdirSync(join(sharedRepo, 'projects'), { recursive: true });

      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'managed', path: sharedRepo, remote: null, branch: 'main', namespace: 'projects/my-proj' },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });

      // Pre-condition: namespace dir does not exist
      const expectedNsDir = join(sharedRepo, 'projects', 'my-proj');
      assert.ok(!existsSync(expectedNsDir));

      TEST_MEMORY_STORE.writeNote(projectRoot, 'decisions/adrs.md', {
        frontmatter: {
          memory_id: 'test_note_ns',
          type: 'architecture_decision',
          project_id: 'my-proj',
          status: 'active',
          confidence: 'verified',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          tags: [],
        },
        body: 'test',
      });

      // Post-condition: namespace dir was created
      assert.ok(existsSync(expectedNsDir), 'project namespace should be created on first writeNote');
    });

    it('rejects notes missing required fields', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      TEST_MEMORY_STORE.initVault(projectRoot);

      assert.throws(() => {
        TEST_MEMORY_STORE.writeNote(projectRoot, 'test.md', {
          frontmatter: { title: 'No required fields' },
          body: 'body',
        });
      }, /schema validation failed/);
    });

    it('rejects when HIGH-severity secret is present', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      TEST_MEMORY_STORE.initVault(projectRoot);

      assert.throws(() => {
        TEST_MEMORY_STORE.writeNote(projectRoot, 'test.md', {
          frontmatter: {
            memory_id: 'test_secret',
            type: 'session_summary',
            project_id: 'my-proj',
            status: 'active',
            confidence: 'verified',
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            tags: [],
          },
          body: 'AKIAIOSFODNN7EXAMPLE is an AWS key',
        });
      }, /HIGH-severity secret detected/);
    });

    it('warns but succeeds on MEDIUM-severity secret', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      TEST_MEMORY_STORE.initVault(projectRoot);

      // Should not throw
      const written = TEST_MEMORY_STORE.writeNote(projectRoot, 'test.md', {
        frontmatter: {
          memory_id: 'test_med',
          type: 'session_summary',
          project_id: 'my-proj',
          status: 'active',
          confidence: 'verified',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          tags: [],
        },
        body: 'api_key: abcdefghijklmnopqrstuvwxyz123456',
      });
      assert.ok(written);
    });
  });

  // ── path safety ─────────────────────────────────────────────────────────────

  describe('path safety', () => {
    it('readNote returns null for path traversal attempt', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      TEST_MEMORY_STORE.initVault(projectRoot);

      const result = TEST_MEMORY_STORE.readNote(projectRoot, '../../../etc/passwd');
      assert.strictEqual(result, null);
    });

    it('writeNote rejects path traversal attempt', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      TEST_MEMORY_STORE.initVault(projectRoot);

      assert.throws(() => {
        TEST_MEMORY_STORE.writeNote(projectRoot, '../../../etc/passwd', {
          frontmatter: { memory_id: 'hax', type: 'session_summary', project_id: 'p', status: 'active', confidence: 'verified', created: '2026-01-01', updated: '2026-01-01', tags: [] },
          body: 'hax',
        });
      }, /Invalid note path/);
    });
  });

  // ── listNotes ────────────────────────────────────────────────────────────────

  describe('listNotes', () => {
    it('returns all notes in vault', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      TEST_MEMORY_STORE.initVault(projectRoot);

      TEST_MEMORY_STORE.writeNote(projectRoot, 'note1.md', {
        frontmatter: { memory_id: 'n1', type: 'session_summary', project_id: 'p', status: 'active', confidence: 'verified', created: '2026-01-01', updated: '2026-01-01', tags: [] },
        body: 'note 1',
      });
      TEST_MEMORY_STORE.writeNote(projectRoot, 'note2.md', {
        frontmatter: { memory_id: 'n2', type: 'session_summary', project_id: 'p', status: 'active', confidence: 'verified', created: '2026-01-01', updated: '2026-01-01', tags: [] },
        body: 'note 2',
      });

      const notes = TEST_MEMORY_STORE.listNotes(projectRoot);
      assert.strictEqual(notes.length, 2);
    });
  });

  // ── searchVault ─────────────────────────────────────────────────────────────

  describe('searchVault', () => {
    it('finds a note by exact substring', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      TEST_MEMORY_STORE.initVault(projectRoot);

      TEST_MEMORY_STORE.writeNote(projectRoot, 'search-test.md', {
        frontmatter: { memory_id: 'st1', type: 'session_summary', project_id: 'p', status: 'active', confidence: 'verified', created: '2026-01-01', updated: '2026-01-01', tags: [] },
        body: 'This note is about PostgreSQL optimization techniques.',
      });

      const results = TEST_MEMORY_STORE.searchVault(projectRoot, 'PostgreSQL');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].relPath, 'search-test.md');
    });

    it('returns empty array for no matches', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      TEST_MEMORY_STORE.initVault(projectRoot);
      const results = TEST_MEMORY_STORE.searchVault(projectRoot, 'nonexistentquery');
      assert.strictEqual(results.length, 0);
    });
  });

  // ── deleteNote ───────────────────────────────────────────────────────────────

  describe('deleteNote', () => {
    it('deletes an existing note', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      TEST_MEMORY_STORE.initVault(projectRoot);

      TEST_MEMORY_STORE.writeNote(projectRoot, 'to-delete.md', {
        frontmatter: { memory_id: 'td1', type: 'session_summary', project_id: 'p', status: 'active', confidence: 'verified', created: '2026-01-01', updated: '2026-01-01', tags: [] },
        body: 'delete me',
      });

      const ok = TEST_MEMORY_STORE.deleteNote(projectRoot, 'to-delete.md');
      assert.strictEqual(ok, true);

      const readBack = TEST_MEMORY_STORE.readNote(projectRoot, 'to-delete.md');
      assert.strictEqual(readBack, null);
    });

    it('returns false for non-existent note', () => {
      TEST_MEMORY_STORE.saveConfig(projectRoot, {
        version: 1, backend: 'bizar-local', projectId: 'my-proj',
        memoryRepo: { mode: 'local-only', path: join(projectRoot, '.obsidian'), remote: null, branch: 'main', namespace: null },
        namespaces: { project: 'projects/my-proj', global: 'global/bizar', user: 'users/local' },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(my-proj): {summary}' },
      });
      TEST_MEMORY_STORE.initVault(projectRoot);
      const ok = TEST_MEMORY_STORE.deleteNote(projectRoot, 'does-not-exist.md');
      assert.strictEqual(ok, false);
    });
  });
});
