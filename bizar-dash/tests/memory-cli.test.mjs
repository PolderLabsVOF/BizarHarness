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

  // ─── v4.2.2 — custom frontmatter flags ─────────────────────────────────
  test('--memory-id flag sets a custom memory_id in frontmatter', () => {
    const relPath = 'flags/custom-id.md';
    const r = runBizarMemoryWrite(projectRoot, [
      relPath,
      '--type', 'coding_convention',
      '--memory-id', 'mem_test_custom_id',
      '--body', 'custom id test',
    ]);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}; stdout=${r.stdout}`);
    const filePath = join(projectRoot, '.obsidian', relPath);
    assert.ok(existsSync(filePath), `note file should exist at ${filePath}`);
    const raw = readFileSync(filePath, 'utf8');
    assert.ok(/memory_id:\s*mem_test_custom_id\b/.test(raw),
      `frontmatter should contain memory_id: mem_test_custom_id; got:\n${raw}`);
  });

  test('--scope and --source-agent flags pass through to frontmatter', () => {
    const relPath = 'flags/scope-and-agent.md';
    const r = runBizarMemoryWrite(projectRoot, [
      relPath,
      '--type', 'coding_convention',
      '--scope', 'project',
      '--source-agent', 'mimir',
      '--body', 'scope/agent test',
    ]);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}; stdout=${r.stdout}`);
    const filePath = join(projectRoot, '.obsidian', relPath);
    assert.ok(existsSync(filePath), `note file should exist at ${filePath}`);
    const raw = readFileSync(filePath, 'utf8');
    assert.ok(/scope:\s*project\b/.test(raw),
      `frontmatter should contain scope: project; got:\n${raw}`);
    assert.ok(/source_agent:\s*mimir\b/.test(raw),
      `frontmatter should contain source_agent: mimir; got:\n${raw}`);
  });

  test('invalid --memory-id format is rejected with kebab/snake-case error', () => {
    const r = runBizarMemoryWrite(projectRoot, [
      'flags/bad-id.md',
      '--type', 'coding_convention',
      '--memory-id', 'has spaces and !@#',
      '--body', 'should fail',
    ]);
    assert.strictEqual(r.code, 1, `expected exit 1, got ${r.code}; stderr=${r.stderr}`);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.ok(/invalid --memory-id/i.test(out),
      `expected invalid --memory-id error, got: ${out}`);
    assert.ok(/kebab|snake/i.test(out),
      `expected error to mention kebab/snake-case, got: ${out}`);
    // File should NOT exist
    assert.ok(!existsSync(join(projectRoot, '.obsidian', 'flags', 'bad-id.md')),
      'note file must not be written when --memory-id is invalid');
  });
});

// ─── bizar memory setup ──────────────────────────────────────────────────────
// v4.2.0 — the `setup` subcommand handles first-time bootstrap and remote
// reconfiguration. These tests spawn `bizar memory setup` in temp dirs and
// inspect the resulting `.bizar/memory.json`.

