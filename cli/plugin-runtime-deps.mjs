/**
 * cli/plugin-runtime-deps.mjs
 *
 * Shared helper for wiring the runtime deps (`zod`, `@cline/sdk`,
 * `@cline/core`, `@cline/shared`) into a deployed plugin's
 * `node_modules/`. Extracted out of `cli/provision.mjs` so that BOTH
 * code paths can use it:
 *
 *   - `cli/provision.mjs:copyPluginToCline()` — used by `bizar install`
 *     and `bizar update` (the "modern" provisioner).
 *   - `cli/install.mjs:installPluginFromGlobal()` — used by
 *     `runPostInstall()` and the auto-bootstrap on first `bizar` bin
 *     invocation (the "legacy" path that `cli/install.mjs` exposes for
 *     backward compat with the npm postinstall hook).
 *
 * The bug we're fixing: the legacy `installPluginFromGlobal` had its
 * OWN copy of the wiring logic that only listed `@cline/*` peer deps,
 * never `zod`. Result: after `npm install -g @polderlabs/bizar` +
 * `bizar install`, the plugin loaded from `~/.config/cline/plugins/bizar/`
 * threw `Cannot find module 'zod' (+2 more)` at startup. Both call
 * sites now go through this single function so the bug can't drift
 * back in.
 *
 * Resolution order (first match wins):
 *   1. The Bizar npm package's own `node_modules/`
 *      (`<npm root -g>/@polderlabs/bizar/node_modules`).
 *   2. The `cline` npm package's `node_modules/`
 *      (`<npm root -g>/cline/node_modules`).
 *   3. The dev source tree's `node_modules/`
 *      (`<REPO_ROOT>/node_modules`).
 *
 * Symlinks are preferred (cheap, always-fresh). Falls back to a
 * recursive copy on filesystems that don't support symlinks (e.g.
 * Windows without developer mode).
 *
 * Best-effort: a missing dep is logged but never throws. Run
 * `bizar doctor` to diagnose if any deps couldn't be wired.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Default runtime deps the Bizar plugin needs at load time.
 *
 * - `zod` is the schema-validation library the plugin uses for tool
 *   input/output validation. It's listed in the plugin's
 *   `package.json` as a regular `dependencies` entry, so it must be
 *   resolvable from the deployed plugin's `node_modules/`.
 * - `@cline/*` are peer deps that the host `cline` runtime provides
 *   (and that the Bizar npm pkg also bundles for dev convenience).
 */
export const DEFAULT_RUNTIME_DEPS = Object.freeze([
  { name: 'zod', scope: null },
  { name: 'sdk', scope: '@cline' },
  { name: 'core', scope: '@cline' },
  { name: 'shared', scope: '@cline' },
]);

/**
 * Discover candidate `node_modules/` roots to search for runtime deps.
 *
 * Each entry is a directory path. Order matters — earlier roots win
 * when a dep exists in multiple places.
 *
 * @param {object} [opts]
 * @param {string} [opts.pkgRoot] - Path to the Bizar npm package
 *   (e.g. `<npm root -g>/@polderlabs/bizar`). When omitted we try
 *   `npm root -g` to find it.
 * @param {string} [opts.repoRoot] - Path to the dev source tree. When
 *   omitted we derive it from this file's location.
 * @returns {string[]} Absolute paths to candidate `node_modules/` dirs.
 */
export function findRuntimeDepRoots({ pkgRoot, repoRoot, clineRoot } = {}) {
  const roots = [];

  // 1. Bizar npm package's own node_modules.
  //    If `pkgRoot` is supplied, use it directly (no auto-discovery).
  //    Otherwise try `npm root -g`.
  if (pkgRoot) {
    const nm = join(pkgRoot, 'node_modules');
    if (existsSync(nm)) roots.push(nm);
  } else {
    try {
      const npmRoot = execSync('npm root -g', { encoding: 'utf8', timeout: 5000 }).trim();
      const candidate = join(npmRoot, '@polderlabs', 'bizar');
      if (existsSync(candidate)) {
        const nm = join(candidate, 'node_modules');
        if (existsSync(nm)) roots.push(nm);
      }
    } catch {
      // ignore — best-effort
    }
  }

  // 2. The `cline` npm package's bundled node_modules.
  //    If `clineRoot` is supplied, use it directly. Otherwise try
  //    `npm root -g` to find the active cline install.
  if (clineRoot) {
    const nm = join(clineRoot, 'node_modules');
    if (existsSync(nm)) roots.push(nm);
  } else if (!pkgRoot) {
    // Only auto-discover cline when pkgRoot was not provided.
    // When pkgRoot is provided, the caller is driving the test
    // explicitly and we should not silently fall through to the
    // real system install.
    try {
      const npmRoot = execSync('npm root -g', { encoding: 'utf8', timeout: 5000 }).trim();
      const clineNm = join(npmRoot, 'cline', 'node_modules');
      if (existsSync(clineNm)) roots.push(clineNm);
    } catch {
      // ignore — best-effort
    }
  }

  // 3. The dev source tree's node_modules.
  if (repoRoot) {
    const nm = join(repoRoot, 'node_modules');
    if (existsSync(nm)) roots.push(nm);
  } else {
    const resolvedRepoRoot = join(__dirname, '..');
    const repoNm = join(resolvedRepoRoot, 'node_modules');
    if (existsSync(repoNm)) roots.push(repoNm);
  }

  return roots;
}

