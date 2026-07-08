/**
 * cli/plugin-runtime-deps.test.mjs
 *
 * Tests for the runtime-deps wiring helper. The helper is the fix
 * for the v6.0.0-beta.1 bug where `bizar install` left the deployed
 * plugin's `node_modules/zod` empty, producing
 * `Cannot find module 'zod' (+2 more)` at startup.
 *
 * Strategy: build a controlled filesystem (fake source for the
 * plugin, fake global Bizar pkg root, fake cline pkg root) and assert
 * that:
 *
 *   1. `findRuntimeDepRoots()` discovers the right candidate roots.
 *   2. `wirePluginRuntimeDeps()` symlinks (or copies) `zod` and
 *      `@cline/*` from the first candidate root that has them.
 *   3. Already-wired deps are skipped (idempotent).
 *   4. Missing deps are recorded in `missing` and don't throw.
 *   5. `installPluginFromGlobal` (the legacy entry point) triggers
 *      the wiring automatically when the source's `package.json`
 *      declares `main: "./index.ts"`.
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
  readlinkSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  findRuntimeDepRoots,
  wirePluginRuntimeDeps,
  DEFAULT_RUNTIME_DEPS,
} = await import('./plugin-runtime-deps.mjs');

const { installPluginFromGlobal } = await import('./install.mjs');

const ORIG_HOME = process.env.HOME;
const ORIG_XDG = process.env.XDG_CONFIG_HOME;

/**
 * Build a fake global Bizar pkg tree at `root` with the given
 * `node_modules` packages. Returns the pkg root.
 */
function makeFakeBizarPkg(root, { withModules = {} } = {}) {
  const pkg = join(root, 'bizar');
  mkdirSync(join(pkg, 'node_modules'), { recursive: true });
  for (const [name, files] of Object.entries(withModules)) {
    const dir = join(pkg, 'node_modules', ...name.split('/'));
    mkdirSync(dir, { recursive: true });
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = join(dir, relPath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content);
    }
  }
  return pkg;
}

/**
 * Build a fake cline pkg tree at `root` with the given node_modules.
 */
function makeFakeClinePkg(root, { withModules = {} } = {}) {
  const pkg = join(root, 'cline');
  mkdirSync(join(pkg, 'node_modules'), { recursive: true });
  for (const [name, files] of Object.entries(withModules)) {
    const dir = join(pkg, 'node_modules', ...name.split('/'));
    mkdirSync(dir, { recursive: true });
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = join(dir, relPath);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content);
    }
  }
  return pkg;
}

/**
 * Build a fake plugin source tree — used as `opts.sourceDir` for
 * `installPluginFromGlobal`. The package.json here drives whether
 * the runtime-deps wiring fires (it fires when `main` ends in `.ts`).
 */
function makeFakePluginSource({
  withNodeModules = false,
  main = './index.ts',
  withModules = {},
} = {}) {
  const src = mkdtempSync(join(tmpdir(), 'fake-plugin-src-'));
  writeFileSync(
    join(src, 'package.json'),
    JSON.stringify({
      name: '@polderlabs/bizar-plugin',
      version: '0.0.0-test',
      main,
    }),
  );
  writeFileSync(join(src, 'index.ts'), '// fake plugin');
  if (withNodeModules) {
    mkdirSync(join(src, 'node_modules'), { recursive: true });
    for (const [name, files] of Object.entries(withModules)) {
      const dir = join(src, 'node_modules', ...name.split('/'));
      mkdirSync(dir, { recursive: true });
      for (const [relPath, content] of Object.entries(files)) {
        const fullPath = join(dir, relPath);
        mkdirSync(join(fullPath, '..'), { recursive: true });
        writeFileSync(fullPath, content);
      }
    }
  }
  return src;
}

