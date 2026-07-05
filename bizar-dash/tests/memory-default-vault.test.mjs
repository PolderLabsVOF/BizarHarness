/**
 * tests/memory-default-vault.test.mjs
 *
 * Tests for the default vault location, currentVault(), and ensureVaultExists().
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, readFileSync } from 'node:fs';

const TEST_STORE = await import('../src/server/memory-store.mjs').then((m) => m);

describe('DEFAULT_MEMORY_VAULT', () => {
  it('is ~/.local/share/bizar/memory', () => {
    const expected = join(homedir(), '.local', 'share', 'bizar', 'memory');
    assert.strictEqual(TEST_STORE.DEFAULT_MEMORY_VAULT, expected);
  });
});

describe('DEFAULT_GIT_REMOTE', () => {
  it('is null by default', () => {
    assert.strictEqual(TEST_STORE.DEFAULT_GIT_REMOTE, null);
  });
});

describe('currentVault', () => {
  it('returns DEFAULT_MEMORY_VAULT when no env override', () => {
    assert.strictEqual(TEST_STORE.currentVault(), TEST_STORE.DEFAULT_MEMORY_VAULT);
  });

  it('returns BIZAR_MEMORY_VAULT env var when set', () => {
    const orig = process.env.BIZAR_MEMORY_VAULT;
    process.env.BIZAR_MEMORY_VAULT = '/tmp/test-current-vault';
    try {
      assert.strictEqual(TEST_STORE.currentVault(), '/tmp/test-current-vault');
    } finally {
      if (orig === undefined) delete process.env.BIZAR_MEMORY_VAULT;
      else process.env.BIZAR_MEMORY_VAULT = orig;
    }
  });
});

describe('ensureVaultExists', () => {
  // Use a real temp path so we actually test the function
  let testVaultRoot;

  beforeEach(() => {
    testVaultRoot = join(
      tmpdir(),
      `bizar-test-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    // Set env var before importing / calling
    process.env.BIZAR_MEMORY_VAULT = testVaultRoot;
  });

  afterEach(() => {
    delete process.env.BIZAR_MEMORY_VAULT;
    try { rmSync(testVaultRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('creates the vault directory if missing', () => {
    assert.strictEqual(existsSync(testVaultRoot), false);
    const result = TEST_STORE.ensureVaultExists();
    assert.strictEqual(existsSync(testVaultRoot), true);
    assert.strictEqual(result, testVaultRoot);
  });

  it('is idempotent — calling twice does not throw', () => {
    TEST_STORE.ensureVaultExists();
    const result = TEST_STORE.ensureVaultExists();
    assert.strictEqual(result, testVaultRoot);
    assert.strictEqual(existsSync(testVaultRoot), true);
  });

  it('inits git repo on first run when .git is absent', () => {
    assert.strictEqual(existsSync(join(testVaultRoot, '.git')), false);
    TEST_STORE.ensureVaultExists();
    assert.strictEqual(existsSync(join(testVaultRoot, '.git')), true);
  });

  it('skips git init if .git already exists', () => {
    TEST_STORE.ensureVaultExists();
    assert.strictEqual(existsSync(join(testVaultRoot, '.git')), true);
    // second call must not throw
    TEST_STORE.ensureVaultExists();
    assert.strictEqual(existsSync(join(testVaultRoot, '.git')), true);
  });

  it('sets git user.email config', () => {
    TEST_STORE.ensureVaultExists();
    const configFile = join(testVaultRoot, '.git', 'config');
    assert.strictEqual(existsSync(configFile), true);
    const content = readFileSync(configFile, 'utf8');
    assert.match(content, /bizar@localhost/);
  });
});