describe('bizar memory setup CLI', () => {
  // Each test gets a fresh temp dir.
  let setupRoot;
  beforeEach(() => {
    setupRoot = join(tmpdir(), `bizar-memsetup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(setupRoot, { recursive: true });
    mkdirSync(join(setupRoot, '.bizar'), { recursive: true });
    // NOTE: do NOT pre-create memory.json — these tests exercise the
    // bootstrap path. The few "existing config" tests write their own.
  });

  afterEach(() => {
    try { rmSync(setupRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  /**
   * Run `bizar memory setup` in `cwd` with the given args.
   * @returns {{ code: number, stdout: string, stderr: string }}
   */
  function runSetup(cwd, args) {
    try {
      const stdout = execFileSync('node', [CLI_BIN, 'memory', 'setup', ...args], {
        cwd,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 30_000,
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

  test('prints usage with --help', () => {
    const r = runSetup(setupRoot, ['--help']);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}`);
    assert.ok(r.stdout.includes('Usage:'), 'help should include Usage:');
    assert.ok(r.stdout.includes('--remote'), 'help should document --remote');
    assert.ok(r.stdout.includes('--mode'), 'help should document --mode');
    assert.ok(r.stdout.includes('--non-interactive'), 'help should document --non-interactive');
    assert.ok(r.stdout.includes('--local-only'), 'help should document --local-only');
    assert.ok(/ssh:\/\/|https:\/\/|git@host:path/.test(r.stdout),
      'help should mention the supported URL forms');
  });

  test('bootstrap in local-only mode creates .bizar/memory.json', () => {
    const repo = `test-local-${Date.now()}`;
    const r = runSetup(setupRoot, [
      '--non-interactive',
      '--mode', 'local-only',
      '--repo-name', repo,
    ]);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}; stdout=${r.stdout}`);
    const cfgPath = join(setupRoot, '.bizar', 'memory.json');
    assert.ok(existsSync(cfgPath), `.bizar/memory.json should exist at ${cfgPath}`);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    assert.strictEqual(cfg.memoryRepo.mode, 'local-only', 'mode should be local-only');
    assert.strictEqual(cfg.memoryRepo.remote, null, 'local-only should have null remote');
    // No top-level gitRemote in local-only mode
    assert.ok(cfg.gitRemote === undefined || cfg.gitRemote === null || cfg.gitRemote === '',
      'local-only mode should not set gitRemote');
  });

  test('bootstrap with managed mode writes memoryRepo.remote AND gitRemote', () => {
    const repo = `test-managed-${Date.now()}`;
    const remote = `https://github.com/example-org/${repo}.git`;
    const r = runSetup(setupRoot, [
      '--non-interactive',
      '--mode', 'managed',
      '--repo-name', repo,
      '--remote', remote,
    ]);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr=${r.stderr}; stdout=${r.stdout}`);
    const cfgPath = join(setupRoot, '.bizar', 'memory.json');
    assert.ok(existsSync(cfgPath), '.bizar/memory.json must exist');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    assert.strictEqual(cfg.memoryRepo.mode, 'managed', 'mode should be managed');
    assert.strictEqual(cfg.memoryRepo.remote, remote,
      `memoryRepo.remote should match the requested URL — got ${cfg.memoryRepo.remote}`);
    assert.strictEqual(cfg.gitRemote, remote,
      `top-level gitRemote should also be set so cmdPush works — got ${cfg.gitRemote}`);
    // Vault path lives under ~/.bizar_memory/<repo-name> (v5.x — was ~/.local/share/bizar/memory)
    assert.ok(cfg.memoryRepo.path.endsWith(repo), `vault path should end with ${repo}`);
  });

  test('rejects an invalid remote URL with exit code 1', () => {
    const r = runSetup(setupRoot, [
      '--non-interactive',
      '--mode', 'managed',
      '--repo-name', `bad-${Date.now()}`,
      '--remote', '/just/a/path/no/scheme',
    ]);
    assert.strictEqual(r.code, 1, `expected exit 1, got ${r.code}; stderr=${r.stderr}`);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.ok(/invalid.*remote|invalid --remote URL/i.test(out),
      `expected URL validation error, got: ${out}`);
    // No config should be written
    const cfgPath = join(setupRoot, '.bizar', 'memory.json');
    assert.ok(!existsSync(cfgPath),
      'config should not be written when the remote URL is invalid');
  });

  test('accepts the three supported URL forms', () => {
    const forms = [
      'git@github.com:org/repo.git',
      'ssh://git@github.com/org/repo.git',
      'https://github.com/org/repo.git',
    ];
    for (const u of forms) {
      const r = runSetup(setupRoot, [
        '--non-interactive',
        '--mode', 'managed',
        '--repo-name', `forms-${Date.now()}`,
        '--remote', u,
      ]);
      assert.strictEqual(r.code, 0, `URL form ${u} should succeed, got ${r.code}; stderr=${r.stderr}`);
    }
  });

  test('rejects file:// and plain paths as URLs', () => {
    // Empty string is filtered out by the CLI's optVal helper (treated as
    // "no --remote passed"), so cmdSetup exits with a different — but still
    // fatal — message. The pure unit tests above cover the empty-string
    // case against validateRemoteUrl directly.
    const bad = [
      'file:///tmp/repo',
      '/home/user/repos/my-vault',
    ];
    for (const u of bad) {
      const r = runSetup(setupRoot, [
        '--non-interactive',
        '--mode', 'managed',
        '--repo-name', `bad-${Date.now()}`,
        '--remote', u,
      ]);
      assert.strictEqual(r.code, 1,
        `URL "${u}" should be rejected, got exit ${r.code}; stderr=${r.stderr}`);
      const out = `${r.stdout}\n${r.stderr}`;
      assert.ok(/invalid.*remote|invalid --remote URL/i.test(out),
        `expected URL validation error for "${u}", got: ${out}`);
    }
  });

  test('--remote with empty value exits non-zero in non-interactive mode', () => {
    // optVal treats a bare `--remote ""` as missing (it skips values that
    // start with `-` and tolerates the next-token being empty), but a
    // shell can also pass `--remote ""` through argv. Either way, the CLI
    // must exit non-zero when no usable remote is available.
    const r = runSetup(setupRoot, [
      '--non-interactive',
      '--mode', 'managed',
      '--repo-name', `bad-${Date.now()}`,
      '--remote', '',
    ]);
    assert.strictEqual(r.code, 1,
      `empty --remote should exit 1, got ${r.code}; stderr=${r.stderr}`);
    const out = `${r.stdout}\n${r.stderr}`;
    // Could be either the URL-validation message OR the "required" message.
    assert.ok(/--remote|remote URL/i.test(out),
      `expected a remote-related error, got: ${out}`);
  });

  test('running setup twice with the same --remote is idempotent', () => {
    const repo = `idem-${Date.now()}`;
    const remote = `https://github.com/example-org/${repo}.git`;
    const args = [
      '--non-interactive',
      '--mode', 'managed',
      '--repo-name', repo,
      '--remote', remote,
    ];

    // First run: bootstrap
    const r1 = runSetup(setupRoot, args);
    assert.strictEqual(r1.code, 0, `first run should succeed, got ${r1.code}; stderr=${r1.stderr}`);
    const cfgPath = join(setupRoot, '.bizar', 'memory.json');
    const cfg1 = JSON.parse(readFileSync(cfgPath, 'utf8'));
    assert.strictEqual(cfg1.memoryRepo.remote, remote, 'first run should set the remote');

    // Second run: should print "no changes" and exit 0
    const r2 = runSetup(setupRoot, args);
    assert.strictEqual(r2.code, 0, `second run should succeed, got ${r2.code}; stderr=${r2.stderr}`);
    assert.ok(/no changes|already configured/i.test(`${r2.stdout}\n${r2.stderr}`),
      'second run with same flags should report "no changes"');

    // Config is still correct
    const cfg2 = JSON.parse(readFileSync(cfgPath, 'utf8'));
    assert.strictEqual(cfg2.memoryRepo.remote, remote, 'remote should still match');
    assert.strictEqual(cfg2.gitRemote, remote, 'top-level gitRemote should still match');
  });

  test('reconfiguring an existing vault with a new remote updates both fields', () => {
    // Bootstrap with one remote
    const oldRemote = `https://github.com/example-org/setup-${Date.now()}.git`;
    const r1 = runSetup(setupRoot, [
      '--non-interactive',
      '--mode', 'managed',
      '--repo-name', `reconfig-${Date.now()}`,
      '--remote', oldRemote,
    ]);
    assert.strictEqual(r1.code, 0, `bootstrap should succeed, got ${r1.code}; stderr=${r1.stderr}`);

    // Now reconfigure with a new remote
    const newRemote = `git@github.com:example-org/setup-${Date.now()}-new.git`;
    const r2 = runSetup(setupRoot, [
      '--non-interactive',
      '--mode', 'managed',
      '--remote', newRemote,
    ]);
    assert.strictEqual(r2.code, 0, `reconfigure should succeed, got ${r2.code}; stderr=${r2.stderr}; stdout=${r2.stdout}`);
    const cfgPath = join(setupRoot, '.bizar', 'memory.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    assert.strictEqual(cfg.memoryRepo.remote, newRemote,
      `memoryRepo.remote should be updated to ${newRemote}, got ${cfg.memoryRepo.remote}`);
    assert.strictEqual(cfg.gitRemote, newRemote,
      `gitRemote should be updated to ${newRemote}, got ${cfg.gitRemote}`);
  });
});