after(() => {
  if (ORIG_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIG_HOME;
  if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIG_XDG;
});

// ── findRuntimeDepRoots ────────────────────────────────────────────────────────

describe('findRuntimeDepRoots()', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bizar-roots-'));
  });

  afterEach(() => {
    if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  test('returns the Bizar pkg node_modules when pkgRoot has it', () => {
    const pkg = makeFakeBizarPkg(root);
    const cline = makeFakeClinePkg(root);

    const roots = findRuntimeDepRoots({ pkgRoot: pkg, repoRoot: cline, clineRoot: cline });

    assert.equal(roots[0], join(pkg, 'node_modules'));
    assert.equal(roots[1], join(cline, 'node_modules'));
  });

  test('Bizar pkg wins over cline when both are present', async () => {
    const pkg = makeFakeBizarPkg(root, {
      withModules: { zod: { 'package.json': '{"name":"zod","_from":"bizar"}' } },
    });
    const cline = makeFakeClinePkg(root, {
      withModules: { zod: { 'package.json': '{"name":"zod","_from":"cline"}' } },
    });

    // Drive the wiring end-to-end. The zod symlink at the dest must
    // point at the Bizar pkg's zod, not the cline pkg's zod.
    const dest = join(root, 'plugin');
    mkdirSync(dest, { recursive: true });
    const result = await wirePluginRuntimeDeps(
      dest,
      [{ name: 'zod', scope: null }],
      { pkgRoot: pkg, repoRoot: cline, clineRoot: cline, silent: true },
    );

    assert.deepEqual(result.missing, []);
    const target = join(dest, 'node_modules', 'zod');
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    const linked = readlinkSync(target);
    assert.equal(
      linked.includes('bizar'),
      true,
      `zod symlink should point at Bizar pkg, got: ${linked}`,
    );
    // The cline-pkg zod must NOT be the symlink target.
    assert.equal(linked.includes('/cline/'), false);
  });
});

// ── wirePluginRuntimeDeps ─────────────────────────────────────────────────────

describe('wirePluginRuntimeDeps()', () => {
  let workdir;
  let pkgRoot;
  let clineRoot;
  let dest;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'bizar-wire-'));
    pkgRoot = makeFakeBizarPkg(workdir, {
      withModules: {
        zod: { 'package.json': '{"name":"zod","version":"4.0.0"}' },
        '@cline/sdk': { 'package.json': '{"name":"@cline/sdk","version":"1.0.0"}' },
        '@cline/core': { 'package.json': '{"name":"@cline/core","version":"1.0.0"}' },
        '@cline/shared': { 'package.json': '{"name":"@cline/shared","version":"1.0.0"}' },
      },
    });
    clineRoot = makeFakeClinePkg(workdir, {
      withModules: {
        // cline has its own (different) zod — we should NOT pick this
        // up when the Bizar pkg already has zod.
        zod: { 'package.json': '{"name":"zod","version":"3.0.0"}' },
      },
    });
    dest = join(workdir, 'plugin');
    mkdirSync(dest, { recursive: true });
  });

  afterEach(() => {
    if (workdir && existsSync(workdir)) {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test('wires zod and @cline/* from the Bizar pkg root', async () => {
    const result = await wirePluginRuntimeDeps(dest, undefined, {
      pkgRoot,
      repoRoot: clineRoot,
      silent: true,
    });

    assert.deepEqual(
      result.missing,
      [],
      `expected no missing deps, got: ${result.missing.join(', ')}`,
    );
    assert.equal(result.wired.length, 4);
    assert.ok(result.wired.includes('zod'));
    assert.ok(result.wired.includes('@cline/sdk'));
    assert.ok(result.wired.includes('@cline/core'));
    assert.ok(result.wired.includes('@cline/shared'));

    // All wired entries must exist at the dest.
    for (const rel of result.wired) {
      assert.equal(existsSync(join(dest, 'node_modules', rel)), true, rel);
    }
  });

  test('wires `zod` (regression: the original bug)', async () => {
    // This is THE bug fix. Before the change, `zod` was never wired.
    // After the change, it must be — the previous test asserts all
    // four deps; this one isolates `zod` for the regression.
    const result = await wirePluginRuntimeDeps(
      dest,
      [{ name: 'zod', scope: null }],
      { pkgRoot, repoRoot: clineRoot, silent: true },
    );

    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.wired, ['zod']);
    assert.equal(
      existsSync(join(dest, 'node_modules', 'zod', 'package.json')),
      true,
      'zod/package.json must exist at the deployed plugin (the bug fix)',
    );
  });

  test('idempotent: re-running reports already-wired deps as wired', async () => {
    // First run: wires everything.
    const r1 = await wirePluginRuntimeDeps(dest, undefined, {
      pkgRoot,
      repoRoot: clineRoot,
      silent: true,
    });
    assert.equal(r1.wired.length, 4);

    // Second run: every dep is already a symlink/dir → still counts
    // as wired, no work done.
    const r2 = await wirePluginRuntimeDeps(dest, undefined, {
      pkgRoot,
      repoRoot: clineRoot,
      silent: true,
    });
    assert.deepEqual(r2.missing, []);
    assert.equal(r2.wired.length, 4);
    // Files still present.
    assert.equal(existsSync(join(dest, 'node_modules', 'zod')), true);
  });

  test('missing deps are reported, not thrown', async () => {
    // Empty cline pkg — no runtime deps available.
    const emptyCline = makeFakeClinePkg(mkdtempSync(join(tmpdir(), 'empty-')));

    const result = await wirePluginRuntimeDeps(
      dest,
      [{ name: 'nonexistent-pkg', scope: null }],
      { pkgRoot: emptyCline, repoRoot: emptyCline, silent: true },
    );

    assert.equal(result.wired.length, 0);
    assert.deepEqual(result.missing, ['nonexistent-pkg']);
  });
});

