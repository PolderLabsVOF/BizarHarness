/**
 * tests/memory-default-vault.test.mjs
 *
 * Tests for the default vault location, currentVault(), and ensureVaultExists().
 *
 * v5.x — DEFAULT_MEMORY_VAULT relocated from `~/.local/share/bizar/memory` to
 * `~/.bizar_memory` (issue #5). The legacy path is exported as
 * `LEGACY_MEMORY_VAULT` for migration detection.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const TEST_STORE = await import('../src/server/memory-store.mjs').then((m) => m);

describe('DEFAULT_MEMORY_VAULT', () => {
  it('is ~/.bizar_memory', () => {
    const expected = join(homedir(), '.bizar_memory');
    assert.strictEqual(TEST_STORE.DEFAULT_MEMORY_VAULT, expected);
  });

  it('LEGACY_MEMORY_VAULT keeps the previous path for migration detection', () => {
    const expected = join(homedir(), '.local', 'share', 'bizar', 'memory');
    assert.strictEqual(TEST_STORE.LEGACY_MEMORY_VAULT, expected);
  });

  it('default vault differs from legacy vault (relocation confirmed)', () => {
    assert.notStrictEqual(TEST_STORE.DEFAULT_MEMORY_VAULT, TEST_STORE.LEGACY_MEMORY_VAULT);
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

describe('ensureVaultExists — legacy path migration notice (v5.x)', () => {
  let fakeHome;
  let legacyPath;
  let newPath;
  let origHome;
  let origVault;
  let origWarn;
  const captured = [];
  const fakeConsole = { ...console, warn: (...args) => captured.push(args.join(' ')), log: () => {} };

  beforeEach(() => {
    origHome = process.env.HOME;
    origVault = process.env.BIZAR_MEMORY_VAULT;
    origWarn = console.warn;
    console.warn = fakeConsole.warn;

    // Build a synthetic home with both the legacy path (with content) and
    // a new default path. We can't override `homedir()` in pure JS so we
    // re-import the module via a fresh dynamic import after setting HOME.
    fakeHome = join(tmpdir(), `bizar-memlegacy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.HOME = fakeHome;
    delete process.env.BIZAR_MEMORY_VAULT;
    legacyPath = join(fakeHome, '.local', 'share', 'bizar', 'memory');
    newPath = join(fakeHome, '.bizar_memory');
    mkdirSync(legacyPath, { recursive: true });
    writeFileSync(join(legacyPath, 'marker.md'), '# legacy note');
  });

  afterEach(() => {
    console.warn = origWarn;
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origVault === undefined) delete process.env.BIZAR_MEMORY_VAULT;
    else process.env.BIZAR_MEMORY_VAULT = origVault;
    if (fakeHome && existsSync(fakeHome)) rmSync(fakeHome, { recursive: true, force: true });
  });

  it('logs a one-time migration notice when legacy vault exists and new default does not', async () => {
    // Re-import the module after env change so HOME is picked up.
    const fresh = await import(`../src/server/memory-store.mjs?v=${Date.now()}`);
    captured.length = 0;
    const result = fresh.ensureVaultExists();
    assert.strictEqual(result, newPath, 'returns new default path');
    assert.strictEqual(existsSync(newPath), true, 'new vault was created');
    // The legacy path was NOT touched.
    assert.strictEqual(existsSync(legacyPath), true, 'legacy path still exists');
    assert.strictEqual(existsSync(join(legacyPath, 'marker.md')), true, 'legacy contents preserved');
    // The notice mentions the legacy path + new path + the manual mv command.
    const all = captured.join('\n');
    assert.match(all, /legacy memory vault/);
    assert.match(all, new RegExp(legacyPath.replace(/[/.]/g, '\\$&')));
    assert.match(all, new RegExp(newPath.replace(/[/.]/g, '\\$&')));
  });

  it('does not log the notice when BIZAR_MEMORY_VAULT is set (explicit override)', async () => {
    process.env.BIZAR_MEMORY_VAULT = join(fakeHome, 'explicit-vault');
    const fresh = await import(`../src/server/memory-store.mjs?v=${Date.now()}-${Math.random()}`);
    captured.length = 0;
    const result = fresh.ensureVaultExists();
    assert.strictEqual(result, process.env.BIZAR_MEMORY_VAULT);
    assert.strictEqual(captured.length, 0, 'no notice when BIZAR_MEMORY_VAULT is explicit');
  });

  it('does not log the notice when new default already exists (idempotent)', async () => {
    // Pre-create the new vault so the migration notice is skipped.
    mkdirSync(newPath, { recursive: true });
    const fresh = await import(`../src/server/memory-store.mjs?v=${Date.now()}-${Math.random()}-1`);
    captured.length = 0;
    fresh.ensureVaultExists();
    // Even with legacy present, the new vault already exists → no notice.
    assert.strictEqual(captured.length, 0, 'no notice when new default already exists');
  });
});
