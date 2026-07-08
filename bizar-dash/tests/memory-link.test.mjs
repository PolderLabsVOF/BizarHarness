/**
 * tests/memory-link.test.mjs
 *
 * Unit tests for the `bizar memory link` command — specifically the
 * v6.0.0 init-less clone behavior. Three cases covered:
 *
 *   1. Default vault does not exist → clone fresh into ~/.bizar_memory.
 *   2. Default vault exists and is empty → clone fresh.
 *   3. Default vault exists with content → refuse unless --force; if
 *      --force, back up and replace.
 *
 * Plus: local-path link (no clone, just recursive copy).
 *
 * Run: bun test bizar-dash/tests/memory-link.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// We invoke `runMemory(subcommand, args, opts)` directly. The CLI
// dispatcher (`cli/commands/memory.mjs`) is just a thin wrapper that
// parses argv → runMemory.
const MEMORY_CLI = join(import.meta.dirname, '..', '..', 'cli', 'memory.mjs');

async function runLink(args, { cwd, vault, env = {} } = {}) {
  process.env = { ...process.env, ...env };
  if (vault) process.env.BIZAR_MEMORY_VAULT = vault;
  const prevCwd = process.cwd();
  if (cwd) process.chdir(cwd);
  const mod = await import(MEMORY_CLI);
  // Capture exit code via process.exitCode
  let exitCode = 0;
  const origExit = process.exit;
  process.exit = (code) => {
    exitCode = code || 0;
    // throw to break out of runMemory
    throw new Error(`__exit__:${exitCode}`);
  };
  try {
    await mod.runMemory('link', args, { wantJson: false });
  } catch (err) {
    if (!String(err.message).startsWith('__exit__:')) {
      throw err;
    }
    exitCode = parseInt(err.message.split(':')[1], 10);
  } finally {
    process.exit = origExit;
    if (cwd) process.chdir(prevCwd);
  }
  return { exitCode };
}

function setupTmp(name) {
  return mkdtempSync(join(tmpdir(), `bizar-link-${name}-`));
}

test('link refuses when no target given', async () => {
  const projectRoot = setupTmp('no-target');
  const r = await runLink([], { cwd: projectRoot });
  assert.equal(r.exitCode, 1);
});

test('link rejects non-existent local path', async () => {
  const projectRoot = setupTmp('no-path');
  const vaultPath = join(projectRoot, 'nope-not-here');
  const r = await runLink([vaultPath], { cwd: projectRoot, vault: vaultPath });
  assert.equal(r.exitCode, 1);
});

test('link from local path copies files into target vault', async () => {
  const projectRoot = setupTmp('local-copy');
  const vaultDir = setupTmp('vault-dest-local');
  const sourceDir = setupTmp('source-local');
  writeFileSync(join(sourceDir, 'a.md'), '# A');
  writeFileSync(join(sourceDir, 'b.md'), '# B');
  mkdirSync(join(sourceDir, 'sub'));
  writeFileSync(join(sourceDir, 'sub', 'c.md'), '# C');

  const r = await runLink(['--target', vaultDir, sourceDir], {
    cwd: projectRoot,
    vault: vaultDir,
  });
  assert.equal(r.exitCode, 0);
  assert.ok(existsSync(join(vaultDir, 'a.md')), 'a.md');
  assert.ok(existsSync(join(vaultDir, 'b.md')), 'b.md');
  assert.ok(existsSync(join(vaultDir, 'sub', 'c.md')), 'sub/c.md');
});

test('link refuses if vault already exists with content and no --force', async () => {
  const projectRoot = setupTmp('existing');
  const vaultDir = setupTmp('vault-dest');
  writeFileSync(join(vaultDir, 'README.md'), 'preexisting');
  const sourceDir = setupTmp('source-existing');
  writeFileSync(join(sourceDir, 'x.md'), '# x');

  const r = await runLink(['--target', vaultDir, sourceDir], {
    cwd: projectRoot,
    vault: vaultDir,
  });
  assert.equal(r.exitCode, 1, 'should refuse without --force');
});

test('link with --force backs up existing vault before replacing', async () => {
  const projectRoot = setupTmp('force');
  const vaultDir = setupTmp('vault-dest-force');
  writeFileSync(join(vaultDir, 'README.md'), 'preexisting content');
  const sourceDir = setupTmp('source-force');
  writeFileSync(join(sourceDir, 'note.md'), '# new note');

  const r = await runLink(
    ['--force', '--target', vaultDir, sourceDir],
    { cwd: projectRoot, vault: vaultDir },
  );
  assert.equal(r.exitCode, 0, `link should succeed; exitCode=${r.exitCode}`);
  // Backup dir should exist in the parent.
  const parentEntries = readdirSync(dirname(vaultDir));
  const backup = parentEntries.find((e) => e.startsWith(`${vaultDir.split('/').pop()}.bak.`));
  assert.ok(backup, `backup dir should be created; entries=${parentEntries.join(',')}`);
  // Destination should contain the new note.
  assert.ok(existsSync(join(vaultDir, 'note.md')), 'note.md should be in dest');
});

test('link from URL clones into empty target vault', { skip: !process.env.BIZAR_TEST_NETWORK }, async () => {
  const projectRoot = setupTmp('url');
  const vaultDir = setupTmp('vault-url');
  const r = await runLink(
    ['--target', vaultDir, 'https://github.com/octocat/Hello-World.git'],
    { cwd: projectRoot, vault: vaultDir },
  );
  assert.equal(r.exitCode, 0, `clone should succeed; exitCode=${r.exitCode}`);
  assert.ok(existsSync(join(vaultDir, 'README')));
});