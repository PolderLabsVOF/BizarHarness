#!/usr/bin/env node
/**
 * cli/repair.mjs
 *
 * v4.4.3 — One-shot repair for common install issues.
 *
 * Symptom this fixes: after `npm i -g @polderlabs/bizar`, the package is
 * installed under the npm-global location (e.g. ~/.local/npm/lib/...) but
 * the `bizar` symlink on PATH still points at a legacy install path
 * (e.g. ~/.local/lib/...). Calls of `bizar ...` then run the old code
 * with the old bugs. The fix is to repoint the bin symlink at the
 * currently-resolved package.
 *
 * Exports:
 *   runRepair({ dryRun, binOnly }):
 *     Returns { ok: boolean, fixed: string[], notes: string[] }
 */
import {
  existsSync,
  readlinkSync,
  lstatSync,
  symlinkSync,
  unlinkSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { join, dirname, resolve as pathResolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const HOME = homedir();

function npmRootGlobal() {
  try {
    return execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

function findPackageRootFrom(startDir, targetName) {
  let dir = startDir;
  // Walk up at most 10 levels to avoid infinite loops on weird filesystems.
  for (let i = 0; i < 10; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.name === targetName) return dir;
      } catch {
        /* skip */
      }
    }
    const parent = pathResolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Resolve the package directory the currently-running `bizar` came from.
 * Walks `process.argv[1]` (the bin entry) up to the package root via the
 * nearest package.json with `"name": "@polderlabs/bizar"`.
 */
function resolveCurrentPackageRoot() {
  const candidates = [
    process.argv[1],
    // eslint-disable-next-line no-undef
    typeof import.meta !== 'undefined' ? import.meta.dirname : null,
  ].filter(Boolean);

  for (const c of candidates) {
    let dir;
    try {
      dir = dirname(realpathSync(c));
    } catch {
      dir = dirname(c);
    }
    const root = findPackageRootFrom(dir, '@polderlabs/bizar');
    if (root) return root;
  }
  return null;
}

/**
 * Given a symlink target like `../lib/node_modules/@polderlabs/bizar/cli/bin.mjs`,
 * resolve the package root it points at (the directory containing package.json
 * with `"name": "@polderlabs/bizar"`).
 */
function packageRootFromLink(linkPath) {
  let dir;
  try {
    dir = dirname(realpathSync(linkPath));
  } catch {
    return null;
  }
  return findPackageRootFrom(dir, '@polderlabs/bizar');
}

/**
 * Find any existing `bizar` symlink on PATH that points at a different
 * `@polderlabs/bizar` package root than the one currently installed.
 */
function findStaleBinLinks(expectedPkgRoot) {
  const out = [];
  const npmGlobal = npmRootGlobal();
  const binDirs = [
    join(HOME, '.local', 'bin'),
    join(HOME, '.npm-global', 'bin'),
    '/usr/local/bin',
    npmGlobal ? join(npmGlobal, '..', '..', 'bin') : null,
    '/usr/bin',
  ].filter((p) => p && existsSync(p));

  for (const dir of binDirs) {
    const link = join(dir, 'bizar');
    if (!existsSync(link)) continue;
    let st;
    try {
      st = lstatSync(link);
    } catch {
      continue;
    }
    if (!st.isSymbolicLink()) continue;

    const pkgRoot = packageRootFromLink(link);
    if (pkgRoot && pathResolve(pkgRoot) !== pathResolve(expectedPkgRoot)) {
      out.push({
        linkPath: link,
        currentPkgRoot: pkgRoot,
        expectedPkgRoot,
      });
    }
  }
  return out;
}

function fixBinLink(linkPath, expectedPkgRoot) {
  const newTarget = join(expectedPkgRoot, 'cli', 'bin.mjs');
  try {
    unlinkSync(linkPath);
  } catch (err) {
    return { ok: false, error: `unlink failed: ${err.message}` };
  }
  try {
    symlinkSync(newTarget, linkPath);
  } catch (err) {
    return { ok: false, error: `symlink failed: ${err.message}` };
  }
  return { ok: true, newTarget };
}

export async function runRepair({ dryRun = false, binOnly = false } = {}) {
  const notes = [];
  const fixed = [];

  // The "expected" package root is the npm-global install. We repair
  // any bin symlinks that point at a different @polderlabs/bizar
  // installation. When running from a source checkout, we still do the
  // repair (the npm-global install is the canonical one).
  const npmGlobal = npmRootGlobal();
  let expectedPkgRoot = null;
  if (npmGlobal) {
    const candidate = join(npmGlobal, '@polderlabs', 'bizar');
    if (existsSync(join(candidate, 'package.json'))) {
      expectedPkgRoot = candidate;
    }
  }

  if (!expectedPkgRoot) {
    return {
      ok: false,
      fixed,
      notes: [
        'Could not locate the npm-global @polderlabs/bizar package.',
        'Is the package installed? `npm i -g @polderlabs/bizar`',
      ],
    };
  }

  // Report current state.
  notes.push(`Expected package root: ${expectedPkgRoot}`);
  try {
    const pkg = JSON.parse(readFileSync(join(expectedPkgRoot, 'package.json'), 'utf8'));
    notes.push(`Expected package version: ${pkg.version}`);
  } catch { /* ignore */ }

  // Find stale bin symlinks.
  const stale = findStaleBinLinks(expectedPkgRoot);
  if (stale.length === 0) {
    notes.push('No stale bin symlinks detected.');
  } else {
    for (const s of stale) {
      notes.push(`Stale: ${s.linkPath} -> ${s.currentPkgRoot}`);
      notes.push(`  Expected: ${s.expectedPkgRoot}`);
      if (!dryRun) {
        const r = fixBinLink(s.linkPath, s.expectedPkgRoot);
        if (r.ok) {
          fixed.push(`${s.linkPath} -> ${r.newTarget}`);
        } else {
          notes.push(`  Failed to fix ${s.linkPath}: ${r.error}`);
        }
      }
    }
  }

  return { ok: true, fixed, notes, dryRun };
}