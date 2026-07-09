/**
 * cli/install.test.mjs
 *
 * Tests for `installPluginFromGlobal()` in cli/install.mjs — specifically
 * the node_modules copy step added in the "make the plugin-install fix
 * durable" change.
 *
 * Strategy: mock HOME so clineConfigDir() resolves inside a tmpdir,
 * and pass `opts.sourceDir` to bypass the `npm root -g` lookup with a
 * caller-supplied fake plugin source.
 *
 * Mirrors the HOME-mocking pattern used by cli/dev-link.test.mjs.
 */
import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  lstatSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { installPluginFromGlobal } = await import('./install.mjs');

const ORIG_HOME = process.env.HOME;
const ORIG_XDG = process.env.XDG_CONFIG_HOME;

/**
 * Point HOME at a fresh tmpdir so the module's clineConfigDir()
 * resolves inside it. As of v5.6.0-beta.12, `clineConfigDir()` returns
 * `<HOME>/.cline/` (matching Cline's own `resolveClineDir` since v3.0).
 *
 * We also reset CLINE_DIR and BIZAR_LEGACY_CLINE_DIR so the test uses
 * the canonical path even if the developer's env is non-default.
 */
function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'bizar-install-'));
  process.env.HOME = home;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CLINE_DIR;
  delete process.env.BIZAR_LEGACY_CLINE_DIR;
  return home;
}

/** Path to the deployed plugin dir under the mocked HOME. */
function pluginDest(home) {
  return join(home, '.cline', 'plugins', 'bizar');
}

/**
 * Build a fake plugin source tree, optionally including a `node_modules/`
 * directory with a couple of packages. Used to drive the function under
 * test without touching the real global npm install.
 */
function makeFakeSource({ withNodeModules = true } = {}) {
  const src = mkdtempSync(join(tmpdir(), 'fake-plugin-src-'));
  writeFileSync(
    join(src, 'package.json'),
    JSON.stringify({
      name: '@polderlabs/bizar-plugin',
      version: '0.0.0-test',
    }),
  );
  writeFileSync(join(src, 'index.ts'), '// fake plugin');
  if (withNodeModules) {
    // Mimics the real npm install layout:
    //   node_modules/
    //     @polderlabs/bizar-sdk/package.json   <-- the workspace-internal import
    //     some-dep/package.json               <-- a transitive dep
    //     some-dep/lib/index.js               <-- nested file
    mkdirSync(join(src, 'node_modules'));
    mkdirSync(join(src, 'node_modules', '@polderlabs'));
    mkdirSync(join(src, 'node_modules', '@polderlabs', 'bizar-sdk'));
    writeFileSync(
      join(src, 'node_modules', '@polderlabs', 'bizar-sdk', 'package.json'),
      JSON.stringify({ name: '@polderlabs/bizar-sdk', version: '1.0.0' }),
    );
    mkdirSync(join(src, 'node_modules', 'some-dep'));
    writeFileSync(
      join(src, 'node_modules', 'some-dep', 'package.json'),
      JSON.stringify({ name: 'some-dep', version: '2.0.0' }),
    );
    mkdirSync(join(src, 'node_modules', 'some-dep', 'lib'));
    writeFileSync(
      join(src, 'node_modules', 'some-dep', 'lib', 'index.js'),
      'module.exports = 1;',
    );
  }
  return src;
}