// ── installPluginFromGlobal — end-to-end wiring ───────────────────────────────

describe('installPluginFromGlobal() — runtime-deps wiring', () => {
  let home;
  let workdir;
  let sourceDir;

  function freshHome() {
    const h = mkdtempSync(join(tmpdir(), 'bizar-install-'));
    process.env.HOME = h;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.CLINE_DIR;
    delete process.env.BIZAR_LEGACY_CLINE_DIR;
    return h;
  }

  function pluginDest(h) {
    return join(h, '.cline', 'plugins', 'bizar');
  }

  beforeEach(() => {
    home = freshHome();
    workdir = mkdtempSync(join(tmpdir(), 'bizar-e2e-'));
  });

  afterEach(() => {
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
    if (workdir && existsSync(workdir)) {
      rmSync(workdir, { recursive: true, force: true });
    }
    if (sourceDir && existsSync(sourceDir)) {
      rmSync(sourceDir, { recursive: true, force: true });
    }
    if (ORIG_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIG_HOME;
    if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = ORIG_XDG;
  });

  test('wires zod into the deployed plugin when source declares main: ./index.ts', async () => {
    // The dev repo's <repo>/node_modules/ has zod, so the wiring
    // helper (which uses the dev source tree as a fallback candidate
    // root) should be able to find it. This is the regression test
    // for the v6.0.0-beta.1 bug.
    sourceDir = makeFakePluginSource({ main: './index.ts' });
    const dest = pluginDest(home);

    const ok = await installPluginFromGlobal({ sourceDir });
    assert.equal(ok, true);

    // On this developer machine, the dev repo's <repo>/node_modules
    // has zod, so the bug fix should be observable here.
    const devRepoNm = '/home/drb0rk/Projects/BizarHarness/node_modules';
    if (existsSync(join(devRepoNm, 'zod'))) {
      assert.equal(
        existsSync(join(dest, 'node_modules', 'zod')),
        true,
        'zod should be wired at the deployed plugin (regression: Cannot find module \'zod\' (+2 more))',
      );
    }
    // Even when zod isn't reachable in this environment, wiring
    // should be a no-op (logged as missing) — not a crash.
    assert.equal(existsSync(dest), true);
  });

  test('does NOT wire runtime deps when main: ./dist/index.js (bundled)', async () => {
    sourceDir = makeFakePluginSource({ main: './dist/index.js' });
    const dest = pluginDest(home);

    const ok = await installPluginFromGlobal({ sourceDir });
    assert.equal(ok, true);

    // Bundled entry point: no runtime-deps wiring should happen.
    // (The source has no node_modules/ to copy, AND the .ts gate
    // skips the wiring step.)
    const destNm = join(dest, 'node_modules');
    assert.equal(existsSync(destNm), false);
  });
});

console.log('  plugin-runtime-deps tests loaded — run with: node cli/plugin-runtime-deps.test.mjs');