/**
 * Wire runtime-only deps into the deployed plugin's `node_modules/`.
 *
 * Bun's module resolver walks up from the plugin entry point looking
 * for `node_modules/`, and without an entry in `${dest}/node_modules/`,
 * the plugin fails to load with `Cannot find module 'zod' (+2 more)`.
 *
 * Strategy: for each dep, find the first candidate root that has it
 * and symlink (preferred) or copy (fallback) it into
 * `${dest}/node_modules/<scope>/<name>`.
 *
 * Already-wired deps are skipped (idempotent). A missing dep is
 * recorded in `missing` but never throws.
 *
 * @param {string} dest - Deployed plugin directory (must already exist).
 * @param {Array<{name: string, scope: string | null}>} [deps]
 *   Each entry is `{ name, scope }`. `scope` is null for unscoped
 *   packages (e.g. `zod`) or `@<scope>` for scoped (e.g. `@cline`).
 *   Defaults to {@link DEFAULT_RUNTIME_DEPS}.
 * @param {object} [opts]
 * @param {string} [opts.pkgRoot] - Bizar npm pkg root (see
 *   {@link findRuntimeDepRoots}).
 * @param {string} [opts.repoRoot] - Dev source tree root.
 * @param {boolean} [opts.silent] - Suppress the "wired N deps" log.
 * @returns {Promise<{wired: string[], missing: string[]}>}
 */
export async function wirePluginRuntimeDeps(
  dest,
  deps = DEFAULT_RUNTIME_DEPS,
  opts = {},
) {
  const { silent = false } = opts;
  const wired = [];
  const missing = [];
  const candidateRoots = findRuntimeDepRoots({
    pkgRoot: opts.pkgRoot,
    repoRoot: opts.repoRoot,
    clineRoot: opts.clineRoot,
  });

  for (const dep of deps) {
    const rel = dep.scope ? join(dep.scope, dep.name) : dep.name;
    const target = join(dest, 'node_modules', rel);

    // If the symlink/dir already exists and is healthy, leave it.
    try {
      const st = lstatSync(target);
      if (st.isSymbolicLink() || st.isDirectory()) {
        wired.push(rel);
        continue;
      }
      // Stale file (not a symlink/dir). Remove and re-create.
      unlinkSync(target);
    } catch {
      // missing — fine
    }

    // Find the first candidate root that has this dep.
    let source = null;
    for (const root of candidateRoots) {
      const candidate = join(root, rel);
      if (existsSync(candidate)) {
        source = candidate;
        break;
      }
    }
    if (!source) {
      missing.push(rel);
      continue;
    }

    // Make sure the parent dir exists.
    mkdirSync(dirname(target), { recursive: true });

    // Prefer symlink. Fall back to copy on EEXIST/EPERM.
    try {
      symlinkSync(source, target, 'dir');
      wired.push(rel);
    } catch (err) {
      try {
        const { cp } = await import('node:fs/promises');
        await cp(source, target, { recursive: true });
        wired.push(rel);
      } catch (copyErr) {
        missing.push(
          `${rel} (symlink failed: ${err.code}; copy failed: ${copyErr.message})`,
        );
      }
    }
  }

  if (missing.length > 0) {
    console.warn(
      chalk.yellow(
        `  ⚠ Plugin runtime deps could not be wired: ${missing.join(', ')}. ` +
        `Run \`bizar doctor\` to diagnose.`,
      ),
    );
  }
  if (wired.length > 0 && !silent) {
    console.log(
      chalk.green(
        `  ✓ wired ${wired.length} plugin runtime ` +
        `dep${wired.length === 1 ? '' : 's'}: ${wired.join(', ')}`,
      ),
    );
  }
  return { wired, missing };
}

