/**
 * tests/memory-conflicts.test.mjs
 *
 * Tests for the `bizar memory conflicts` CLI command — cmdConflicts at
 * cli/memory.mjs:1219-1254.
 *
 * Two conflict detection mechanisms:
 *   1. Frontmatter status=conflict
 *   2. Git conflict markers in body: <<<<<<< HEAD / ======= / >>>>>>> <branch>
 *
 * Gap closed: memory-system-map §8.1 CRITICAL gap #2 "Conflict detection &
 * resolution — cmdConflicts has no test".
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const CLI_BIN = join(dirname(__filename), '..', '..', 'cli', 'bin.mjs');
const TEST_MEMORY_STORE = await import('../src/server/memory-store.mjs').then((m) => m);

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Spawn `bizar memory conflicts` in the given cwd.
 * Returns { code, stdout, stderr }.
 */
function runBizarMemoryConflicts(cwd) {
  try {
    const stdout = execFileSync('node', [CLI_BIN, 'memory', 'conflicts'], {
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

describe('bizar memory conflicts CLI', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `mem-conflicts-${uid()}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });

    // Write a minimal memory.json config
    const config = {
      version: 1,
      backend: 'bizar-local',
      projectId: 'conflict-test',
      memoryRepo: {
        mode: 'local-only',
        path: join(projectRoot, '.obsidian'),
        remote: null,
        branch: 'main',
        namespace: null,
      },
      namespaces: {
        project: 'projects/conflict-test',
        global: 'global/bizar',
        user: 'users/tester',
      },
      lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(projectRoot, '.bizar', 'lightrag') },
      git: { autoPullOnSessionStart: false, autoCommitOnMemoryWrite: false, autoPushOnSessionEnd: false, commitAuthor: 'Bizar Memory <bizar-memory@local>', commitMessageTemplate: 'memory(conflict-test): {summary}' },
    };
    writeFileSync(join(projectRoot, '.bizar', 'memory.json'), JSON.stringify(config));
    // Init the vault
    mkdirSync(join(projectRoot, '.obsidian'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  /**
   * Write a note directly to disk (bypassing the API) so we can inject
   * arbitrary frontmatter and body content including conflict markers.
   *
   * @param {string} relPath  - relative path inside .obsidian/
   * @param {object} frontmatter  - key-value pairs
   * @param {string} body  - body content (actual newlines, not \n escapes)
   * @param {function|null} [postWrite]  - optional(filePath) callback to modify the file after writing
   */
  function writeNoteFile(relPath, frontmatter, body, postWrite = null) {
    const filePath = join(projectRoot, '.obsidian', relPath);
    mkdirSync(dirname(filePath), { recursive: true });
    // Write the note using the store (which handles YAML formatting correctly)
    TEST_MEMORY_STORE.writeNote(projectRoot, relPath, { frontmatter, body });
    if (postWrite) postWrite(filePath);
  }

  it('reports frontmatter status=conflict as a conflict', () => {
    writeNoteFile('conflict-fm.md',
      {
        memory_id: 'conflict_fm',
        type: 'session_summary',
        project_id: 'conflict-test',
        status: 'conflict', // ← the conflict marker
        confidence: 'verified',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        tags: [],
      },
      'This note has a frontmatter conflict status.',
    );

    const r = runBizarMemoryConflicts(projectRoot);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    const output = `${r.stdout}\n${r.stderr}`;
    assert.ok(
      output.includes('conflict-fm.md'),
      `output should mention conflict-fm.md; got: ${output}`,
    );
    assert.ok(
      /frontmatter.*conflict|conflict.*frontmatter/i.test(output),
      `output should mention frontmatter conflict; got: ${output}`,
    );
  });

  it('reports git conflict markers in body as a conflict', () => {
    writeNoteFile('conflict-git.md',
      {
        memory_id: 'conflict_git',
        type: 'session_summary',
        project_id: 'conflict-test',
        status: 'active',
        confidence: 'verified',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        tags: [],
      },
      'This note has git conflict markers.',
      (filePath) => {
        // Append git conflict markers to the file after writing
        appendFileSync(filePath, '\n<<<<<<< HEAD\nLocal change here.\n=======\nRemote change here.\n>>>>>>> remote-branch\n');
      },
    );

    const r = runBizarMemoryConflicts(projectRoot);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    const output = `${r.stdout}\n${r.stderr}`;
    assert.ok(
      output.includes('conflict-git.md'),
      `output should mention conflict-git.md; got: ${output}`,
    );
    assert.ok(
      /git conflict|conflict marker/i.test(output),
      `output should mention git conflict; got: ${output}`,
    );
  });

  it('reports both conflict types simultaneously', () => {
    writeNoteFile('both-conflicts.md',
      {
        memory_id: 'both_conflicts',
        type: 'session_summary',
        project_id: 'conflict-test',
        status: 'conflict',
        confidence: 'verified',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        tags: [],
      },
      'Body with conflict markers.',
      (filePath) => {
        appendFileSync(filePath, '\n<<<<<<< HEAD\nLocal.\n=======\nRemote.\n>>>>>>> branch\n');
      },
    );

    const r = runBizarMemoryConflicts(projectRoot);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    const output = `${r.stdout}\n${r.stderr}`;
    assert.ok(
      output.includes('both-conflicts.md'),
      `output should mention both-conflicts.md; got: ${output}`,
    );
    assert.ok(
      /frontmatter.*conflict|conflict.*frontmatter/i.test(output),
      `output should report frontmatter conflict; got: ${output}`,
    );
  });

  it('outputs "no conflicts found" when vault is clean', () => {
    writeNoteFile('clean-note.md',
      {
        memory_id: 'clean_note',
        type: 'session_summary',
        project_id: 'conflict-test',
        status: 'active',
        confidence: 'verified',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        tags: [],
      },
      'This is a perfectly normal, non-conflicted note.',
    );

    const r = runBizarMemoryConflicts(projectRoot);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    const output = `${r.stdout}\n${r.stderr}`;
    assert.ok(
      /no conflicts? found/i.test(output),
      `output should say "no conflicts found"; got: ${output}`,
    );
  });

  it('handles empty vault gracefully', () => {
    const r = runBizarMemoryConflicts(projectRoot);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    const output = `${r.stdout}\n${r.stderr}`;
    assert.ok(
      /no conflicts? found/i.test(output),
      `empty vault should say "no conflicts found"; got: ${output}`,
    );
  });
});