// ─── validateRemoteUrl (pure unit tests via the CLI's exposed export) ───────
// We spawn a tiny node script that imports the helper to avoid pulling in the
// chalk-bound runMemory entry point.

describe('validateRemoteUrl', () => {
  // Run the helper through `node --input-type=module -e <code>` so we test
  // the exact exported implementation, not a copy.
  function callValidate(url) {
    const code = `
      import { validateRemoteUrl } from ${JSON.stringify(join(__dirname, '..', '..', 'cli', 'memory.mjs'))};
      const r = validateRemoteUrl(${JSON.stringify(url)});
      process.stdout.write(JSON.stringify(r));
    `;
    try {
      const stdout = execFileSync('node', ['--input-type=module', '-e', code], {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 15_000,
      });
      return { ok: true, result: JSON.parse(stdout) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  test('accepts git@host:path (scp-style SSH)', () => {
    const r = callValidate('git@github.com:user/repo.git');
    assert.deepStrictEqual(r, { ok: true, result: { valid: true, kind: 'ssh' } });
  });

  test('accepts ssh://git@host/path (SSH URL form)', () => {
    const r = callValidate('ssh://git@github.com/user/repo.git');
    assert.deepStrictEqual(r, { ok: true, result: { valid: true, kind: 'ssh-url' } });
  });

  test('accepts ssh:// without explicit user', () => {
    const r = callValidate('ssh://github.com/user/repo.git');
    assert.deepStrictEqual(r, { ok: true, result: { valid: true, kind: 'ssh-url' } });
  });

  test('accepts https://host/path', () => {
    const r = callValidate('https://github.com/user/repo.git');
    assert.deepStrictEqual(r, { ok: true, result: { valid: true, kind: 'https' } });
  });

  test('rejects file:// URLs', () => {
    const r = callValidate('file:///tmp/repo');
    assert.ok(r.ok && r.result.valid === false, `expected invalid, got ${JSON.stringify(r)}`);
    assert.ok(typeof r.result.error === 'string' && r.result.error.length > 0);
  });

  test('rejects plain filesystem paths', () => {
    const r = callValidate('/home/user/repos/my-vault');
    assert.ok(r.ok && r.result.valid === false);
  });

  test('rejects empty string', () => {
    const r = callValidate('');
    assert.ok(r.ok && r.result.valid === false, 'empty string should be invalid');
  });

  test('trims whitespace before validating', () => {
    const r = callValidate('  git@github.com:user/repo.git  ');
    assert.deepStrictEqual(r, { ok: true, result: { valid: true, kind: 'ssh' } });
  });
});