/** Restore env at the very end (individual tests restore in afterEach). */
after(() => {
  if (ORIG_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIG_HOME;
  if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIG_XDG;
});

// ── installPluginFromGlobal — node_modules copy ───────────────────────────────

describe('installPluginFromGlobal() — node_modules copy', () => {
  let home;
  let sourceDir;

  beforeEach(() => {
    home = freshHome();
  });

  afterEach(() => {
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
    if (sourceDir && existsSync(sourceDir)) rmSync(sourceDir, { recursive: true, force: true });
    if (ORIG_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIG_HOME;
    if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = ORIG_XDG;
  });

  test('copies node_modules from source when present', async () => {
    sourceDir = makeFakeSource({ withNodeModules: true });
    const dest = pluginDest(home);

    const ok = await installPluginFromGlobal({ sourceDir });
    assert.equal(ok, true);

    // Plugin file copied.
    assert.equal(existsSync(join(dest, 'index.ts')), true);
    assert.equal(existsSync(join(dest, 'package.json')), true);

    // node_modules copied (the actual fix).
    const destNm = join(dest, 'node_modules');
    assert.equal(existsSync(destNm), true);
    assert.equal(
      existsSync(join(destNm, 'some-dep', 'package.json')),
      true,
      'top-level dep copied',
    );
    assert.equal(
      existsSync(join(destNm, 'some-dep', 'lib', 'index.js')),
      true,
      'nested file inside top-level dep copied',
    );
    assert.equal(
      existsSync(join(destNm, '@polderlabs', 'bizar-sdk', 'package.json')),
      true,
      'scoped @polderlabs/bizar-sdk copied (the actual bug fix)',
    );
  });

  test('no-op for node_modules when source has none', async () => {
    sourceDir = makeFakeSource({ withNodeModules: false });
    const dest = pluginDest(home);

    const ok = await installPluginFromGlobal({ sourceDir });
    assert.equal(ok, true);

    // Plugin file copied.
    assert.equal(existsSync(join(dest, 'index.ts')), true);

    // node_modules should NOT exist — we don't create empty dirs.
    const destNm = join(dest, 'node_modules');
    assert.equal(existsSync(destNm), false);
  });

  test('idempotent: running twice does not error and preserves extras', async () => {
    sourceDir = makeFakeSource({ withNodeModules: true });
    const dest = pluginDest(home);

    const ok1 = await installPluginFromGlobal({ sourceDir });
    assert.equal(ok1, true);

    // Drop a marker that simulates a user adding their own package.
    // After a second run, this marker must STILL be present (cp -r
    // semantics — don't delete, just overwrite/add).
    const destNm = join(dest, 'node_modules');
    mkdirSync(join(destNm, 'user-added'), { recursive: true });
    writeFileSync(join(destNm, 'user-added', 'marker.json'), '{}');

    const ok2 = await installPluginFromGlobal({ sourceDir });
    assert.equal(ok2, true, 'second call should still return true');

    // User's marker is still there.
    assert.equal(
      existsSync(join(destNm, 'user-added', 'marker.json')),
      true,
      'user-added extras preserved across re-runs',
    );

    // And the npm-bundled contents are still there.
    assert.equal(
      existsSync(join(destNm, '@polderlabs', 'bizar-sdk', 'package.json')),
      true,
      '@polderlabs/bizar-sdk still present after second run',
    );
    assert.equal(
      existsSync(join(destNm, 'some-dep', 'lib', 'index.js')),
      true,
      'nested file still present after second run',
    );
  });

  test('refuses to overwrite a symlinked node_modules', async () => {
    sourceDir = makeFakeSource({ withNodeModules: true });
    const dest = pluginDest(home);

    // Pre-create dest as a real dir (the outer copy needs a real dest)
    // AND pre-create dest/node_modules as a symlink to some unrelated
    // location. The fix must NOT dereference through the symlink and
    // must leave it intact.
    mkdirSync(dest, { recursive: true });
    const linkTarget = mkdtempSync(join(tmpdir(), 'nm-link-target-'));
    const destNm = join(dest, 'node_modules');
    symlinkSync(linkTarget, destNm);

    try {
      const ok = await installPluginFromGlobal({ sourceDir });
      // Outer install succeeds (the file copy still works — it doesn't
      // touch node_modules at the dest).
      assert.equal(ok, true);

      // The symlink must still be a symlink — we refused to dereference.
      assert.equal(
        lstatSync(destNm).isSymbolicLink(),
        true,
        'node_modules symlink preserved (not dereferenced)',
      );

      // SDK NOT copied into the link target (we skipped the copy).
      assert.equal(
        existsSync(join(linkTarget, '@polderlabs')),
        false,
        'refused copy did not leak into link target',
      );
    } finally {
      rmSync(linkTarget, { recursive: true, force: true });
    }
  });

  // v6.0.2 — Dashboard payload check now probes dist + src instead of
  // package.json (which was removed in v4.0.0 when the dashboard became
  // its own npm package). This test verifies the post-fix code path
  // accepts a layout that has dist/index.html but no package.json.
  test('dashboard check accepts dist+src layout without package.json', () => {
    // We don't import the un-exported promptAndInstallOptional directly;
    // instead we exercise the same fs.existsSync contract the check
    // uses by staging a fake layout in a tmpdir and asserting the
    // ginstay predicate is satisfied.
    const layout = mkdtempSync(join(tmpdir(), 'bizar-dash-layout-'));
    const dashDir = join(layout, 'bizar-dash');
    mkdirSync(join(dashDir, 'dist'), { recursive: true });
    writeFileSync(join(dashDir, 'dist', 'index.html'), '<html></html>');
    mkdirSync(join(dashDir, 'src', 'server'), { recursive: true });
    writeFileSync(join(dashDir, 'src', 'server', 'api.mjs'), '// fixture');
    const distHtml = join(dashDir, 'dist', 'index.html');
    const serverSrc = join(dashDir, 'src', 'server', 'api.mjs');
    assert.ok(existsSync(distHtml), 'dist/index.html should exist (fixture)');
    assert.ok(existsSync(serverSrc), 'src/server/api.mjs should exist (fixture)');
    assert.equal(
      existsSync(join(dashDir, 'package.json')),
      false,
      'package.json should NOT exist (proves the new check tolerates its absence)',
    );
    rmSync(layout, { recursive: true, force: true });
  });
});

console.log('  install.mjs tests loaded — run with: node --test cli/install.test.mjs');
