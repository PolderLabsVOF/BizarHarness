/**
 * cli/dev-link.test.mjs
 *
 * Tests for the `bizar dev-link` / `bizar dev-unlink` subcommands.
 * Uses Node's built-in node:test (no external test framework).
 *
 * Strategy: mock HOME (and XDG_CONFIG_HOME) so claudeConfigDir() in
 * cli/utils.mjs returns a path inside a tmpdir, and exercise the
 * create/remove symlink behavior against a controlled filesystem.
 *
 * Note: We mock HOME *before* importing dev-link.mjs because the module
 * imports claudeConfigDir transitively from utils.mjs. The path is
 * resolved at call time, though, so the mock just needs to be in place
 * when the functions run.
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  lstatSync,
  existsSync,
  readlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const { createDevLink, removeDevLink } = await import('./dev-link.mjs');

// ── HOME mocking ────────────────────────────────────────────────────────────

const ORIG_HOME = process.env.HOME;
const ORIG_XDG = process.env.XDG_CONFIG_HOME;

/**
 * Point HOME at a fresh tmpdir so the module's claudeConfigDir()
 * resolves inside it (via the fallback `<HOME>/.claude`).
 * Returns the tmpdir path.
 *
 * Note: we deliberately do NOT set XDG_CONFIG_HOME here. The
 * claudeConfigDir() helper treats a set XDG_CONFIG_HOME as the
 * direct parent (so `XDG_CONFIG_HOME=~/.config` → `~/.claude`,
 * matching the standard layout). Setting it to a raw tmpdir would
 * produce `<tmpdir>/claude` instead of the expected
 * `<tmpdir>/.claude` and break path alignment with the test.
 */
function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'bizar-devlink-'));
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.BIZAR_LEGACY_CLAUDE_DIR;
  return home;
}

/** Path to the deployed plugin dir under the mocked HOME. */
function pluginDest(home) {
  return join(home, '.claude', 'plugins', 'bizar');
}

