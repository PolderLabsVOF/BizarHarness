/**
 * tests/memory-cli.test.mjs
 *
 * Integration tests for the `bizar memory write` CLI subcommand.
 *
 * The CLI calls `process.exit(1)` on errors, so we cannot import runMemory
 * directly — we spawn the `bizar` binary as a subprocess in a temp dir,
 * assert on its exit code + stdout/stderr, and clean up after.
 *
 * v4.1.0 — added to close the gap that agents (which have bash but no
 * Memory MCP) have no programmatic way to write memory notes.
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

// Resolve path to the `bizar` CLI bin (this package's bin). We invoke it
// via `node <absolute path>` so the test does not depend on PATH.
const CLI_BIN = join(__dirname, '..', '..', 'cli', 'bin.mjs');

/**
 * Spawn `bizar memory write …` in the given cwd and capture exit code,
 * stdout, and stderr. Returns `{ code, stdout, stderr }`.
 */
function runBizarMemoryWrite(cwd, args) {
  try {
    const stdout = execFileSync('node', [CLI_BIN, 'memory', 'write', ...args], {
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

function runBizarMemory(cwd, subcommand, args) {
  try {
    const stdout = execFileSync('node', [CLI_BIN, 'memory', subcommand, ...args], {
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

function writeMemoryConfig(cwd, overrides = {}) {
  const projectId = overrides.projectId ?? 'test-proj';
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
  writeFileSync(join(cwd, '.bizar', 'memory.json'), JSON.stringify(config, null, 2));
}

describe('bizar memory write CLI', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `bizar-memcli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
    writeMemoryConfig(projectRoot);
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('prints help with --help flag', () => {
    const r = runBizarMemory(projectRoot, 'write', ['--help']);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('Usage:'), 'help text should include Usage:');
    assert.ok(r.stdout.includes('--type'), 'help text should document --type');
    assert.ok(r.stdout.includes('--body'), 'help text should document --body');
    assert.ok(r.stdout.includes('--body-file'), 'help text should document --body-file');
    assert.ok(r.stdout.includes('--json'), 'help text should document --json');
  });

  test('rejects call with no relpath (no positional, no body)', () => {
    const r = runBizarMemory(projectRoot, 'write', []);
    assert.strictEqual(r.code, 1, `expected exit 1, got ${r.code}; stderr=${r.stderr}`);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.ok(/relpath is required/i.test(out), `expected relpath error, got: ${out}`);
  });

  test('writes a note successfully with --body and verifies the file', () => {
    const relPath = 'decisions/0001-cli-test.md';
    const r = runBizarMemoryWrite(projectRoot, [
      relPath,
      '--type', 'architecture_decision',
      '--status', 'active',
      '--confidence', 'verified',
      '--tag', 'cli-test',
      '--tag', 'integration',
      '--title', 'CLI test note',
      '--body', '# CLI Test\n\nHello from the CLI integration test.',
    ]);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}; stdout=${r.stdout}`);
    assert.ok(r.stdout.includes('wrote'), 'should print success line');
    assert.ok(r.stdout.includes(relPath), 'should mention the relpath in output');
    assert.ok(r.stdout.includes('architecture_decision'), 'output should include the type');

    // Verify the note file actually exists in the vault
    const filePath = join(projectRoot, '.obsidian', relPath);
    assert.ok(existsSync(filePath), `note file should exist at ${filePath}`);
    const raw = readFileSync(filePath, 'utf8');
    assert.ok(raw.startsWith('---\n'), 'note should start with frontmatter');
    assert.ok(raw.includes('type: architecture_decision'), 'frontmatter should contain type');
    assert.ok(raw.includes('cli-test'), 'frontmatter should contain tag');
    assert.ok(raw.includes('# CLI Test'), 'body should be present');
  });

  test('emits valid JSON when --json flag is passed', () => {
    const r = runBizarMemoryWrite(projectRoot, [
      'json-test.md',
      '--type', 'command',
      '--body', 'echo json test',
      '--json',
    ]);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    const parsed = JSON.parse(r.stdout);
    assert.strictEqual(parsed.relPath, 'json-test.md');
    assert.strictEqual(parsed.frontmatter.type, 'command');
    assert.ok(parsed.raw.includes('echo json test'), 'raw should contain body');
  });

  test('rejects invalid --type with informative error', () => {
    const r = runBizarMemoryWrite(projectRoot, [
      'bad-type.md',
      '--type', 'bogus_type',
      '--body', 'should fail',
    ]);
    assert.strictEqual(r.code, 1, `expected exit 1, got ${r.code}`);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.ok(/invalid --type/i.test(out), `expected type error, got: ${out}`);
    assert.ok(out.includes('bogus_type'), 'error should mention the bad value');
    // And the file should NOT exist
    assert.ok(!existsSync(join(projectRoot, '.obsidian', 'bad-type.md')));
  });

  test('rejects relpath that does not end in .md', () => {
    const r = runBizarMemoryWrite(projectRoot, [
      'decisions/notes.txt',
      '--body', 'should fail',
    ]);
    assert.strictEqual(r.code, 1, `expected exit 1, got ${r.code}`);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.ok(/must end in \.md/i.test(out), `expected .md error, got: ${out}`);
  });

  test('rejects when --body and --body-file are both passed', () => {
    const bodyFile = join(projectRoot, 'temp-body.md');
    writeFileSync(bodyFile, 'body from file');
    const r = runBizarMemoryWrite(projectRoot, [
      'both.md',
      '--body', 'inline body',
      '--body-file', bodyFile,
    ]);
    assert.strictEqual(r.code, 1, `expected exit 1, got ${r.code}`);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.ok(/--body or --body-file, not both/i.test(out), `expected mutual-exclusion error, got: ${out}`);
  });

  test('reads body from --body-file when --body omitted', () => {
    const bodyFile = join(projectRoot, 'body-content.md');
    writeFileSync(bodyFile, '# From file\n\nThis came from a file.');
    const r = runBizarMemoryWrite(projectRoot, [
      'from-file.md',
      '--type', 'session_summary',
      '--body-file', bodyFile,
    ]);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    const filePath = join(projectRoot, '.obsidian', 'from-file.md');
    const raw = readFileSync(filePath, 'utf8');
    assert.ok(raw.includes('From file'), 'body from file should be present');
    assert.ok(raw.includes('session_summary'), 'frontmatter type should be set');
  });

  test('rejects HIGH-severity secret in body', () => {
    const r = runBizarMemoryWrite(projectRoot, [
      'leak.md',
      '--body', 'AKIAIOSFODNN7EXAMPLE is an AWS key',
    ]);
    assert.strictEqual(r.code, 1, `expected exit 1, got ${r.code}`);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.ok(/secret/i.test(out), `expected secret-blocked message, got: ${out}`);
    assert.ok(!existsSync(join(projectRoot, '.obsidian', 'leak.md')), 'leaked note must not be written');
  });

  test('warns but succeeds on MEDIUM-severity finding', () => {
    const r = runBizarMemoryWrite(projectRoot, [
      'med.md',
      '--body', 'api_key: abcdefghijklmnopqrstuvwxyz123456',
    ]);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    assert.ok(existsSync(join(projectRoot, '.obsidian', 'med.md')), 'medium-severity note should be written');
  });
});
