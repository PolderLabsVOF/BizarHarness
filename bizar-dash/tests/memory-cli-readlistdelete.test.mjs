/**
 * tests/memory-cli-readlistdelete.test.mjs
 *
 * Integration tests for the `bizar memory read`, `bizar memory list`, and
 * `bizar memory delete` CLI subcommands.
 *
 * The CLI calls `process.exit(1)` on errors, so we spawn the `bizar` binary
 * as a subprocess in a temp dir, assert on exit code + stdout/stderr, and
 * clean up after.
 *
 * These tests are designed to pass once Tyr lands the cmdRead / cmdList /
 * cmdDelete implementations. They validate the expected CLI interface
 * (exit codes, output shapes, and file-system side-effects) rather than
 * the internal store API directly.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve path to the `bizar` CLI bin — invoke via `node <absolute path>`
// so the test does not depend on PATH.
const CLI_BIN = join(__dirname, '..', '..', 'cli', 'bin.mjs');

/**
 * Spawn `bizar memory <subcommand> …` in the given cwd and capture exit
 * code, stdout, and stderr. Returns `{ code, stdout, stderr }`.
 */
function runBizarMemory(subcmd, args, cwd) {
  try {
    const stdout = execFileSync('node', [CLI_BIN, 'memory', subcmd, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 15_000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : (err.message ?? ''),
    };
  }
}

/**
 * Write a minimal `.bizar/memory.json` for local-only operation.
 */
function writeMemoryConfig(cwd, overrides = {}) {
  const projectId = overrides.projectId ?? `rlt-${Date.now()}`;
  const config = {
    version: 1,
    backend: 'bizar-local',
    projectId,
    memoryRepo: {
      mode: 'local-only',
      path: join(cwd, '.obsidian'),
      remote: null,
      branch: 'main',
      namespace: null,
    },
    namespaces: {
      project: `projects/${projectId}`,
      global: 'global/bizar',
      user: 'users/tester',
    },
    lightrag: {
      enabled: false,
      host: '127.0.0.1',
      port: 9621,
      workingDir: join(cwd, '.bizar', 'lightrag'),
    },
    git: {
      autoPullOnSessionStart: false,
      autoCommitOnMemoryWrite: false,
      autoPushOnSessionEnd: false,
      commitAuthor: 'Bizar Memory <bizar-memory@local>',
      commitMessageTemplate: `memory(${projectId}): {summary}`,
    },
  };
  mkdirSync(join(cwd, '.bizar'), { recursive: true });
  writeFileSync(join(cwd, '.bizar', 'memory.json'), JSON.stringify(config, null, 2));
}

// ─── bizar memory read ────────────────────────────────────────────────────────

describe('bizar memory read', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = join(
      tmpdir(),
      `bizar-memread-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
    mkdirSync(join(projectRoot, '.obsidian'), { recursive: true });
    writeMemoryConfig(projectRoot);
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('happy path — prints frontmatter + body to stdout and exits 0', () => {
    // First write a note via the CLI (validates the full chain)
    const relPath = 'decisions/0001-read-test.md';
    const writeRes = runBizarMemory(
      'write',
      [
        relPath,
        '--type', 'architecture_decision',
        '--status', 'active',
        '--confidence', 'verified',
        '--title', 'Read test note',
        '--body', '# Read test note\n\nBody content here.',
      ],
      projectRoot,
    );
    assert.strictEqual(
      writeRes.code,
      0,
      `write failed: ${writeRes.stderr}`,
    );

    // Now read it back
    const r = runBizarMemory('read', [relPath], projectRoot);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('Body content here.'), 'body should appear in stdout');
    assert.ok(
      r.stdout.includes('Read test note') || r.stdout.includes('architecture_decision'),
      'stdout should include title or type from frontmatter',
    );
  });

  test('not found — exits 1 and reports the missing path', () => {
    const r = runBizarMemory('read', ['does-not-exist.md'], projectRoot);
    assert.strictEqual(r.code, 1, `expected exit 1, got ${r.code}`);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.ok(
      /not found|does.not.exist|no such file/i.test(out),
      `expected a "not found" message, got: ${out}`,
    );
  });
});

// ─── bizar memory list ─────────────────────────────────────────────────────────

describe('bizar memory list', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = join(
      tmpdir(),
      `bizar-memlist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
    mkdirSync(join(projectRoot, '.obsidian'), { recursive: true });
    writeMemoryConfig(projectRoot);
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('empty vault — exits 0 and prints nothing (or a zero count)', () => {
    const r = runBizarMemory('list', [], projectRoot);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    // stdout may be empty or show "0 notes" — either is acceptable
    const out = r.stdout.trim();
    // If non-empty it should not contain any .md paths
    if (out.length > 0) {
      assert.ok(
        !/\.md/.test(out),
        `empty vault should not list .md files; got: ${out}`,
      );
    }
  });

  test('with notes — lists all top-level notes', () => {
    const notes = [
      'decisions/0001-list-test-a.md',
      'decisions/0001-list-test-b.md',
      'decisions/0001-list-test-c.md',
    ];
    for (const relPath of notes) {
      const r = runBizarMemory(
        'write',
        [relPath, '--type', 'architecture_decision', '--body', `# ${relPath}`],
        projectRoot,
      );
      assert.strictEqual(r.code, 0, `write failed for ${relPath}: ${r.stderr}`);
    }

    const listRes = runBizarMemory('list', [], projectRoot);
    assert.strictEqual(listRes.code, 0, `list failed: ${listRes.stderr}`);
    for (const relPath of notes) {
      assert.ok(
        listRes.stdout.includes(relPath),
        `list output should contain ${relPath}; got: ${listRes.stdout}`,
      );
    }
  });

  test('with subdir filter — only lists notes under the specified directory', () => {
    // Write notes in two different directories
    const decisionsNotes = [
      'decisions/0001-subdir-test.md',
      'decisions/0002-subdir-test.md',
    ];
    const tasksNotes = ['tasks/0001-subdir-test.md'];

    for (const relPath of [...decisionsNotes, ...tasksNotes]) {
      const r = runBizarMemory(
        'write',
        [relPath, '--type', relPath.startsWith('decisions') ? 'architecture_decision' : 'session_summary', '--body', `# ${relPath}`],
        projectRoot,
      );
      assert.strictEqual(r.code, 0, `write failed for ${relPath}: ${r.stderr}`);
    }

    // List only decisions/
    const listRes = runBizarMemory('list', ['decisions/'], projectRoot);
    assert.strictEqual(listRes.code, 0, `list failed: ${listRes.stderr}`);
    for (const relPath of decisionsNotes) {
      assert.ok(
        listRes.stdout.includes(relPath),
        `list decisions/ output should contain ${relPath}; got: ${listRes.stdout}`,
      );
    }
    for (const relPath of tasksNotes) {
      assert.ok(
        !listRes.stdout.includes(relPath),
        `list decisions/ output should NOT contain ${relPath}; got: ${listRes.stdout}`,
      );
    }
  });
});

// ─── bizar memory delete ───────────────────────────────────────────────────────

describe('bizar memory delete', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = join(
      tmpdir(),
      `bizar-memdel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
    mkdirSync(join(projectRoot, '.obsidian'), { recursive: true });
    writeMemoryConfig(projectRoot);
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('happy path — deletes the note and exits 0', () => {
    const relPath = 'decisions/0001-delete-test.md';
    // First write
    const writeRes = runBizarMemory(
      'write',
      [relPath, '--type', 'architecture_decision', '--body', '# To be deleted'],
      projectRoot,
    );
    assert.strictEqual(writeRes.code, 0, `write failed: ${writeRes.stderr}`);

    const filePath = join(projectRoot, '.obsidian', relPath);
    assert.ok(
      existsSync(filePath),
      `file should exist before delete: ${filePath}`,
    );

    // Delete
    const r = runBizarMemory('delete', [relPath], projectRoot);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);

    // File should be gone
    assert.ok(
      !existsSync(filePath),
      `file should NOT exist after delete: ${filePath}`,
    );
  });

  test('not found — exits 1 and reports the missing path', () => {
    const r = runBizarMemory('delete', ['nonexistent-note.md'], projectRoot);
    assert.strictEqual(r.code, 1, `expected exit 1, got ${r.code}`);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.ok(
      /not found|no such file|does.not.exist/i.test(out),
      `expected a "not found" message, got: ${out}`,
    );
  });

  test('nested path — deletes a note in a subdirectory', () => {
    const relPath = 'decisions/nested/deeply/note.md';
    // Write
    const writeRes = runBizarMemory(
      'write',
      [relPath, '--type', 'architecture_decision', '--body', '# Nested note'],
      projectRoot,
    );
    assert.strictEqual(writeRes.code, 0, `write failed: ${writeRes.stderr}`);

    const filePath = join(projectRoot, '.obsidian', relPath);
    assert.ok(existsSync(filePath), `file should exist before delete: ${filePath}`);

    // Delete
    const r = runBizarMemory('delete', [relPath], projectRoot);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);

    // File should be gone
    assert.ok(
      !existsSync(filePath),
      `file should NOT exist after delete: ${filePath}`,
    );
  });
});

// ─── end-to-end: write → read → list → delete → list → read ──────────────────

describe('bizar memory E2E — write → read → list → delete → list → read', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = join(
      tmpdir(),
      `bizar-meme2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
    mkdirSync(join(projectRoot, '.obsidian'), { recursive: true });
    writeMemoryConfig(projectRoot);
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('full round-trip through the CLI', () => {
    const relPath = 'decisions/0001-e2e.md';
    const bodyText = `# E2E test note

This body should survive the full round-trip through the CLI.`;

    // Step 1: write
    const writeRes = runBizarMemory('write', [
      relPath,
      '--type', 'architecture_decision',
      '--status', 'active',
      '--confidence', 'verified',
      '--title', 'E2E test note',
      '--body', bodyText,
    ], projectRoot);
    assert.strictEqual(writeRes.code, 0, `write failed: ${writeRes.stderr}`);

    // Step 2: read — should succeed and contain the body
    const readRes = runBizarMemory('read', [relPath], projectRoot);
    assert.strictEqual(readRes.code, 0, `read failed: ${readRes.stderr}`);
    assert.ok(
      readRes.stdout.includes('round-trip'),
      `read output should contain body text; got: ${readRes.stdout}`,
    );

    // Step 3: list — should show the note
    const listRes = runBizarMemory('list', [], projectRoot);
    assert.strictEqual(listRes.code, 0, `list failed: ${listRes.stderr}`);
    assert.ok(
      listRes.stdout.includes(relPath),
      `list should contain ${relPath}; got: ${listRes.stdout}`,
    );

    // Step 4: delete
    const deleteRes = runBizarMemory('delete', [relPath], projectRoot);
    assert.strictEqual(deleteRes.code, 0, `delete failed: ${deleteRes.stderr}`);

    // Step 5: list again — should NOT show the note
    const listAfterRes = runBizarMemory('list', [], projectRoot);
    assert.strictEqual(listAfterRes.code, 0, `list after delete failed: ${listAfterRes.stderr}`);
    assert.ok(
      !listAfterRes.stdout.includes(relPath),
      `list after delete should NOT contain ${relPath}; got: ${listAfterRes.stdout}`,
    );

    // Step 6: read — should fail with not-found
    const readAfterRes = runBizarMemory('read', [relPath], projectRoot);
    assert.strictEqual(readAfterRes.code, 1, `read after delete should exit 1, got ${readAfterRes.code}`);
    const out = `${readAfterRes.stdout}\n${readAfterRes.stderr}`;
    assert.ok(
      /not found|no such file|does.not.exist/i.test(out),
      `read after delete should report not found; got: ${out}`,
    );
  });
});
