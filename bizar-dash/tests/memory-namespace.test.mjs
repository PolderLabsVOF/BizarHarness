/**
 * tests/memory-namespace.test.mjs
 *
 * Tests for namespace isolation across the three supported namespaces:
 *   projects/<id>/   — project-scoped notes
 *   global/bizar/    — cross-project system knowledge
 *   users/<userId>/  — personal user notes
 *
 * Verifies that notes written to one namespace:
 *   (a) exist and are readable
 *   (b) appear in listNotes/searchVault results
 *   (c) do not cross-contaminate (notes from one namespace don't appear under another's path)
 *
 * Gap closed: memory-system-map §8.1 CRITICAL gap #1 "Namespace creation &
 * isolation — global/ and users/ namespaces are configured but never tested".
 *
 * FIX 5: listNotes/readNote/deleteNote now accept an `opts.root` override so
 * that callers (CLI cmdList/cmdRead/cmdDelete, plus tests) can target
 * specific namespaces in managed mode. resolveNamespaceRoot() in
 * memory-store.mjs returns the absolute path for each namespace, and the
 * new opts.root parameter lets the existing functions operate on a
 * different root than the default vaultRoot.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

const TEST_MEMORY_STORE = await import('../src/server/memory-store.mjs').then((m) => m);

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function validNote(namespace) {
  return {
    frontmatter: {
      memory_id: `ns_${namespace}_${uid().slice(0, 8)}`,
      type: 'session_summary',
      project_id: 'ns-test-proj',
      status: 'active',
      confidence: 'verified',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      tags: [namespace],
      title: `Namespace test — ${namespace}`,
    },
    body: `Content in namespace: ${namespace}\nUnique: ${uid()}\n`,
  };
}

describe('memory-namespace: managed mode — write/read across namespaces', () => {
  let projectRoot;
  let sharedRepo;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `ns-test-${uid()}`);
    sharedRepo = join(tmpdir(), `ns-repo-${uid()}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(sharedRepo, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

    // Create all namespace directories in the shared repo
    mkdirSync(join(sharedRepo, 'projects', 'ns-test-proj', 'decisions'), { recursive: true });
    mkdirSync(join(sharedRepo, 'projects', 'ns-test-proj', 'api'), { recursive: true });
    mkdirSync(join(sharedRepo, 'global', 'bizar'), { recursive: true });
    mkdirSync(join(sharedRepo, 'users', 'tester'), { recursive: true });

    TEST_MEMORY_STORE.saveConfig(projectRoot, {
      version: 1,
      backend: 'bizar-local',
      projectId: 'ns-test-proj',
      memoryRepo: {
        mode: 'managed',
        path: sharedRepo,
        remote: null,
        branch: 'main',
        namespace: 'projects/ns-test-proj',
      },
      namespaces: {
        project: 'projects/ns-test-proj',
        global: 'global/bizar',
        user: 'users/tester',
      },
      lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
      git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(ns-test): {summary}' },
    });
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(sharedRepo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('namespace filtering via resolveNamespaceRoot + opts.root (Fix 5)', () => {
    it('resolveNamespaceRoot returns project root for "project" namespace', () => {
      const vi = TEST_MEMORY_STORE.resolveVault(projectRoot);
      const root = TEST_MEMORY_STORE.resolveNamespaceRoot(vi, 'project');
      assert.strictEqual(root, vi.vaultRoot, 'project namespace root should equal vaultRoot');
    });

    it('resolveNamespaceRoot returns <vaultRoot>/<namespaces.X> for global/user', () => {
      const vi = TEST_MEMORY_STORE.resolveVault(projectRoot);
      const globalRoot = TEST_MEMORY_STORE.resolveNamespaceRoot(vi, 'global');
      const userRoot = TEST_MEMORY_STORE.resolveNamespaceRoot(vi, 'user');
      assert.ok(globalRoot && globalRoot.includes('global/bizar'),
        `global root should include 'global/bizar'; got: ${globalRoot}`);
      assert.ok(userRoot && userRoot.includes('users/tester'),
        `user root should include 'users/tester'; got: ${userRoot}`);
      // In BOTH local-only and managed modes, global/user live UNDER
      // vaultRoot — writeNote('global/bizar/...', …) writes there directly.
      // This matches the actual on-disk layout callers depend on.
      assert.ok(globalRoot.startsWith(vi.vaultRoot),
        `global root should be INSIDE vaultRoot; got: ${globalRoot} (vaultRoot: ${vi.vaultRoot})`);
      assert.ok(userRoot.startsWith(vi.vaultRoot),
        `user root should be INSIDE vaultRoot; got: ${userRoot} (vaultRoot: ${vi.vaultRoot})`);
    });

    it('listNotes with { root, namespace } returns only notes from that namespace (managed mode)', () => {
      // Write notes to all three namespaces using their full relPaths
      TEST_MEMORY_STORE.writeNote(projectRoot, 'decisions/proj-filter-fix5.md', validNote('project'));
      TEST_MEMORY_STORE.writeNote(projectRoot, 'global/bizar/glob-filter-fix5.md', validNote('global'));
      TEST_MEMORY_STORE.writeNote(projectRoot, 'users/tester/usr-filter-fix5.md', validNote('user'));

      const vi = TEST_MEMORY_STORE.resolveVault(projectRoot);

      const globalRoot = TEST_MEMORY_STORE.resolveNamespaceRoot(vi, 'global');
      const userRoot = TEST_MEMORY_STORE.resolveNamespaceRoot(vi, 'user');

      const globalNotes = TEST_MEMORY_STORE.listNotes(projectRoot, { root: globalRoot });
      const userNotes = TEST_MEMORY_STORE.listNotes(projectRoot, { root: userRoot });

      const globalRelPaths = globalNotes.map((n) => n.relPath);
      const userRelPaths = userNotes.map((n) => n.relPath);

      assert.ok(globalRelPaths.some((p) => p.includes('glob-filter-fix5')),
        `global notes should include glob-filter-fix5; got: ${JSON.stringify(globalRelPaths)}`);
      assert.ok(userRelPaths.some((p) => p.includes('usr-filter-fix5')),
        `user notes should include usr-filter-fix5; got: ${JSON.stringify(userRelPaths)}`);
      // No overlap
      for (const n of globalNotes) {
        assert.ok(!n.relPath.includes('proj-filter'),
          `global set should NOT include project notes; got: ${n.relPath}`);
      }
    });

    it('readNote / deleteNote with { root } works in non-project namespaces', () => {
      // Write using the full relPath (which goes through vaultRoot — writeNote
      // doesn't accept opts.root, but the file lands in the right namespace
      // because vaultRoot + 'global/bizar/...' resolves correctly).
      const writeRelPath = 'global/bizar/read-with-root-fix5.md';
      TEST_MEMORY_STORE.writeNote(projectRoot, writeRelPath, validNote('global'));

      const vi = TEST_MEMORY_STORE.resolveVault(projectRoot);
      const globalRoot = TEST_MEMORY_STORE.resolveNamespaceRoot(vi, 'global');

      // relPath for read/delete is relative to `root` (which already ends in
      // 'global/bizar'), so just the basename.
      const relPath = 'read-with-root-fix5.md';

      const readBack = TEST_MEMORY_STORE.readNote(projectRoot, relPath, { root: globalRoot });
      assert.ok(readBack, 'readNote with { root } should find the note');
      assert.strictEqual(readBack.relPath, relPath);

      const deleted = TEST_MEMORY_STORE.deleteNote(projectRoot, relPath, { root: globalRoot });
      assert.strictEqual(deleted, true, 'deleteNote with { root } should return true');

      const after = TEST_MEMORY_STORE.readNote(projectRoot, relPath, { root: globalRoot });
      assert.strictEqual(after, null, 'note should be gone after delete');
    });
  });

  describe('writeNote to each namespace', () => {
    it('writes a note to the project namespace (subdir of vaultRoot)', () => {
      const note = validNote('project');
      const relPath = 'decisions/project-ns-test.md';
      const written = TEST_MEMORY_STORE.writeNote(projectRoot, relPath, note);
      assert.strictEqual(written.relPath, relPath, 'relPath should match');
      assert.strictEqual(written.schemaValid, true, 'schemaValid should be true');
    });

    it('writes a note to the global namespace (sibling to vaultRoot)', () => {
      const note = validNote('global');
      // In managed mode with vaultRoot=sharedRepo/projects/ns-test-proj, writing to
      // global/bizar/... creates the file at sharedRepo/global/bizar/... (sibling to
      // the project vault, not nested within it)
      const relPath = 'global/bizar/global-ns-test.md';
      const written = TEST_MEMORY_STORE.writeNote(projectRoot, relPath, note);
      assert.strictEqual(written.relPath, relPath, 'relPath should match');
      assert.strictEqual(written.schemaValid, true, 'schemaValid should be true');
    });

    it('writes a note to the user namespace (sibling to vaultRoot)', () => {
      const note = validNote('user');
      const relPath = 'users/tester/user-ns-test.md';
      const written = TEST_MEMORY_STORE.writeNote(projectRoot, relPath, note);
      assert.strictEqual(written.relPath, relPath, 'relPath should match');
      assert.strictEqual(written.schemaValid, true, 'schemaValid should be true');
    });
  });

  describe('readNote across namespaces', () => {
    it('reads a note from the project namespace', () => {
      const relPath = 'decisions/read-project.md';
      TEST_MEMORY_STORE.writeNote(projectRoot, relPath, validNote('project'));
      const readBack = TEST_MEMORY_STORE.readNote(projectRoot, relPath);
      assert.ok(readBack, 'should read back project namespace note');
      assert.strictEqual(readBack.frontmatter.type, 'session_summary');
    });

    it('reads a note from the global namespace', () => {
      const relPath = 'global/bizar/read-global.md';
      TEST_MEMORY_STORE.writeNote(projectRoot, relPath, validNote('global'));
      const readBack = TEST_MEMORY_STORE.readNote(projectRoot, relPath);
      assert.ok(readBack, 'should read back global namespace note');
      assert.strictEqual(readBack.frontmatter.type, 'session_summary');
    });

    it('reads a note from the user namespace', () => {
      const relPath = 'users/tester/read-user.md';
      TEST_MEMORY_STORE.writeNote(projectRoot, relPath, validNote('user'));
      const readBack = TEST_MEMORY_STORE.readNote(projectRoot, relPath);
      assert.ok(readBack, 'should read back user namespace note');
      assert.strictEqual(readBack.frontmatter.type, 'session_summary');
    });
  });

  describe('listNotes: all namespaces visible when vault is repo root', () => {
    // This sub-suite uses local-only mode where vault IS the repo root,
    // so namespace filters actually work as intended.

    let localRoot;

    beforeEach(() => {
      localRoot = join(tmpdir(), `ns-local-${uid()}`);
      mkdirSync(localRoot, { recursive: true });
      mkdirSync(join(localRoot, '.bizar'), { recursive: true });
      TEST_MEMORY_STORE.saveConfig(localRoot, {
        version: 1,
        backend: 'bizar-local',
        projectId: 'ns-local-test',
        memoryRepo: {
          mode: 'local-only',
          path: join(localRoot, '.obsidian'),
          remote: null,
          branch: 'main',
          namespace: null,
        },
        namespaces: {
          project: 'projects/ns-local-test',
          global: 'global/bizar',
          user: 'users/tester',
        },
        lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(localRoot, '.bizar', 'lightrag') },
        git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(ns-local): {summary}' },
      });
      TEST_MEMORY_STORE.initVault(localRoot);
    });

    afterEach(() => {
      try { rmSync(localRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('listNotes (no filter) returns notes from all three namespace directories', () => {
      TEST_MEMORY_STORE.writeNote(localRoot, 'decisions/local-project.md', validNote('project'));
      TEST_MEMORY_STORE.writeNote(localRoot, 'global/bizar/local-global.md', validNote('global'));
      TEST_MEMORY_STORE.writeNote(localRoot, 'users/tester/local-user.md', validNote('user'));

      const all = TEST_MEMORY_STORE.listNotes(localRoot);
      assert.ok(all.length >= 3, `should have at least 3 notes; got ${all.length}`);
      const relPaths = all.map((n) => n.relPath);
      assert.ok(relPaths.some((p) => p.includes('local-project')), 'should include project note');
      assert.ok(relPaths.some((p) => p.includes('local-global')), 'should include global note');
      assert.ok(relPaths.some((p) => p.includes('local-user')), 'should include user note');
    });

    it('namespace filter returns only notes within that namespace directory', () => {
      TEST_MEMORY_STORE.writeNote(localRoot, 'decisions/filter-project.md', validNote('project'));
      TEST_MEMORY_STORE.writeNote(localRoot, 'global/bizar/filter-global.md', validNote('global'));
      TEST_MEMORY_STORE.writeNote(localRoot, 'users/tester/filter-user.md', validNote('user'));

      const projectNotes = TEST_MEMORY_STORE.listNotes(localRoot, { namespace: 'projects' });
      const globalNotes = TEST_MEMORY_STORE.listNotes(localRoot, { namespace: 'global/bizar' });
      const userNotes = TEST_MEMORY_STORE.listNotes(localRoot, { namespace: 'users/tester' });

      // Each namespace filter returns only notes from within that namespace directory.
      // relPath is relative to searchRoot (the namespace directory), not to vaultRoot,
      // so a note at .obsidian/global/bizar/filter-global.md has relPath 'filter-global.md'
      // when listed with namespace='global/bizar'.

      // Verify: notes written to global/bizar/ appear in globalNotes
      const globalRelPaths = globalNotes.map((n) => n.relPath);
      assert.ok(
        globalRelPaths.some((p) => p.includes('filter-global')),
        `globalNotes should include filter-global; got: ${JSON.stringify(globalRelPaths)}`,
      );

      // Verify: notes written to users/tester/ appear in userNotes
      const userRelPaths = userNotes.map((n) => n.relPath);
      assert.ok(
        userRelPaths.some((p) => p.includes('filter-user')),
        `userNotes should include filter-user; got: ${JSON.stringify(userRelPaths)}`,
      );

      // Verify: project notes do NOT appear in globalNotes
      for (const n of globalNotes) {
        assert.ok(
          !n.relPath.includes('filter-project'),
          `globalNotes should NOT include project note; got relPath: ${n.relPath}`,
        );
      }

      // Verify: global notes do NOT appear in userNotes
      for (const n of userNotes) {
        assert.ok(
          !n.relPath.includes('filter-global'),
          `userNotes should NOT include global note; got relPath: ${n.relPath}`,
        );
      }

      // Verify: no overlap between any two namespace sets
      const globalSet = new Set(globalNotes.map((n) => n.relPath));
      const userSet = new Set(userNotes.map((n) => n.relPath));
      assert.strictEqual(
        [...globalSet].filter((p) => userSet.has(p)).length,
        0,
        'global and user sets should not overlap',
      );
    });
  });

  describe('searchVault: cross-namespace search', () => {
    beforeEach(() => {
      TEST_MEMORY_STORE.writeNote(projectRoot, 'decisions/search-project.md', {
        frontmatter: {
          memory_id: `search_proj_${uid().slice(0, 8)}`,
          type: 'session_summary', project_id: 'ns-test-proj', status: 'active',
          confidence: 'verified', created: new Date().toISOString(),
          updated: new Date().toISOString(), tags: [], title: 'Project note UNIQUE_TOKEN_PRJ',
        },
        body: 'Project namespace token UNIQUE_TOKEN_PRJ',
      });
      TEST_MEMORY_STORE.writeNote(projectRoot, 'global/bizar/search-global.md', {
        frontmatter: {
          memory_id: `search_global_${uid().slice(0, 8)}`,
          type: 'session_summary', project_id: 'ns-test-proj', status: 'active',
          confidence: 'verified', created: new Date().toISOString(),
          updated: new Date().toISOString(), tags: [], title: 'Global note UNIQUE_TOKEN_GLB',
        },
        body: 'Global namespace token UNIQUE_TOKEN_GLB',
      });
      TEST_MEMORY_STORE.writeNote(projectRoot, 'users/tester/search-user.md', {
        frontmatter: {
          memory_id: `search_user_${uid().slice(0, 8)}`,
          type: 'session_summary', project_id: 'ns-test-proj', status: 'active',
          confidence: 'verified', created: new Date().toISOString(),
          updated: new Date().toISOString(), tags: [], title: 'User note UNIQUE_TOKEN_USR',
        },
        body: 'User namespace token UNIQUE_TOKEN_USR',
      });
    });

    it('searchVault finds notes in the project namespace by unique token', () => {
      const results = TEST_MEMORY_STORE.searchVault(projectRoot, 'UNIQUE_TOKEN_PRJ');
      assert.ok(results.length >= 1, 'should find project note');
      assert.ok(results.some((r) => r.relPath.includes('search-project')), 'should find the project note');
    });

    it('searchVault finds notes in the global namespace by unique token', () => {
      const results = TEST_MEMORY_STORE.searchVault(projectRoot, 'UNIQUE_TOKEN_GLB');
      assert.ok(results.length >= 1, 'should find global note');
      assert.ok(results.some((r) => r.relPath.includes('search-global')), 'should find the global note');
    });

    it('searchVault finds notes in the user namespace by unique token', () => {
      const results = TEST_MEMORY_STORE.searchVault(projectRoot, 'UNIQUE_TOKEN_USR');
      assert.ok(results.length >= 1, 'should find user note');
      assert.ok(results.some((r) => r.relPath.includes('search-user')), 'should find the user note');
    });

    it('searchVault cross-namespace search returns notes from ALL namespaces', () => {
      const results = TEST_MEMORY_STORE.searchVault(projectRoot, 'namespace token');
      const relPaths = results.map((r) => r.relPath);
      assert.ok(relPaths.some((p) => p.includes('search-project')), 'should include project note');
      assert.ok(relPaths.some((p) => p.includes('search-global')), 'should include global note');
      assert.ok(relPaths.some((p) => p.includes('search-user')), 'should include user note');
    });
  });

  describe('deleteNote: namespace isolation', () => {
    it('deleting from one namespace does not affect notes in another', () => {
      TEST_MEMORY_STORE.writeNote(projectRoot, 'decisions/to-delete-project.md', validNote('project'));
      TEST_MEMORY_STORE.writeNote(projectRoot, 'global/bizar/to-delete-global.md', validNote('global'));

      const deleted = TEST_MEMORY_STORE.deleteNote(projectRoot, 'decisions/to-delete-project.md');
      assert.strictEqual(deleted, true, 'deleteNote should return true for project note');

      assert.strictEqual(TEST_MEMORY_STORE.readNote(projectRoot, 'decisions/to-delete-project.md'), null, 'project note should be gone');

      const globalStillThere = TEST_MEMORY_STORE.readNote(projectRoot, 'global/bizar/to-delete-global.md');
      assert.ok(globalStillThere, 'global note should still exist after project note deletion');
    });
  });
});
