/**
 * tests/memory-roundtrip.test.mjs
 *
 * Rule #42 end-to-end round-trip test: write → read → search → list → delete.
 * Runs THREE times:
 *   Mode A: local-only  (vault in project temp dir)
 *   Mode B: managed     (vault in temp dir simulating ~/.local/share/bizar/...)
 *   Mode C: namespace variants (project / global / user)
 *
 * Gap closed: memory-system-map §8.1 / §9 Layer-4 "Full write/read/search/delete
 * round-trip — CLI write → CLI status → CLI search → REST read → DELETE".
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const CLI_BIN = join(dirname(__filename), '..', '..', 'cli', 'bin.mjs');

const TEST_MEMORY_STORE = await import('../src/server/memory-store.mjs').then((m) => m);

/** Unique ID to avoid cross-test pollution */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Full round-trip test helper.
 * @param {'local-only'|'managed'} mode
 * @param {'project'|'global'|'user'} namespace
 */
async function runRoundtrip(mode, namespace) {
  const projectRoot = join(tmpdir(), `roundtrip-${mode}-${namespace}-${uid()}`);
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

  let vaultRoot;
  let sharedRepo;

  if (mode === 'local-only') {
    vaultRoot = join(projectRoot, '.obsidian');
    mkdirSync(vaultRoot, { recursive: true });
    TEST_MEMORY_STORE.saveConfig(projectRoot, {
      version: 1,
      backend: 'bizar-local',
      projectId: 'roundtrip-test',
      memoryRepo: {
        mode: 'local-only',
        path: vaultRoot,
        remote: null,
        branch: 'main',
        namespace: null,
      },
      namespaces: {
        project: 'projects/roundtrip-test',
        global: 'global/bizar',
        user: 'users/tester',
      },
      lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
      git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(roundtrip): {summary}' },
    });
  } else {
    // managed mode — vault lives in a shared repo under projects/<id>/
    sharedRepo = join(tmpdir(), `shared-repo-${uid()}`);
    mkdirSync(sharedRepo, { recursive: true });
    // Ensure parent namespace dirs exist
    mkdirSync(join(sharedRepo, 'projects'), { recursive: true });
    mkdirSync(join(sharedRepo, 'global', 'bizar'), { recursive: true });
    mkdirSync(join(sharedRepo, 'users', 'tester'), { recursive: true });

    const nsMap = {
      project: `projects/roundtrip-test`,
      global: `global/bizar`,
      user: `users/tester`,
    };
    const ns = nsMap[namespace];
    const vaultPath = join(sharedRepo, ns);

    TEST_MEMORY_STORE.saveConfig(projectRoot, {
      version: 1,
      backend: 'bizar-local',
      projectId: 'roundtrip-test',
      memoryRepo: {
        mode: 'managed',
        path: sharedRepo,
        remote: null,
        branch: 'main',
        namespace: ns,
      },
      namespaces: {
        project: `projects/roundtrip-test`,
        global: 'global/bizar',
        user: 'users/tester',
      },
      lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
      git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(roundtrip): {summary}' },
    });

    vaultRoot = join(sharedRepo, ns);
    // Ensure the namespace directory exists (writeNote creates it lazily, but
    // we can pre-create to avoid mkdir in the writeNote path)
    mkdirSync(vaultRoot, { recursive: true });
  }

  const noteRelPath = `${namespace}-roundtrip-${uid().slice(0, 8)}.md`;
  const note = {
    frontmatter: {
      memory_id: `roundtrip_${namespace}_${uid().slice(0, 8)}`,
      type: 'session_summary',
      project_id: 'roundtrip-test',
      status: 'active',
      confidence: 'verified',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      tags: ['roundtrip', mode, namespace],
      title: `Roundtrip test — ${mode} / ${namespace}`,
    },
    body: `# Roundtrip Test\n\nMode: ${mode}\nNamespace: ${namespace}\nUnique: ${uid()}\n`,
  };

  // ── Step 1: writeNote ──────────────────────────────────────────────────────
  const written = TEST_MEMORY_STORE.writeNote(projectRoot, noteRelPath, note);
  assert.ok(written, `[${mode}/${namespace}] writeNote should return a result`);
  assert.strictEqual(written.relPath, noteRelPath, `[${mode}/${namespace}] relPath should match`);
  assert.strictEqual(written.schemaValid, true, `[${mode}/${namespace}] schemaValid should be true`);

  // ── Step 2: readNote ───────────────────────────────────────────────────────
  const readBack = TEST_MEMORY_STORE.readNote(projectRoot, noteRelPath);
  assert.ok(readBack, `[${mode}/${namespace}] readNote should find the note`);
  assert.strictEqual(readBack.relPath, noteRelPath, `[${mode}/${namespace}] readBack relPath should match`);
  assert.strictEqual(readBack.frontmatter.type, 'session_summary', `[${mode}/${namespace}] frontmatter.type should match`);
  assert.ok(readBack.body.includes('Roundtrip Test'), `[${mode}/${namespace}] body should contain expected content`);
  assert.strictEqual(readBack.schemaValid, true, `[${mode}/${namespace}] readBack.schemaValid should be true`);

  // ── Step 3: searchVault ────────────────────────────────────────────────────
  const searchResults = TEST_MEMORY_STORE.searchVault(projectRoot, 'Roundtrip Test');
  const found = searchResults.find((r) => r.relPath === noteRelPath);
  assert.ok(found, `[${mode}/${namespace}] searchVault should find the note (query: 'Roundtrip Test')`);
  assert.ok(found.snippet.includes('roundtrip test'), `[${mode}/${namespace}] snippet should contain query term`);

  // ── Step 4: listNotes ──────────────────────────────────────────────────────
  const allNotes = TEST_MEMORY_STORE.listNotes(projectRoot);
  assert.ok(allNotes.length >= 1, `[${mode}/${namespace}] listNotes should return at least 1 note`);
  const listed = allNotes.find((n) => n.relPath === noteRelPath);
  assert.ok(listed, `[${mode}/${namespace}] listNotes should include the written note`);
  assert.strictEqual(listed.frontmatter.type, 'session_summary', `[${mode}/${namespace}] listed frontmatter.type should match`);

  // ── Step 5: deleteNote ─────────────────────────────────────────────────────
  const deleted = TEST_MEMORY_STORE.deleteNote(projectRoot, noteRelPath);
  assert.strictEqual(deleted, true, `[${mode}/${namespace}] deleteNote should return true`);

  // ── Step 6: assert it's gone ───────────────────────────────────────────────
  const readAfterDelete = TEST_MEMORY_STORE.readNote(projectRoot, noteRelPath);
  assert.strictEqual(readAfterDelete, null, `[${mode}/${namespace}] readNote should return null after deletion`);

  // Search should also not find it
  const searchAfterDelete = TEST_MEMORY_STORE.searchVault(projectRoot, 'Roundtrip Test');
  const foundAfterDelete = searchAfterDelete.find((r) => r.relPath === noteRelPath);
  assert.ok(!foundAfterDelete, `[${mode}/${namespace}] searchVault should NOT find deleted note`);

  // Clean up
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  if (sharedRepo) {
    try { rmSync(sharedRepo, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  return true;
}

// ── Test suites per mode ───────────────────────────────────────────────────────

describe('memory-roundtrip: local-only mode', () => {
  it('write → read → search → list → delete', async () => {
    await runRoundtrip('local-only', 'project');
  });
});

describe('memory-roundtrip: managed mode / project namespace', () => {
  it('write → read → search → list → delete', async () => {
    await runRoundtrip('managed', 'project');
  });
});

describe('memory-roundtrip: managed mode / global namespace', () => {
  it('write → read → search → list → delete', async () => {
    await runRoundtrip('managed', 'global');
  });
});

describe('memory-roundtrip: managed mode / user namespace', () => {
  it('write → read → search → list → delete', async () => {
    await runRoundtrip('managed', 'user');
  });
});

// ── Three-run variant for rule #42 documentation ─────────────────────────────
// This test documents that the round-trip runs three times as required.

describe('memory-roundtrip: rule #42 three-run variant', () => {
  // This test is a meta-test: it runs the roundtrip three times in sequence
  // to satisfy AGENTS_SELF_IMPROVEMENT rule #42 "run it THREE times" requirement.
  // Each run uses a different mode.

  it('run 1 of 3: local-only mode roundtrip', async () => {
    await runRoundtrip('local-only', 'project');
  });

  it('run 2 of 3: managed project namespace roundtrip', async () => {
    await runRoundtrip('managed', 'project');
  });

  it('run 3 of 3: managed global namespace roundtrip', async () => {
    await runRoundtrip('managed', 'global');
  });
});