after(() => {
  // Restore env at the very end (individual tests have already done this).
  if (ORIG_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIG_HOME;
  if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIG_XDG;
});

// ── createDevLink ───────────────────────────────────────────────────────────

describe('createDevLink()', () => {
  let home;
  let sourceDir;

  beforeEach(() => {
    home = freshHome();
    // The "source" can be any directory — it doesn't need real plugin
    // contents for the symlink test. Use the actual repo plugins/bizar
    // so the test doubles as a smoke test of the real path.
    sourceDir = join(PROJECT_ROOT, 'plugins', 'bizar');
  });

  afterEach(() => {
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
    if (ORIG_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIG_HOME;
    if (ORIG_XDG === undefined) {
      delete process.env.CLINE_DIR;
      delete process.env.BIZAR_LEGACY_CLINE_DIR;
    } else {
      process.env.XDG_CONFIG_HOME = ORIG_XDG;
    }
  });

  test('creates a symlink when dest does not exist', () => {
    const dest = pluginDest(home);
    assert.equal(existsSync(dest), false, 'precondition: dest should not exist');

    const ok = createDevLink(sourceDir);
    assert.equal(ok, true);
    assert.equal(existsSync(dest), true);
    const st = lstatSync(dest);
    assert.equal(st.isSymbolicLink(), true, 'dest should be a symlink');
  });

  test('refuses to overwrite a real directory without --force', () => {
    const dest = pluginDest(home);
    mkdirSync(dirname(dest), { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'index.ts'), 'not a symlink');

    const ok = createDevLink(sourceDir);
    assert.equal(ok, false, 'should refuse without force');
    assert.equal(existsSync(dest), true);
    const st = lstatSync(dest);
    assert.equal(st.isSymbolicLink(), false, 'dest should still be a real dir');
    assert.equal(existsSync(join(dest, 'index.ts')), true, 'contents preserved');
  });

  test('overwrites a real directory with opts.force=true', () => {
    const dest = pluginDest(home);
    mkdirSync(dirname(dest), { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'index.ts'), 'not a symlink');

    const ok = createDevLink(sourceDir, { force: true });
    assert.equal(ok, true);
    const st = lstatSync(dest);
    assert.equal(st.isSymbolicLink(), true, 'dest should now be a symlink');
    // Confirm the symlink points at the requested source. We can't
    // look up `dest/index.ts` to verify the old contents are gone —
    // that path now resolves through the symlink to the source's own
    // index.ts, which may exist. Instead, verify the link target.
    const linkTarget = readlinkSync(dest);
    assert.equal(linkTarget, sourceDir);
    // And confirm the previously-existing real directory is no longer
    // present as a real directory at `dest`.
    assert.equal(st.isDirectory(), false, 'dest should no longer be a directory');
  });

  test('replaces an existing symlink', () => {
    const dest = pluginDest(home);
    mkdirSync(dirname(dest), { recursive: true });

    const otherTarget = join(home, 'other-source');
    mkdirSync(otherTarget, { recursive: true });
    symlinkSync(otherTarget, dest);

    const ok = createDevLink(sourceDir);
    assert.equal(ok, true);
    const st = lstatSync(dest);
    assert.equal(st.isSymbolicLink(), true);
    // Confirm the symlink now points at the requested source.
    const linkTarget = readlinkSync(dest);
    assert.equal(linkTarget, sourceDir);
  });

  test('resolves a relative source dir against cwd', () => {
    const dest = pluginDest(home);
    const ok = createDevLink('plugins/bizar');
    assert.equal(ok, true);
    const linkTarget = readlinkSync(dest);
    // The resolved path should be an absolute path under PROJECT_ROOT.
    assert.ok(linkTarget.startsWith('/'), `expected absolute path, got: ${linkTarget}`);
    assert.ok(linkTarget.endsWith('/plugins/bizar'));
  });

  test('creates the cline config parent if missing', () => {
    const dest = pluginDest(home);
    assert.equal(existsSync(dirname(dest)), false, 'precondition');
    const ok = createDevLink(sourceDir);
    assert.equal(ok, true);
    assert.equal(existsSync(dirname(dest)), true);
  });
});

// ── removeDevLink ───────────────────────────────────────────────────────────

describe('removeDevLink()', () => {
  let home;

  beforeEach(() => {
    home = freshHome();
  });

  afterEach(() => {
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
    if (ORIG_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIG_HOME;
    if (ORIG_XDG === undefined) {
      delete process.env.CLINE_DIR;
      delete process.env.BIZAR_LEGACY_CLINE_DIR;
    } else {
      process.env.XDG_CONFIG_HOME = ORIG_XDG;
    }
  });

  test('errors when dest does not exist', async () => {
    const dest = pluginDest(home);
    assert.equal(existsSync(dest), false);

    const ok = await removeDevLink();
    assert.equal(ok, false);
  });

  test('errors when dest is a real directory and no --force', async () => {
    const dest = pluginDest(home);
    mkdirSync(dirname(dest), { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'index.ts'), 'precious data');

    const ok = await removeDevLink();
    assert.equal(ok, false);
    assert.equal(existsSync(join(dest, 'index.ts')), true, 'data preserved');
  });

  test('removes a symlink and restores from npm', async () => {
    const dest = pluginDest(home);
    mkdirSync(dirname(dest), { recursive: true });

    const sourceDir = join(PROJECT_ROOT, 'plugins', 'bizar');
    symlinkSync(sourceDir, dest);
    assert.equal(lstatSync(dest).isSymbolicLink(), true);

    const ok = await removeDevLink();
    assert.equal(ok, true);
    // The symlink should be gone. Whether the npm-restore step
    // recreated a real directory depends on whether @polderlabs/bizar-plugin
    // is installed globally in the test environment. Both outcomes are
    // acceptable — what matters is that the symlink was removed.
    if (existsSync(dest)) {
      const st = lstatSync(dest);
      assert.equal(
        st.isSymbolicLink(),
        false,
        'symlink should have been replaced with a real directory (npm restore)',
      );
    }
  });

  test('refuses to unlink a real dir without --force', async () => {
    const dest = pluginDest(home);
    mkdirSync(dirname(dest), { recursive: true });
    mkdirSync(dest, { recursive: true });

    const ok = await removeDevLink();
    assert.equal(ok, false);
    assert.equal(existsSync(dest), true);
  });

  test('force-removes a real dir with opts.force=true', async () => {
    const dest = pluginDest(home);
    mkdirSync(dirname(dest), { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'marker'), 'x');

    const ok = await removeDevLink({ force: true });
    assert.equal(ok, true);
    // The npm-restore may or may not recreate the directory. If it
    // does, the marker should be gone.
    if (existsSync(dest)) {
      assert.equal(existsSync(join(dest, 'marker')), false);
    }
  });
});

// ── Symlink detection ───────────────────────────────────────────────────────

describe('symlink detection', () => {
  let home;

  beforeEach(() => {
    home = freshHome();
  });

  afterEach(() => {
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
    if (ORIG_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIG_HOME;
    if (ORIG_XDG === undefined) {
      delete process.env.CLINE_DIR;
      delete process.env.BIZAR_LEGACY_CLINE_DIR;
    } else {
      process.env.XDG_CONFIG_HOME = ORIG_XDG;
    }
  });

  test('lstatSync reports isSymbolicLink()=true after createDevLink', () => {
    const dest = pluginDest(home);
    createDevLink(join(PROJECT_ROOT, 'plugins', 'bizar'));
    const st = lstatSync(dest);
    assert.equal(st.isSymbolicLink(), true);
  });

  test('lstatSync reports isSymbolicLink()=false for a real dir', () => {
    const dest = pluginDest(home);
    mkdirSync(dirname(dest), { recursive: true });
    mkdirSync(dest, { recursive: true });
    const st = lstatSync(dest);
    assert.equal(st.isSymbolicLink(), false);
  });
});

console.log('  dev-link.mjs tests loaded — run with: node --test cli/dev-link.test.mjs');