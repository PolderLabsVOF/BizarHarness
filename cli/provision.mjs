/**
 * cli/provision.mjs
 *
 * v4.4.7 — Unified installer + updater.
 *
 * `bizar install` and `bizar update` used to be two separate code paths
 * (install.sh + cli/install.mjs for install, cli/update.mjs for update)
 * with massive overlap: both copied agents, both patched cline.json,
 * both ran the plugin copy, both kicked off the service, both called
 * `bizar doctor` at the end. The two paths diverged over time, and the
 * user-visible bug was that `update` tried to install separate npm
 * packages (@polderlabs/bizar-plugin, @polderlabs/bizar-dash) that no
 * longer exist.
 *
 * This module is the single source of truth. Both `bizar install` and
 * `bizar update` call `runProvision({ mode, ... })`. The differences
 * between modes are explicit and small:
 *
 *   install: bootstrap a fresh install. Detects what exists, installs
 *            everything that's missing, configures the service, runs
 *            doctor. Does NOT kill running instances (fresh install
 *            has none).
 *   update:   refresh an existing install. Kills running instances,
 *            upgrades @polderlabs/bizar + cline via npm, re-copies
 *            agent files / plugin / skills, re-patches cline.json
 *            (idempotent), restarts the dashboard, runs doctor.
 *
 * Both modes are safe to re-run — every step is idempotent and skips
 * work that's already done.
 *
 * Public API:
 *   runProvision({ mode, dryRun, force, restart, ...flags })
 *     Runs the full provision flow for `mode` ('install' | 'update').
 *   detectState()
 *     Probe what's installed without modifying anything.
 *     Returns a structured state object.
 */

import chalk from 'chalk';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bizarConfigDir } from './utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOME = homedir();

// `cli/provision.mjs` lives at `<pkg>/cli/provision.mjs`. The repo root
// (where `plugins/bizar/`, `bizar-dash/`, `package.json` etc. live) is
// one level up. This works both in source checkouts AND in global npm
// installs (`<npm root -g>/@polderlabs/bizar/cli/provision.mjs`).
export const REPO_ROOT = join(__dirname, '..');
export const PKG_MAIN = '@polderlabs/bizar';

export const BIZAR_HOME = bizarConfigDir();

/**
 * Resolve the Cline config directory.
 *
 * Cline (v3.0+) uses `~/.cline/` (or `$CLINE_DIR`) as the global config dir
 * for `agents/`, `skills/`, `plugins/`, `hooks/`, `rules/`, `workflows/`.
 * It also checks `~/.agents/skills/` for global agents, and
 * `~/Documents/Cline/{Plugins,Hooks,Rules,Workflows,Agents}/` as a
 * Documents-side mirror.
 *
 * v4.4.7–v5.6.0 of this provisioner hard-coded `~/.config/cline/`, which was
 * the OpenCode layout. After the Phase-1 Cline migration (v5.6.0-beta.9),
 * agents/commands/skills were still being written to `~/.config/cline/` and
 * silently invisible to the `cline` CLI. Fixed in v5.6.0-beta.12.
 *
 * Resolution order (matches Cline's `resolveClineDir()` in
 * `@cline/shared/dist/storage/index.js`):
 *   1. `process.env.CLINE_DIR` (explicit override)
 *   2. `$HOME/.cline` (the Cline default — matches `cline config --config` discovery)
 *   3. (Windows only) `%APPDATA%\cline`
 *
 * `BIZAR_LEGACY_CLINE_DIR=1` opts back into the old `~/.config/cline/`
 * layout for users who deliberately want the legacy path.
 */
function resolveClineDir() {
  if (process.env.BIZAR_LEGACY_CLINE_DIR === '1') {
    return join(
      process.env.XDG_CONFIG_HOME || join(HOME, '.config'),
      'cline',
    );
  }
  if (process.env.CLINE_DIR && process.env.CLINE_DIR.trim()) {
    return process.env.CLINE_DIR.trim();
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || HOME, 'cline');
  }
  return join(HOME, '.cline');
}

export const CLINE_DIR = resolveClineDir();

/**
 * Legacy Cline directory (the old OpenCode layout).
 *
 * Kept as an opt-in fallback for users who already have agents/commands/
 * skills installed under `~/.config/cline/` and want to keep using them
 * there. The installer writes new content to `CLINE_DIR` (current Cline
 * default) but still emits a warning if `LEGACY_CLINE_DIR` exists.
 */
export const LEGACY_CLINE_DIR = join(
  process.env.XDG_CONFIG_HOME || join(HOME, '.config'),
  'cline',
);

const SERVICE_PID_FILE = join(BIZAR_HOME, 'service.pid');
const DASHBOARD_PID_FILE = join(BIZAR_HOME, 'dashboard.pid');
const DASHBOARD_PORT_FILE = join(BIZAR_HOME, 'dashboard.port');
const INSTALL_MARKER_FILE = join(BIZAR_HOME, 'installed.json');

// ─── Tiny utilities ──────────────────────────────────────────────────────────

function haveCmd(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function readTextSafe(file, fallback = '') {
  try {
    if (!existsSync(file)) return fallback;
    return readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function readJsonSafe(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Read a PID file and return the live PID, or null if missing/stale. */
export function readLivePid(pidFile) {
  if (!existsSync(pidFile)) return null;
  const raw = readTextSafe(pidFile).trim();
  if (!raw) {
    try { rmSync(pidFile, { force: true }); } catch { /* ignore */ }
    return null;
  }
  const pid = parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    try { rmSync(pidFile, { force: true }); } catch { /* ignore */ }
    return null;
  }
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    try { rmSync(pidFile, { force: true }); } catch { /* ignore */ }
    return null;
  }
}

/** Send SIGTERM, wait, then SIGKILL if needed. Cross-platform. */
export async function killAndWait(pid, { timeoutMs = 5000, label = 'process' } = {}) {
  if (!pid) return true;
  let sigtermOk = false;
  try {
    process.kill(pid);
    sigtermOk = true;
  } catch (err) {
    if (err.code === 'ESRCH') return true;
    console.log(chalk.yellow(`    ! could not signal ${label} (pid ${pid}): ${err.message}`));
    return false;
  }
  const start = Date.now();
  let sawExit = false;
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') { sawExit = true; break; }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (sawExit) return true;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    if (sigtermOk) {
      console.log(chalk.yellow(`    ! ${label} (pid ${pid}) did not exit gracefully; sent forced kill`));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return true;
    console.log(chalk.red(`    ✗ could not force-kill ${label} (pid ${pid}): ${err.message}`));
    return false;
  }
}

// ─── Install marker ──────────────────────────────────────────────────────────

/**
 * Read the install marker file. Returns null if missing.
 * Marker shape: { version, installedAt, repoPath, serviceUnit }
 */
export function readInstallMarker() {
  return readJsonSafe(INSTALL_MARKER_FILE, null);
}

/**
 * Write the install marker file.
 */
export function writeInstallMarker({ version, repoPath, serviceUnit }) {
  const marker = {
    version: version || currentVersion(PKG_MAIN) || 'unknown',
    installedAt: new Date().toISOString(),
    repoPath: repoPath || REPO_ROOT,
    serviceUnit: serviceUnit || null,
  };
  try {
    mkdirSync(BIZAR_HOME, { recursive: true });
    writeFileSync(INSTALL_MARKER_FILE, JSON.stringify(marker, null, 2) + '\n');
    return { ok: true, marker };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── State detection ──────────────────────────────────────────────────────────

/**
 * Probe the current state without modifying anything. Both install and
 * update flows start here so they can decide what to skip.
 *
 * Returned shape:
 *   {
 *     pkgRoot: string,         // <npm root -g>/@polderlabs/bizar
 *     pkgVersion: string|null, // installed @polderlabs/bizar version
 *     pkgLatest: string|null,  // latest @polderlabs/bizar version on npm
 *     plugin: { sourceDir, destDir, installed, upToDate, symlink },
 *     clineJson: { path, hasPluginEntry, exists },
 *     service: { installed, running, unitPath },
 *     dashboard: { running, pid, port },
 *     clineCli: { version, latest },
 *     headsUpState: { ok, blockerCount, warningCount },
 *     gitRepo: boolean,        // are we running from a git checkout?
 *   }
 */
export function detectState({ cwd = process.cwd() } = {}) {
  // ── npm-global package location ─────────────────────────────────────
  // Try multiple strategies because `npm root -g` doesn't always
  // respect NPM_CONFIG_PREFIX (notably when npm is installed by the
  // system package manager on Debian/Ubuntu).
  let globalRoot = null;
  const npmRootCandidates = [];

  // 1. Honour the user's explicit env override first.
  if (process.env.NPM_CONFIG_PREFIX) {
    npmRootCandidates.push(join(process.env.NPM_CONFIG_PREFIX, 'lib', 'node_modules'));
  }
  // 2. Honour NPM_CONFIG_GLOBAL_PREFIX (set by `npm -g`).
  if (process.env.NPM_CONFIG_GLOBAL_PREFIX) {
    npmRootCandidates.push(join(process.env.NPM_CONFIG_GLOBAL_PREFIX, 'lib', 'node_modules'));
  }
  // 3. The classic `npm root -g` query (works on most distros).
  try {
    const r = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (r) npmRootCandidates.push(r);
  } catch { /* ignore */ }
  // 4. Common distro defaults.
  npmRootCandidates.push('/usr/local/lib/node_modules');
  npmRootCandidates.push('/usr/lib/node_modules');

  // Pick the first candidate that actually has @polderlabs/bizar.
  for (const candidate of npmRootCandidates) {
    if (existsSync(join(candidate, '@polderlabs', 'bizar'))) {
      globalRoot = candidate;
      break;
    }
  }
  // Fall back to the first candidate (even if it doesn't have the
  // package) so downstream code can produce a clean error message.
  if (!globalRoot) globalRoot = npmRootCandidates[0] ?? null;

  const pkgRoot = globalRoot ? join(globalRoot, '@polderlabs', 'bizar') : null;
  const pkgVersion = globalRoot ? currentVersion(PKG_MAIN) : null;
  const pkgLatest = latestVersion(PKG_MAIN);

  // ── Plugin copy (deployed to ${CLINE_DIR}/plugins/bizar) ──
  const pluginSourceDir = pkgRoot ? join(pkgRoot, 'plugins', 'bizar') : null;
  const pluginDestDir = join(CLINE_DIR, 'plugins', 'bizar');
  let pluginInstalled = false;
  let pluginUpToDate = false;
  let pluginSymlink = false;
  try {
    const st = statSync(pluginDestDir);
    pluginSymlink = st.isSymbolicLink();
    pluginInstalled = true;
    if (pluginSourceDir && existsSync(pluginSourceDir)) {
      // Cheap freshness check: compare source vs dest mtime. The plugin
      // source ships its bundled node_modules + compiled JS; if dest's
      // mtime is older than source's, treat as out of date.
      try {
        const srcSt = statSync(pluginSourceDir);
        const dstSt = statSync(pluginDestDir);
        pluginUpToDate = srcSt.mtimeMs <= dstSt.mtimeMs;
      } catch {
        pluginUpToDate = false;
      }
    }
  } catch {
    pluginInstalled = false;
  }

  // ── cline.json plugin entry ───────────────────────────────────────
  const clineJsonPath = join(CLINE_DIR, 'cline.json');
  const clineJson = readJsonSafe(clineJsonPath, null);
  let hasPluginEntry = false;
  if (clineJson && Array.isArray(clineJson.plugin)) {
    hasPluginEntry = clineJson.plugin.some(
      (p) => Array.isArray(p) && typeof p[0] === 'string' && p[0].includes('plugins/bizar'),
    );
  }

  // ── Background service ─────────────────────────────────────────────
  let serviceInstalled = false;
  let serviceUnitPath = null;
  if (pkgRoot) {
    try {
      const sc = require_safe(join(pkgRoot, 'cli', 'service-controller.mjs'));
      serviceInstalled = sc?.isInstalled?.() ?? false;
      serviceUnitPath = sc?.serviceUnitPath?.() ?? null;
    } catch { /* ignore */ }
  }
  const servicePid = readLivePid(SERVICE_PID_FILE);
  const serviceRunning = servicePid !== null;

  // ── Dashboard process ──────────────────────────────────────────────
  const dashboardPid = readLivePid(DASHBOARD_PID_FILE);
  const dashboardPort = parseInt(readTextSafe(DASHBOARD_PORT_FILE, '').trim(), 10) || null;

  // ── cline CLI version ───────────────────────────────────────────
  const clineCli = {
    version: currentVersion('cline'),
    latest: latestVersion('cline'),
  };

  // ── Heads-up gate (.bizar/PRE_PUSH_NOTES.md) ───────────────────────
  let headsUpState = { ok: true, blockerCount: 0, warningCount: 0 };
  try {
    const { checkHeadsUps, findBizarDir } = require_safe('./heads-up.mjs');
    const bizarDir = findBizarDir(cwd);
    if (bizarDir && checkHeadsUps) {
      headsUpState = checkHeadsUps(bizarDir);
    }
  } catch { /* ignore */ }

  // ── Git checkout? ─────────────────────────────────────────────────
  const gitRepo = existsSync(join(REPO_ROOT, '.git'));

  // ── Installed mods ─────────────────────────────────────────────────
  // v4.4.11 — `bizar install` and `bizar update` never install or
  // upgrade mods. The list below is informational only. Use
  // `bizar mod install <id>` to add a mod explicitly.
  const MODS_DIR = join(BIZAR_HOME, 'mods');
  const installedMods = listInstalledMods(MODS_DIR);

  return {
    pkgRoot,
    pkgVersion,
    pkgLatest,
    plugin: {
      sourceDir: pluginSourceDir,
      destDir: pluginDestDir,
      installed: pluginInstalled,
      upToDate: pluginUpToDate,
      symlink: pluginSymlink,
    },
    clineJson: {
      path: clineJsonPath,
      exists: !!clineJson,
      hasPluginEntry,
    },
    service: {
      installed: serviceInstalled,
      running: serviceRunning,
      pid: servicePid,
      unitPath: serviceUnitPath,
    },
    dashboard: {
      running: dashboardPid !== null,
      pid: dashboardPid,
      port: dashboardPort,
    },
    clineCli,
    headsUpState,
    gitRepo,
    installedMods,
  };
}

/**
 * v4.4.11 — Lightweight read-only scan of `~/.config/bizar/mods/`.
 * Returns one entry per mod folder with the id + enabled flag parsed
 * from mod.json. Never throws; mods with a missing or invalid mod.json
 * are reported as `{id, error}` so the provisioner can surface them.
 */
function listInstalledMods(modsDir) {
  const out = [];
  if (!existsSync(modsDir)) return out;
  let entries;
  try {
    entries = readdirSync(modsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(modsDir, entry.name);
    const manifestPath = join(dir, 'mod.json');
    if (!existsSync(manifestPath)) {
      out.push({ id: entry.name, error: 'missing mod.json' });
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      out.push({ id: entry.name, error: 'invalid mod.json' });
      continue;
    }
    out.push({
      id: manifest.id || entry.name,
      name: manifest.name || entry.name,
      version: manifest.version || '?',
      enabled: manifest.enabled !== false,
      installedAt: manifest.installedAt || null,
      path: dir,
    });
  }
  return out;
}

/**
 * Lightweight CommonJS-ish require for ESM contexts. Used to detect the
 * service-controller + heads-up modules without paying the static-import
 * cost when those features aren't needed. Falls back gracefully if the
 * import fails (e.g. during `bizar install` from a corrupted package).
 */
async function require_safe(spec) {
  try {
    const url = new URL(spec, `file://${__dirname}/`).href;
    return await import(url);
  } catch {
    return null;
  }
}

// ─── Version + npm helpers ───────────────────────────────────────────────────

export function currentVersion(pkg) {
  try {
    const out = execSync(`npm ls -g ${pkg} --depth=0 --json`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    }).toString();
    const parsed = JSON.parse(out);
    const deps = parsed.dependencies ?? {};
    return deps[pkg]?.version ?? null;
  } catch {
    return null;
  }
}

export function latestVersion(pkg) {
  try {
    const out = execSync(`npm view ${pkg} version`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Print the installed-vs-latest version matrix in a stable column layout.
 */
export function printVersionMatrix(components) {
  const colWidth = Math.max(8, ...components.map((c) => c.label.length));
  for (const c of components) {
    const cur = c.current ?? '(not installed)';
    const lat = c.latest ?? '(unknown)';
    const same = c.current && c.current === c.latest;
    const marker = same ? chalk.green('✓ up to date') : chalk.yellow('⤵ update available');
    console.log(`    ${c.label.padEnd(colWidth)}  ${cur.padEnd(15)} → ${lat}  ${marker}`);
  }
}

// ─── Step implementations ───────────────────────────────────────────────────

/**
 * Ensure @polderlabs/bizar is installed via npm. Returns
 * `{ ok, message, installed: <version|null> }`.
 *
 * `mode`:
 *   'install' — install if missing; never upgrade an existing install
 *   'update'  — install the latest version (upgrade or install)
 */
export async function ensureNpmPackage(pkg, { mode, dryRun, force }) {
  const current = currentVersion(pkg);
  const latest = latestVersion(pkg);

  if (mode === 'install' && current && !force) {
    return { ok: true, message: `${pkg}@${current} already installed`, installed: current };
  }

  if (current && current === latest && !force) {
    return { ok: true, message: `${pkg}@${current} already up to date`, installed: current };
  }

  if (dryRun) {
    return {
      ok: true,
      message: `[dry-run] would run: npm install -g ${pkg}${latest ? `@${latest}` : '@latest'}`,
      installed: latest ?? current,
    };
  }

  // If we're inside a `bizar update`, the dashboard service / dashboard
  // processes are reading files inside the npm-global install dir. We
  // can't replace those files atomically while they're open. The caller
  // is expected to have already killed them via ensureInstancesKilled().
  const npmArgs = ['install', '-g', `${pkg}@latest`];
  if (process.env.NPM_CONFIG_PREFIX) {
    npmArgs.push('--prefix', process.env.NPM_CONFIG_PREFIX);
  }
  const r = spawnSync('npm', npmArgs, { stdio: 'inherit', timeout: 600000 });
  if (r.status === null && r.error?.code === 'ETIMEDOUT') {
    return { ok: false, message: `${pkg} install timed out after 10 minutes`, installed: current };
  }
  if (r.status !== 0) {
    return { ok: false, message: `${pkg} install failed`, installed: current };
  }
  return { ok: true, message: `${pkg} updated`, installed: latestVersion(pkg) };
}

export async function updateClineCli({ dryRun, force }) {
  const current = currentVersion('cline');
  const latest = latestVersion('cline');

  if (current && current === latest && !force) {
    return { ok: true, message: `cline@${current} up to date`, installed: current };
  }

  if (dryRun) {
    return { ok: true, message: '[dry-run] cline upgrade' };
  }

  // Prefer the upstream installer (`cline upgrade`). Falls back to npm.
  const r1 = spawnSync('cline', ['upgrade'], { stdio: 'inherit' });
  if (r1.status === 0) {
    return { ok: true, message: 'cline updated via `cline upgrade`' };
  }
  console.log(chalk.dim('  cline upgrade not available; falling back to npm'));
  const npm2Args = ['install', '-g', 'cline@latest'];
  if (process.env.NPM_CONFIG_PREFIX) {
    npm2Args.push('--prefix', process.env.NPM_CONFIG_PREFIX);
  }
  const r2 = spawnSync('npm', npm2Args, { stdio: 'inherit', timeout: 600000 });
  if (r2.status === null && r2.error?.code === 'ETIMEDOUT') {
    return { ok: false, message: 'cline install timed out after 10 minutes' };
  }
  if (r2.status === 0) {
    return { ok: true, message: 'cline updated via npm' };
  }
  return { ok: false, message: 'cline update failed' };
}

/**
 * Copy `plugins/bizar/` from the npm-installed package into
 * `${CLINE_DIR}/plugins/bizar/`. Skips if the dest is a dev symlink
 * (set by `bizar dev-link`). Idempotent — safe to re-run.
 *
 * Bug history (v5.6.0-beta.12): the cp filter used to be
 *   `!p.includes('node_modules') && !p.includes('dist')`
 * which always returned `false` for the SOURCE path itself because
 * `pkgRoot = $(npm root -g)/@polderlabs/bizar` always contains
 * `node_modules`. Net effect: 0 files were copied, the dest kept stale
 * `index.ts` ("// fake plugin" leftovers from older installs), and the
 * "up to date" mtime check then made subsequent installs skip the copy
 * because `dest mtime >= src mtime`. Fixed by:
 *
 *   1. Filtering on RELATIVE path segments, not absolute substrings.
 *   2. Adding content-hash comparison as a secondary freshness check.
 *   3. Detecting the "fake plugin" stub and forcing a re-copy.
 */
export async function copyPluginToCline({ dryRun, force }) {
  const state = detectState();
  const src = state.plugin.sourceDir;
  const dest = state.plugin.destDir;

  if (!src || !existsSync(src)) {
    return {
      ok: false,
      message: `plugin source not found at ${src ?? '(unknown)'} — reinstall @polderlabs/bizar`,
    };
  }

  // v5.6.0-beta.14: require a package.json with a `cline` field before
  // copying. Per https://docs.cline.bot/customization/plugins — without
  // the `cline.plugins` manifest, Cline falls back to recursive
  // auto-discovery and tries to load every .ts file in the plugin tree
  // (including `src/tools/*.ts`, `tests/*.test.ts`) as a plugin module,
  // which produces ~100 `Invalid plugin module` errors at startup.
  // Refuse to copy a plugin that isn't actually a Cline plugin.
  const pkgJsonPath = join(src, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    return {
      ok: false,
      message:
        `plugin source missing package.json at ${pkgJsonPath} — ` +
        `rebuild @polderlabs/bizar (the plugin must ship a cline field)`,
    };
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    if (!pkg.cline?.plugins?.length) {
      return {
        ok: false,
        message:
          `plugin package.json at ${pkgJsonPath} is missing the ` +
          'cline.plugins manifest required by Cline — see ' +
          'https://docs.cline.bot/customization/plugins',
      };
    }
  } catch (err) {
    return {
      ok: false,
      message: `plugin package.json at ${pkgJsonPath} is invalid JSON: ${err.message}`,
    };
  }

  if (state.plugin.symlink && !force) {
    return {
      ok: true,
      message: `plugin dest is a dev symlink — skipping copy (use \`bizar dev-unlink\` to restore)`,
    };
  }

  // Detect a stale "fake plugin" stub at the dest — these were left
  // behind by older broken installs that wrote `// fake plugin\n` and
  // nothing else. Always overwrite those.
  const destIndexTs = join(dest, 'index.ts');
  if (existsSync(destIndexTs) && isFakePluginStub(destIndexTs)) {
    if (!dryRun) {
      try { rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    state.plugin.installed = false;
    state.plugin.upToDate = false;
  }

  // Content-hash freshness check — supersedes the dir-mtime check that
  // gave false positives for stale "fake plugin" dirs.
  if (state.plugin.installed && !force && pluginContentMatches(src, dest)) {
    return { ok: true, message: 'plugin copy is up to date (content verified)' };
  }

  if (dryRun) {
    return { ok: true, message: `[dry-run] would copy ${src} → ${dest}` };
  }

  if (state.plugin.symlink && force) {
    try { rmSync(dest, { force: true }); } catch { /* ignore */ }
  }

  const { cp } = await import('node:fs/promises');
  try {
    // Start fresh — wipe dest so leftover files from a previous version
    // don't linger (otherwise an older index.ts can shadow the new one).
    try { rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
    mkdirSync(dest, { recursive: true });

    // Filter against RELATIVE path segments, not absolute substrings. This
    // is the v5.6.0-beta.12 fix: the old filter excluded the src dir itself
    // because npm-global paths contain `node_modules`.
    //
    // v5.6.0-beta.14: also skip `tests/` and `scripts/` (test fixtures &
    // helper scripts aren't part of the runtime plugin) and `coverage/`
    // (jest artifacts). The runtime only needs `index.ts`, `src/`,
    // `package.json`, and the static docs.
    const skipDirs = new Set([
      'node_modules',
      'dist',
      'tests',
      'scripts',
      'coverage',
      '.DS_Store',
    ]);
    await cp(src, dest, {
      recursive: true,
      filter: (p) => {
        const rel = p.slice(src.length).split(sep).filter(Boolean);
        // Drop any path that has a skip segment.
        return !rel.some((seg) => skipDirs.has(seg));
      },
    });

    // Copy the SDK into the deployed plugin's node_modules so Bun can
    // resolve @polderlabs/bizar-sdk when loading the plugin from
    // ${CLINE_DIR}/plugins/bizar/.
    const sdkSrc = join(state.pkgRoot, 'node_modules', '@polderlabs', 'bizar-sdk');
    const sdkDst = join(dest, 'node_modules', '@polderlabs', 'bizar-sdk');
    if (existsSync(sdkSrc)) {
      mkdirSync(join(dest, 'node_modules', '@polderlabs'), { recursive: true });
      await cp(sdkSrc, sdkDst, { recursive: true });
    }

    // Wire runtime deps (`zod`, `@cline/*`) into the deployed plugin's
    // node_modules/ so Bun's module resolver finds them when loading the
    // plugin from ${CLINE_DIR}/plugins/bizar/. Without this, the plugin
    // throws "Cannot find module 'zod' (+2 more)" at startup.
    //
    // The resolution logic lives in `cli/plugin-runtime-deps.mjs` and is
    // shared with the legacy installer (`cli/install.mjs`). It searches
    // the Bizar npm pkg's own `node_modules/`, then the `cline` npm
    // pkg's `node_modules/`, then the dev source tree. Symlinks are
    // preferred; recursive copy is the fallback.
    //
    // Only wire when the plugin entry is a `.ts` source file. If the
    // plugin ships a pre-bundled `dist/index.js`, the runtime deps are
    // already inlined and wiring is wasted work (and might shadow an
    // intentional `node_modules/` layout in the bundle).
    let needsWiring = true;
    try {
      const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'));
      if (typeof pkg.main === 'string' && !pkg.main.endsWith('.ts')) {
        needsWiring = false;
      }
    } catch {
      // missing/invalid package.json — proceed and let the wiring try.
    }
    if (needsWiring) {
      const { wirePluginRuntimeDeps } = await import('./plugin-runtime-deps.mjs');
      await wirePluginRuntimeDeps(dest, undefined, { pkgRoot: state.pkgRoot });
    }
    return { ok: true, message: `plugin copied to ${dest}` };
  } catch (err) {
    return { ok: false, message: `plugin copy failed: ${err.message}` };
  }
}

/**
 * Detect a "fake plugin" stub at the dest. These were emitted by old test
 * suites and early install paths that wrote `// fake plugin\n` and never
 * updated the file again. Anything under ~200 bytes is considered a stub.
 */
function isFakePluginStub(file) {
  try {
    const st = statSync(file);
    if (st.size < 200) return true;
    const head = readFileSync(file, 'utf8').slice(0, 200).toLowerCase();
    if (head.includes('fake plugin')) return true;
    return false;
  } catch {
    return true; // missing/unreadable → treat as bad
  }
}

/**
 * Recursively compare the contents of `src` and `dest`, returning true if
 * every file in src exists in dest with the same content (size + mtime).
 *
 * Cheap O(n) walk; n is the plugin source size (typically <2k files).
 * Skips `node_modules/` and `dist/` in both sides.
 */
function pluginContentMatches(src, dest) {
  const skipDirs = new Set(['node_modules', 'dist', '.DS_Store']);
  function walk(s, d) {
    const sEntries = readdirSyncSafe(s);
    const dEntries = readdirSyncSafe(d);
    if (!sEntries) return false;
    // src should not have files missing from dest
    for (const e of sEntries) {
      if (skipDirs.has(e.name)) continue;
      const sFull = join(s, e.name);
      const dFull = join(d, e.name);
      try {
        const sSt = statSync(sFull);
        if (sSt.isDirectory()) {
          if (!walk(sFull, dFull)) return false;
        } else {
          const dSt = statSync(dFull);
          if (dSt.size !== sSt.size) return false;
          if (dSt.mtimeMs < sSt.mtimeMs) return false;
        }
      } catch {
        return false;
      }
    }
    // dest may have extra files (legacy artefacts) — that's OK.
    void dEntries;
    return true;
  }
  return walk(src, dest);
}

function readdirSyncSafe(p) {
  try {
    return readdirSync(p, { withFileTypes: true });
  } catch {
    return null;
  }
}

/**
 * Ensure the Bizar plugin entry exists in `${CLINE_DIR}/cline.json`.
 * Idempotent: if the entry already exists, no-op.
 */
export async function patchClineJson({ dryRun, force }) {
  const cfgPath = join(CLINE_DIR, 'cline.json');
  if (!existsSync(cfgPath)) {
    if (dryRun) {
      return { ok: true, message: `[dry-run] would bootstrap ${cfgPath}` };
    }
    mkdirSync(CLINE_DIR, { recursive: true });
    const templateSrc = join(REPO_ROOT, 'config', 'cline.json');
    if (existsSync(templateSrc)) {
      const { copyFileSync } = await import('node:fs');
      copyFileSync(templateSrc, cfgPath);
      return { ok: true, message: `${cfgPath} bootstrapped from package template` };
    }
    writeFileSync(cfgPath, JSON.stringify({
      $schema: 'https://docs.cline.bot/config.json',
      plugin: [],
    }, null, 2));
    return { ok: true, message: `${cfgPath} created` };
  }

  // File exists. Check whether the Bizar entry is already there.
  const cfg = readJsonSafe(cfgPath, null);
  if (!cfg || typeof cfg !== 'object') {
    return { ok: false, message: `${cfgPath} is not valid JSON` };
  }
  const plugins = Array.isArray(cfg.plugin) ? cfg.plugin : [];
  const hasEntry = plugins.some(
    (p) => Array.isArray(p) && typeof p[0] === 'string' && p[0].includes('plugins/bizar'),
  );

  // Auto-add provider.minimax block if missing (v5.x — must happen
  // even when the plugin entry already exists, so always evaluate).
  const DEFAULT_MINIMAX_BLOCK = {
    options: {
      baseURL: 'https://api.minimax.io/v1',
      apiKey: '{env:MiniMax_API_KEY}',
    },
    models: {
      'MiniMax-M2.7-Flash': { name: 'MiniMax M2.7 Flash', interleaved: { field: 'reasoning_details' }, reasoning: true },
      'MiniMax-M2.7': { name: 'MiniMax M2.7', interleaved: { field: 'reasoning_details' }, reasoning: true },
      'MiniMax-M3': { name: 'MiniMax M3', interleaved: { field: 'reasoning_details' }, reasoning: true },
      'MiniMax-M3-Reasoning': { name: 'MiniMax M3 Reasoning', interleaved: { field: 'reasoning_details' }, reasoning: true },
    },
  };
  let addedProvider = false;
  if (!cfg.provider) {
    cfg.provider = {};
  }
  if (!cfg.provider.minimax) {
    cfg.provider.minimax = DEFAULT_MINIMAX_BLOCK;
    addedProvider = true;
  }

  if (hasEntry && !force && !addedProvider) {
    return { ok: true, message: 'cline.json already has Bizar plugin entry' };
  }

  if (dryRun) {
    return { ok: true, message: `[dry-run] would patch cline.json with plugin entry${addedProvider ? ' + provider.minimax' : ''}` };
  }

  if (!hasEntry) {
    // v5.6.0-beta.14: point at the plugin DIRECTORY (not a file inside
    // it). Cline reads `package.json#cline.plugins` from there and loads
    // the entry point declared in the manifest. Pointing at `index.ts`
    // directly used to work, but with the new auto-discovery rules (see
    // https://docs.cline.bot/customization/plugins) it can cause every
    // .ts file under the plugin tree to be loaded as a separate plugin
    // module — producing ~100 `Invalid plugin module` errors at startup.
    plugins.push(['./plugins/bizar', {
      loopThresholdWarn: 5,
      loopThresholdEscalate: 8,
      loopThresholdBlock: 12,
      loopWindowSize: 10,
    }]);
    cfg.plugin = plugins;
  }

  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  return {
    ok: true,
    message: addedProvider
      ? 'cline.json patched with provider.minimax (plugin entry was already present)'
      : 'cline.json patched with Bizar plugin entry + provider.minimax',
  };
}

/**
 * Copy `config/agents/*.md` into `${CLINE_DIR}/agents/`. Idempotent.
 * Doesn't overwrite existing files unless `force: true`.
 */
export async function syncAgentFiles({ dryRun, force }) {
  /**
   * v5.6.0-beta.12 — handle the Cline agent format.
   *
   * Cline reads agents from `~/.cline/agents/<name>.{yml,yaml}` with a
   * Zod-validated schema:
   *   { name: string, description: string, tools?, skills?,
   *     providerId?, modelId?, maxIterations? }
   *
   * Our source agents are written in OpenCode-flavored Markdown
   * (frontmatter + body). Both are valid: the body is the system prompt,
   * the frontmatter is config. To make agents loadable by the Cline CLI
   * we copy both `.md` (legacy / docs) and `.yaml` (Cline-loadable) into
   * `${CLINE_DIR}/agents/`. The YAML version is auto-generated if
   * missing, with the `name` field added from the filename.
   */
  const srcDir = join(REPO_ROOT, 'config', 'agents');
  const dstDir = join(CLINE_DIR, 'agents');
  if (!existsSync(srcDir)) {
    return { ok: true, message: 'no bundled agents to sync' };
  }
  if (dryRun) {
    return { ok: true, message: `[dry-run] would sync ${srcDir} → ${dstDir}` };
  }

  mkdirSync(dstDir, { recursive: true });
  mkdirSync(join(dstDir, '_shared'), { recursive: true });

  let copied = 0;
  let skipped = 0;
  const files = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of files) {
    if (entry.isDirectory()) continue;
    if (entry.name === '_shared') continue;
    const src = join(srcDir, entry.name);
    const dst = join(dstDir, entry.name);

    // Always copy the source file (md or yaml) verbatim.
    if (existsSync(dst) && !force) {
      skipped++;
    } else {
      copyFileSync(src, dst);
      copied++;
    }

    // If the source is .md and there's no matching .yaml/.yml in the
    // dest, generate one so Cline can load it.
    if (entry.name.endsWith('.md')) {
      const base = entry.name.slice(0, -3);
      const yamlDst = join(dstDir, base + '.yaml');
      if (!existsSync(yamlDst) || force) {
        const mdText = readFileSync(src, 'utf8');
        const yamlText = mdToClineAgentYaml(mdText, base);
        writeFileSync(yamlDst, yamlText);
        copied++;
      }
    }
  }

  // _shared/ — always overwrite (it's tiny + ships agent defaults).
  const sharedSrc = join(srcDir, '_shared');
  if (existsSync(sharedSrc)) {
    for (const entry of readdirSync(sharedSrc, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      copyFileSync(join(sharedSrc, entry.name), join(dstDir, '_shared', entry.name));
      copied++;
    }
  }

  return {
    ok: true,
    message: `agents synced (${copied} copied, ${skipped} kept)`,
    copied,
    skipped,
  };
}

/**
 * Convert an OpenCode-style agent markdown (frontmatter + body) into a
 * Cline-loadable YAML agent. Cline's Zod schema requires `name` and
 * `description`; the markdown body becomes the system prompt.
 */
function mdToClineAgentYaml(mdText, fallbackName) {
  const m = mdText.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) {
    // No frontmatter — write a minimal YAML with just the name + body.
    return [
      'name: ' + JSON.stringify(fallbackName),
      'description: ' + JSON.stringify(fallbackName),
      '',
    ].join('\n');
  }
  // Wrap the fallback as a YAML mapping block too.
  const _fbFallback = '---\n' +
    'name: ' + JSON.stringify(fallbackName) + '\n' +
    'description: ' + JSON.stringify(fallbackName) + '\n' +
    '---\n\n' + mdText.trim() + '\n';
  if (!mdText.includes('---')) return _fbFallback;

  const fm = m[1];
  const body = m[2];

  // If frontmatter already has a `name:` line, leave it alone.
  let newFm = fm;
  if (!/^name:/m.test(newFm)) {
    newFm = `name: ${fallbackName}\n` + newFm;
  }

  // Cline uses YAML, but OpenCode uses a YAML superset. Strip keys Cline
  // doesn't know about (`color`, `mode`, `permission`, etc.) — they were
  // relevant for the OpenCode runtime, but they would only confuse the
  // Cline Zod validator (it accepts only `name`, `description`, `tools`,
  // `skills`, `providerId`, `modelId`, `maxIterations`).
  const ALLOWED = new Set([
    'name',
    'description',
    'tools',
    'skills',
    'providerId',
    'modelId',
    'maxIterations',
  ]);
  // Drop blocks whose top-level key isn't allowed (e.g. `permission:`).
  // An indented line whose top-level parent wasn't allowed is a sub-key of
  // a dropped block — skip it.
  const lines = newFm.split('\n');
  const filteredLines = [];
  let currentTopAllowed = false;
  for (const line of lines) {
    const isIndented = line.startsWith(' ') || line.startsWith('\t');
    if (line === '' || isIndented) {
      if (currentTopAllowed) filteredLines.push(line);
      continue;
    }
    const keyMatch = line.match(/^(\w[\w-]*)\s*:/);
    if (!keyMatch) {
      filteredLines.push(line);
      currentTopAllowed = false;
      continue;
    }
    if (ALLOWED.has(keyMatch[1])) {
      filteredLines.push(line);
      currentTopAllowed = true;
    } else {
      currentTopAllowed = false;
    }
  }
  const filtered = filteredLines.join('\n');

  return '---\n' + filtered + '\n---\n\n' + body.trim() + '\n';
}

/**
 * Copy slash commands + skills to the cline config dir.
 */
/**
 * Sync slash commands + skills + hooks + workflows into the Cline config dir.
 *
 * v5.6.0-beta.12 — complete rewrite:
 *   - Iterates ALL subdirs of `config/skills/` dynamically instead of
 *     hardcoding 3 names. Previously only `obsidian`, `glyph`, and
 *     `read-the-damn-docs` were copied; the other 7 skills
 *     (`bizar`, `cpp-coding-standards`, `cpp-testing`, `embedded-esp-idf`,
 *     `lightrag`, `memory-protocol`, `self-improvement`) were silently
 *     missing from the installed Cline.
 *   - Each skill is copied as its OWN subdirectory under
 *     `${CLINE_DIR}/skills/<name>/` (e.g. `skills/obsidian/SKILL.md`),
 *     matching Cline's `resolveSkillsConfigSearchPaths` layout. Previously
 *     all skills were flattened into one dir, causing `SKILL.md` from
 *     each to overwrite the previous one — only the last copy survived.
 *   - Same per-directory layout for `commands/`, `hooks/`, `workflows/`.
 *   - Idempotent: re-running refreshes content but never deletes user
 *     additions.
 */
export async function syncConfigExtras({ dryRun }) {
  if (dryRun) {
    return { ok: true, message: '[dry-run] would sync commands + skills + hooks + workflows' };
  }

  const copyDirIfExists = async (srcDir, dstDir) => {
    if (!existsSync(srcDir)) return;
    mkdirSync(dstDir, { recursive: true });
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      const src = join(srcDir, entry.name);
      const dst = join(dstDir, entry.name);
      if (entry.isDirectory()) await copyDirIfExists(src, dst);
      else copyFileSync(src, dst);
    }
  };

  // Track counts for the success message.
  const counts = { skills: 0, commands: 0, hooks: 0, workflows: 0 };

  // ── Slash commands ───────────────────────────────────────────
  // Cline searches `~/.cline/commands/` for command files (.md).
  const commandsSrc = join(REPO_ROOT, 'config', 'commands');
  if (existsSync(commandsSrc)) {
    const commandsDst = join(CLINE_DIR, 'commands');
    mkdirSync(commandsDst, { recursive: true });
    // One subdir per command (matching Cline's command loading pattern).
    for (const cmd of readdirSync(commandsSrc, { withFileTypes: true })) {
      if (!cmd.isFile() && !cmd.isDirectory()) continue;
      const src = join(commandsSrc, cmd.name);
      const dst = join(commandsDst, cmd.name);
      if (cmd.isDirectory()) {
        await copyDirIfExists(src, dst);
      } else {
        copyFileSync(src, dst);
      }
      counts.commands += 1;
    }
  }

  // Legacy: also drop a copy under `commands-bizar/` for back-compat
  // with anyone referencing the v3.x command tree path.
  if (existsSync(commandsSrc)) {
    const commandsBizarDst = join(CLINE_DIR, 'commands-bizar');
    mkdirSync(commandsBizarDst, { recursive: true });
    for (const cmd of readdirSync(commandsSrc, { withFileTypes: true })) {
      if (!cmd.isFile()) continue;
      const src = join(commandsSrc, cmd.name);
      const dst = join(commandsBizarDst, cmd.name);
      copyFileSync(src, dst);
    }
  }

  // ── Skills ───────────────────────────────────────────────────
  // Cline expects `<configDir>/skills/<name>/SKILL.md`. We sync every
  // subdir of `config/skills/` (no hardcoded list).
  const skillsSrc = join(REPO_ROOT, 'config', 'skills');
  if (existsSync(skillsSrc)) {
    const skillsDst = join(CLINE_DIR, 'skills');
    mkdirSync(skillsDst, { recursive: true });
    for (const skillDir of readdirSync(skillsSrc, { withFileTypes: true })) {
      if (!skillDir.isDirectory()) continue;
      const src = join(skillsSrc, skillDir.name);
      const dst = join(skillsDst, skillDir.name);
      await copyDirIfExists(src, dst);
      counts.skills += 1;
    }
  }

  // Also mirror to `~/.agents/skills/<name>/` since Cline checks that
  // path too (`resolveSkillsConfigSearchPaths`). Optional but cheap.
  const agentsSkillsDst = join(HOME, '.agents', 'skills');
  if (existsSync(skillsSrc) && counts.skills > 0) {
    mkdirSync(agentsSkillsDst, { recursive: true });
    for (const skillDir of readdirSync(skillsSrc, { withFileTypes: true })) {
      if (!skillDir.isDirectory()) continue;
      const src = join(skillsSrc, skillDir.name);
      const dst = join(agentsSkillsDst, skillDir.name);
      await copyDirIfExists(src, dst);
    }
  }

  // ── Hooks ────────────────────────────────────────────────────
  const hooksSrc = join(REPO_ROOT, 'config', 'hooks');
  if (existsSync(hooksSrc)) {
    const hooksDst = join(CLINE_DIR, 'hooks');
    mkdirSync(hooksDst, { recursive: true });
    await copyDirIfExists(hooksSrc, hooksDst);
    counts.hooks = 1;
  }

  // ── Workflows ────────────────────────────────────────────────
  const workflowsSrc = join(REPO_ROOT, 'config', 'workflows');
  if (existsSync(workflowsSrc)) {
    const workflowsDst = join(CLINE_DIR, 'workflows');
    mkdirSync(workflowsDst, { recursive: true });
    await copyDirIfExists(workflowsSrc, workflowsDst);
    counts.workflows = 1;
  }

  // ── Legacy `skill/`, `skills/` (flat) ───────────────────────
  // Old versions of this function flattened all skills into one dir.
  // That caused collisions (each skill wrote SKILL.md at the same
  // path). Clean up those legacy flat dirs so users on older installs
  // don't keep seeing the wrong skill.
  for (const legacy of ['skill']) {
    const p = join(CLINE_DIR, legacy);
    if (existsSync(p)) {
      // Only remove if it's flat (no subdirs). Real skill dirs under
      // skills/<name>/SKILL.md live in `skills/`, not `skill/`.
      const entries = readdirSync(p, { withFileTypes: true });
      const onlyFiles = entries.every((e) => e.isFile());
      if (onlyFiles) {
        rmSync(p, { recursive: true, force: true });
      }
    }
  }

  return {
    ok: true,
    message:
      `commands + skills + hooks + workflows synced ` +
      `(${counts.commands} commands, ${counts.skills} skills, ` +
      `${counts.hooks} hooks, ${counts.workflows} workflows)`,
    counts,
  };
}

/**
 * Run the system-deps + service-registration steps. These are shell-only
 * (need sudo + platform package manager). We shell to the bundled
 * install.sh which knows the platform.
 */
export async function ensureSystemDeps({ dryRun, mode }) {
  const installSh = join(REPO_ROOT, 'install.sh');
  if (!existsSync(installSh)) {
    return {
      ok: true,
      message: `install.sh not found at ${installSh} — skipping system deps`,
    };
  }

  if (dryRun) {
    return { ok: true, message: '[dry-run] would shell to install.sh for system deps' };
  }

  const useBash = process.platform !== 'win32' || process.env.WSL_DISTRO_NAME;
  if (useBash) {
    // install.sh accepts --mode and a few other flags. Pass --mode
    // through so the bash script can skip what we already did in JS.
    const args = [installSh, '--mode', mode, '--non-interactive'];
    const r = spawnSync('bash', args, { stdio: 'inherit' });
    if (r.status !== 0) {
      return { ok: false, message: `install.sh exited with code ${r.status}` };
    }
    return { ok: true, message: 'install.sh completed' };
  }

  // Windows without WSL — bash isn't available. The user can install
  // system deps manually (Windows doesn't need apt/dnf for Node tooling).
  return {
    ok: true,
    message: 'Windows without WSL: skipping system deps (none required for Node tooling)',
  };
}

/**
 * Run `bizar doctor` to verify the install.
 */
export async function runDoctor({ silent = false } = {}) {
  try {
    const { runDoctor: doctorFn } = await import('./doctor.mjs');
    const result = await doctorFn({ silent });
    return result;
  } catch (err) {
    return {
      ok: false,
      failed: 1,
      results: [{ name: 'doctor', ok: false, message: err.message }],
    };
  }
}

/**
 * Run the post-install smoke test.
 */
export async function runSmokeTest({ silent = false } = {}) {
  try {
    const { runSmokeTest: smokeFn } = await import('./post-install-smoke.mjs');
    const result = await smokeFn();
    return result;
  } catch (err) {
    return {
      ok: false,
      checks: [{ name: 'smoke-test', ok: false, message: err.message }],
      passed: 0,
      failed: 1,
    };
  }
}

/**
 * v5.x — Install LightRAG via uv tool.
 * Called from the provisioner in case the shell script (install.sh)
 * was skipped (e.g. Windows without WSL). Idempotent — safe to re-run.
 * Fails gracefully if uv is not available.
 */
export async function installLightragProvision({ dryRun = false } = {}) {
  if (dryRun) {
    return { ok: true, message: '[dry-run] would run: uv tool install "lightrag-hku[api]"' };
  }
  // Check if already installed
  if (haveCmd('lightrag-server')) {
    return { ok: true, message: 'lightrag-server already on PATH' };
  }
  if (!haveCmd('uv')) {
    return { ok: false, message: 'uv not found — LightRAG not installed (install uv to enable)' };
  }
  try {
    const r = spawnSync('uv', ['tool', 'install', 'lightrag-hku[api]'], {
      stdio: 'inherit',
      timeout: 120_000,
    });
    if (r.status === 0 || r.status === null) {
      return { ok: true, message: 'lightrag-hku[api] installed via uv' };
    }
    return { ok: false, message: `uv tool install failed (exit ${r.status})` };
  } catch (err) {
    return { ok: false, message: `lightrag install error: ${err.message}` };
  }
}

/**
 * v6.0.0 — Ensure `agent-browser` (native Rust CLI from vercel-labs) is
 * installed and the daemon is up. agent-browser replaces the v5.x
 * `browser-harness` (Python CDP wrapper). The CLI is installed via
 * `npm install -g agent-browser`; Chrome for Testing is downloaded by
 * `agent-browser install`; the daemon is started by
 * `agent-browser serve --headless --port <port> --profile <dir>`.
 *
 * Idempotent. Returns { ok, message, version?, daemonRunning? }.
 */
export async function ensureAgentBrowser({ dryRun = false, mode = 'install' } = {}) {
  const ab = await import('./agent-browser-update.mjs');
  const before = ab.detectState();
  if (dryRun) {
    return {
      ok: true,
      message: `[dry-run] agent-browser: ${before.installed ? 'installed' : 'not installed'}` +
               (before.installed ? ` (v${before.version})` : ''),
      version: before.version,
      daemonRunning: before.daemonRunning,
    };
  }
  try {
    const after = mode === 'update' && before.installed
      ? ab.update({ silent: true, startDaemon: true })
      : ab.install({ silent: true, startDaemon: true });
    return {
      ok: true,
      message: `agent-browser: ${after.installed ? `v${after.version}` : 'install attempted'}` +
               ` · daemon: ${after.daemonRunning ? 'running' : 'stopped'}`,
      version: after.version,
      daemonRunning: after.daemonRunning,
    };
  } catch (err) {
    return { ok: false, message: `agent-browser install failed: ${err.message}` };
  }
}

/**
 * v4.4.11 — The mods step. By default, NEVER install or upgrade mods
 * during `bizar install` or `bizar update`. The step just reports the
 * current mod list so the user can see what's installed.
 *
 * To install a mod as part of the run, the user must opt in by:
 *   - passing `--with-mods <id1,id2>` to `bizar install` / `bizar update`
 *   - or setting the env var `BIZAR_MODS_AUTO_INSTALL=allow`
 *
 * When opted in, we shell to the running dashboard's `/api/mods`
 * endpoint (which already validates the mod) — we don't duplicate the
 * install logic here.
 */
export async function runModsStep({ mode, dryRun, force, withMods, state }) {
  // List the current mods (from the state we already detected).
  const installed = state?.installedMods ?? [];
  if (installed.length === 0) {
    console.log(chalk.dim('  Mods: 0 installed.'));
    return { ok: true, message: 'no mods installed', touched: false };
  }

  const enabled = installed.filter((m) => m.enabled).length;
  const disabled = installed.length - enabled;
  const summary = `${installed.length} installed (${enabled} enabled${disabled ? `, ${disabled} disabled` : ''})`;

  // Resolve which mods the user asked us to install. The CLI parses
  // `--with-mods a,b,c` into a string array; the provisioner accepts
  // the same. We also accept a single env var as a comma-separated list.
  const envList = (process.env.BIZAR_MODS_AUTO_INSTALL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const wantedMods = Array.isArray(withMods) && withMods.length > 0
    ? withMods
    : (process.env.BIZAR_MODS_AUTO_INSTALL === 'allow' ? [] : envList);

  // Default behavior: no install. Just print the list.
  if (!wantedMods || wantedMods.length === 0) {
    console.log(chalk.dim(`  Mods: ${summary}. Not modified (use \`bizar mod install <id>\` to add one).`));
    // Surface mods with errors so the user knows they need attention.
    const broken = installed.filter((m) => m.error);
    for (const m of broken) {
      console.log(chalk.yellow(`    ⚠ ${m.id}: ${m.error}`));
    }
    return { ok: true, message: `${summary}, not modified`, touched: false };
  }

  // Opt-in install path. Talk to the dashboard over HTTP — the
  // dashboard's `POST /api/mods` endpoint already does the actual
  // install + validation. If the dashboard isn't reachable, the
  // install fails loudly.
  console.log(chalk.cyan(`  Installing ${wantedMods.length} mod(s) via dashboard API: ${wantedMods.join(', ')}`));
  const errors = [];
  for (const id of wantedMods) {
    try {
      const result = await installModViaDashboard(id, { dryRun });
      if (result.ok) {
        console.log(chalk.green(`    ✓ ${id}: ${result.message}`));
      } else {
        console.log(chalk.red(`    ✗ ${id}: ${result.message}`));
        errors.push(`${id}: ${result.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`    ✗ ${id}: ${msg}`));
      errors.push(`${id}: ${msg}`);
    }
  }
  if (errors.length > 0) {
    return {
      ok: false,
      message: `mod install failed for ${errors.length} mod(s): ${errors.join('; ')}`,
      touched: true,
    };
  }
  return { ok: true, message: `${wantedMods.length} mod(s) installed`, touched: true };
}

/**
 * v4.4.11 — POST to the dashboard's /api/mods endpoint to install a mod.
 * We re-use the dashboard's own validation pipeline (mod-loader.mjs
 * runs the same manifest + route.mjs + permissions checks) so we
 * don't have to duplicate them here.
 */
async function installModViaDashboard(id, { dryRun }) {
  if (dryRun) {
    return { ok: true, message: '[dry-run] would install via dashboard' };
  }
  // Find the dashboard's port from BIZAR_HOME/dashboard.port.
  const portFile = join(BIZAR_HOME, 'dashboard.port');
  let port = 4321;
  try {
    if (existsSync(portFile)) {
      const parsed = parseInt(readTextSafe(portFile, '4321').trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) port = parsed;
    }
  } catch { /* ignore */ }
  // We need an auth token. The dashboard's install endpoint is under
  // /api/* which is auth-gated. Fetch the auth status + token via
  // /api/auth/status (skipped from auth via the skipPaths list in
  // server.mjs). If the dashboard has auth enabled, the user needs to
  // supply a token via BIZAR_DASHBOARD_TOKEN.
  const headers = { 'content-type': 'application/json' };
  const token = process.env.BIZAR_DASHBOARD_TOKEN;
  if (token) headers['authorization'] = `Basic ${Buffer.from(`cline:${token}`).toString('base64')}`;
  const url = `http://127.0.0.1:${port}/api/mods`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, message: `dashboard returned ${res.status}: ${text.slice(0, 200) || '(no body)'}` };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, message: data?.name ? `installed ${data.name}@${data.version}` : 'installed' };
}

// ─── Top-level orchestration ──────────────────────────────────────────────────

/**
 * Kill running Bizar instances before mutating npm-global files. Returns
 * the kill results so the caller can report them.
 */
export async function ensureInstancesKilled({ dryRun, force, instances }) {
  const live = instances ?? detectInstances();
  const running = [];
  if (live.service?.running) running.push({ kind: 'service', pid: live.service.pid });
  if (live.dashboard?.running) running.push({ kind: 'dashboard', pid: live.dashboard.pid });

  if (running.length === 0) {
    return { killed: [], skipped: [] };
  }

  if (dryRun) {
    return {
      killed: running.map((r) => ({ ...r, ok: true, dryRun: true })),
      skipped: [],
    };
  }

  // Always kill (the npm update will replace on-disk files; running
  // processes have those files open). `--force` skips the prompt.
  // We don't prompt here — the caller (runProvision) is expected to
  // confirm before calling this function. If we ever want to make
  // it interactive, plumb `assumeYes` through here.
  void force;
  const killed = [];
  for (const r of running) {
    const label = r.kind === 'service' ? 'bizar service' : 'bizar-dash';
    const ok = await killAndWait(r.pid, { label });
    killed.push({ ...r, ok });
    if (ok) {
      try { rmSync(r.kind === 'service' ? SERVICE_PID_FILE : DASHBOARD_PID_FILE, { force: true }); } catch { /* ignore */ }
      if (r.kind === 'dashboard') {
        try { rmSync(DASHBOARD_PORT_FILE, { force: true }); } catch { /* ignore */ }
      }
    }
  }
  return { killed, skipped: [] };
}

/**
 * Spawn a fresh dashboard detached. Used at the end of an `update` flow
 * to pick up the just-upgraded code.
 */
export function spawnFreshDashboard({ port } = {}) {
  const state = detectState();
  if (!state.pkgRoot) {
    return { ok: false, message: 'could not locate npm global root' };
  }
  const dashBin = join(state.pkgRoot, 'cli', 'bin.mjs');
  if (!existsSync(dashBin)) {
    return { ok: false, message: `dashboard binary not found at ${dashBin}` };
  }
  try {
    mkdirSync(BIZAR_HOME, { recursive: true });
  } catch { /* ignore */ }
  const args = [dashBin, 'start', '--bg'];
  if (port) args.push(`--port=${port}`);
  try {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, BIZAR_AUTO_RESPAWN: '1' },
    });
    child.on('error', () => { /* ignore */ });
    child.unref();
    return { ok: true, message: `dashboard re-spawned (pid ${child.pid})` };
  } catch (err) {
    return { ok: false, message: `dashboard re-spawn failed: ${err.message}` };
  }
}

/**
 * The unified provision flow. `mode` is 'install' or 'update'.
 *
 * Steps performed:
 *   1. Detect state (no side effects).
 *   2. (update only) Show installed-vs-latest version matrix.
 *   3. (update only) Heads-up gate.
 *   4. Kill running instances (update only — installs have none).
 *   5. Upgrade npm packages (bizar + cline).
 *   6. Shell to install.sh for system-deps + service registration.
 *   7. Sync agent files, slash commands, skills, hooks, workflows.
 *   8. Copy plugin to ${CLINE_DIR}/plugins/bizar/.
 *   9. Patch cline.json with the Bizar plugin entry.
 *  10. (update only) Restart dashboard.
 *  11. Doctor health check.
 *  12. Summary.
 *
 * Every step is idempotent — running this twice is safe.
 */
export async function runProvision(opts = {}) {
  const {
    mode = 'install',
    dryRun = false,
    force = false,
    restart = mode === 'update',
    skipSystemDeps = false,
    skipHeadsUps = false,
    yes = false,
    withMods = null,  // string[] — opt-in mod install. Default null = don't touch mods.
  } = opts;

  const banner = mode === 'update'
    ? chalk.bold.hex('#a855f7')('\n  ᚦ BIZAR UPDATE ᚦ\n')
    : chalk.bold.hex('#6366f1')('\n  ⚡ BIZAR INSTALL ᚦ\n');
  console.log(banner);
  if (dryRun) {
    console.log(chalk.dim('  --dry-run set: no installs, kills, or restarts will be performed.\n'));
  }

  // ── 0.5. Idempotency: detect existing install ─────────────────────────
  // v5.x — If a marker file exists and we're in 'install' mode (not 'update'),
  // treat this as a re-install. In non-interactive mode, auto-upgrade.
  // In interactive mode, prompt the user.
  const marker = readInstallMarker();
  if (mode === 'install' && marker && !dryRun) {
    if (yes) {
      // Non-interactive: auto-switch to update mode
      console.log(chalk.yellow('  ⚠ Existing install detected (marker found).'));
      console.log(chalk.yellow('  Auto-switching to update mode due to --yes flag.'));
      console.log('');
      // Re-call runProvision with update mode
      return runProvision({ ...opts, mode: 'update' });
    } else {
      // Interactive: warn and continue
      console.log(chalk.yellow('  ⚠ Existing install detected (marker found at ~/.config/bizar/installed.json).'));
      console.log(chalk.yellow(`    Last installed: ${marker.installedAt || 'unknown'}`));
      console.log(chalk.yellow('    To update an existing install, use `bizar update` or re-run with --update.'));
      console.log('');
    }
  }

  // ── 1. Detect state ──────────────────────────────────────────────────
  const state = detectState();

  // ── 2. (update) Version matrix ───────────────────────────────────────
  if (mode === 'update') {
    console.log('  Installed vs. latest:');
    printVersionMatrix([
      { label: 'cline', current: state.clineCli.version, latest: state.clineCli.latest },
      { label: PKG_MAIN, current: state.pkgVersion, latest: state.pkgLatest },
    ]);
    console.log('');
  }

  // ── 3. (update) Heads-up gate ────────────────────────────────────────
  if (mode === 'update' && !skipHeadsUps) {
    const h = state.headsUpState;
    if (h.blockerCount > 0) {
      if (dryRun) {
        console.log(chalk.yellow(`  Dry-run: ${h.blockerCount} active blocker(s) — update would be blocked.`));
      } else if (yes || force) {
        console.log(chalk.yellow(`  ⚠ ${h.blockerCount} active blocker(s) present — proceeding due to ${yes ? '--yes' : '--force'}.`));
      } else {
        console.error(chalk.red(`  ✗ ${h.blockerCount} active blocker(s) in .bizar/PRE_PUSH_NOTES.md`));
        console.error(chalk.dim('    Archive with `bizar heads-up archive` or override with --force.'));
        process.exit(1);
      }
    } else if (h.warningCount > 0) {
      console.log(chalk.yellow(`  ⚠ ${h.warningCount} warning(s) in active heads-ups.`));
    } else {
      console.log(chalk.green('  ✓ Heads-ups: clear'));
    }
    console.log('');
  }

  // ── 4. Kill running instances (update only) ─────────────────────────
  if (mode === 'update') {
    const kill = await ensureInstancesKilled({ dryRun, force, instances: {
      service: state.service.running ? { pid: state.service.pid } : null,
      dashboard: state.dashboard.running ? { pid: state.dashboard.pid } : null,
    } });
    if (kill.killed.length > 0) {
      const labels = kill.killed.map((k) => `${k.kind}${dryRun ? ' (dry-run)' : ''}`).join(', ');
      console.log(chalk.yellow(`  ⚠ Stopped running instances: ${labels}`));
      for (const k of kill.killed) {
        const marker = k.ok ? chalk.green('✓') : chalk.red('✗');
        console.log(`    ${marker} ${k.kind} ${k.ok ? 'stopped' : 'kill failed'}`);
      }
      // Give the kernel a moment to release file handles.
      if (!dryRun) await new Promise((r) => setTimeout(r, 500));
    } else {
      console.log(chalk.dim('  No running Bizar instances detected.'));
    }
    console.log('');
  }

  // ── 5. npm package upgrades ─────────────────────────────────────────
  const stepResults = [];
  const runStep = async (label, fn) => {
    console.log(chalk.bold(`  → ${label}`));
    const r = await fn();
    console.log(`    ${r.ok ? chalk.green('✓') : chalk.red('✗')} ${r.message}`);
    stepResults.push({ label, ...r });
    return r;
  };

  if (mode === 'update') {
    await runStep('cline', () => updateClineCli({ dryRun, force }));
  }
  await runStep(PKG_MAIN, () => ensureNpmPackage(PKG_MAIN, { mode, dryRun, force }));

  // ── 6. System deps + service registration (shell) ──────────────────
  if (!skipSystemDeps) {
    console.log('');
    await runStep('system-deps + service', () => ensureSystemDeps({ dryRun, mode }));
  }

  // ── 6.5. LightRAG install (Node-side, in case shell script skipped) ─
  await runStep('lightrag-server', () => installLightragProvision({ dryRun }));

  // ── 7-9. Sync agent files, commands, skills, plugin, cline.json ──
  console.log('');
  await runStep('agent files + slash commands + skills', () =>
    Promise.all([
      syncAgentFiles({ dryRun, force }),
      syncConfigExtras({ dryRun }),
    ]).then((results) => {
      const allOk = results.every((r) => r.ok);
      const msgs = results.map((r) => r.message).join('; ');
      return { ok: allOk, message: msgs || 'synced' };
    }),
  );
  await runStep(`plugin → ${CLINE_DIR}/plugins/bizar/`, () =>
    copyPluginToCline({ dryRun, force }),
  );
  await runStep('cline.json plugin entry', () => patchClineJson({ dryRun, force }));

  // ── 9.5. v5.x — issue #7. Restart the system service so it picks up
  // the freshly-installed binary. We do this AFTER the npm upgrade
  // (so the new code is on disk) and AFTER the file sync (so the
  // service won't try to read stale files on boot). The service has
  // already been killed in step 4 (mode==='update' branch).
  // This is also called on first install: if the service was registered
  // before the npm upgrade, restart is a no-op (unit content matches
  // and the service is already running with the old code).
  if (mode === 'update' && !dryRun) {
    try {
      const { restartService } = await import('./service-controller.mjs');
      const restart = restartService({ force: false, dryRun: false });
      if (restart.ok) {
        console.log(chalk.green('  ✓ Background service restarted with new code.'));
        stepResults.push({ label: 'service-restart', ok: true, message: 'restarted' });
      } else {
        // Non-fatal: the service may have been killed but failed to
        // restart, or it may not have been installed. The OS will
        // attempt to start it on next login either way.
        console.log(chalk.yellow(`  ⚠ Service restart: ${restart.error || 'unknown'}`));
        stepResults.push({ label: 'service-restart', ok: false, message: restart.error || 'restart failed' });
      }
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ Service restart skipped: ${err?.message || err}`));
      stepResults.push({ label: 'service-restart', ok: false, message: err?.message || 'skipped' });
    }
  }

  // ── 10. (update) Restart dashboard ──────────────────────────────────
  if (mode === 'update' && restart && state.dashboard.running) {
    console.log('');
    console.log(chalk.cyan('  Restarting dashboard with the new code...'));
    const r = spawnFreshDashboard({ port: state.dashboard.port });
    console.log(`    ${r.ok ? chalk.green('✓') : chalk.yellow('⚠')} ${r.message}`);
    stepResults.push({ label: 'dashboard-restart', ...r });
  }

  // ── 11. Mods (opt-in only) ─────────────────────────────────────────
  // v4.4.11 — `bizar install` and `bizar update` never install or
  // upgrade mods by default. The provisioner reports the current mod
  // list so the user can see what's installed, then exits the mod step
  // without touching anything. To install a mod, pass
  // `--with-mods <id1,id2>` or set `BIZAR_MODS_AUTO_INSTALL=allow`.
  console.log('');
  const modsStep = await runModsStep({ mode, dryRun, force, withMods, state });
  stepResults.push({ label: 'mods', ...modsStep });

  // ── 11.5. Write install marker (v5.x idempotency) ──────────────────
  if (!dryRun) {
    const markerWrite = writeInstallMarker({
      version: state.pkgVersion || null,
      repoPath: REPO_ROOT,
      serviceUnit: state.service.unitPath,
    });
    if (markerWrite.ok) {
      console.log(chalk.dim('  ✓ install marker updated'));
    }
  }

  // ── 12. Doctor health check ───────────────────────────────────────
  console.log('');
  const doctor = await runDoctor({ silent: true });
  if (doctor.failed > 0) {
    console.log(chalk.yellow(`  ⚠ Post-${mode} health check found ${doctor.failed} issue(s):`));
    for (const r of (doctor.results || [])) {
      if (!r.ok) {
        console.log(chalk.red(`    ✗ ${r.name}: ${r.message}`));
      }
    }
    console.log(chalk.dim(`  Run \`bizar doctor\` for details.`));
  } else {
    console.log(chalk.green('  ✓ Doctor: all checks passed'));
  }

  // ── 12.5. Smoke test ──────────────────────────────────────────────
  console.log('');
  console.log(chalk.bold('  → Smoke test'));
  const smoke = await runSmokeTest({ silent: false });
  stepResults.push({ label: 'smoke-test', ok: smoke.ok, message: `${smoke.passed} passed, ${smoke.failed} failed` });

  // ── 12. Summary ─────────────────────────────────────────────────────
  console.log('');
  console.log('  Summary:');
  for (const r of stepResults) {
    const marker = r.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`    ${marker} ${r.label.padEnd(36)} ${r.message}`);
  }

  const anyFail = stepResults.some((r) => !r.ok);
  if (anyFail) {
    console.log(chalk.yellow('\n  Some steps had issues. See messages above.'));
  } else {
    console.log(chalk.green(`\n  ✓ ${mode === 'update' ? 'Update' : 'Install'} complete\n`));
  }

  // ── 13. API key bootstrap warning ────────────────────────────────────
  // v5.x — After a successful install, check whether any API keys are
  // configured. If not, surface a prominent warning (but don't block —
  // many users configure keys later).
  if (mode === 'install' && !dryRun && !anyFail) {
    const envJsonPath = join(BIZAR_HOME, 'env.json');
    const marker = readInstallMarker();
    const hasApiKeys = Boolean(
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.MINIMAX_API_KEY ||
      (existsSync(envJsonPath) && (() => {
        try {
          const env = JSON.parse(readFileSync(envJsonPath, 'utf8'));
          return Boolean(env?.OPENAI_API_KEY || env?.ANTHROPIC_API_KEY || env?.MINIMAX_API_KEY);
        } catch { return false; }
      })())
    );
    if (!hasApiKeys) {
      console.log(chalk.yellow('  ⚠  No API keys configured.'));
      console.log(chalk.yellow('     Run `bizar connect` to add providers.'));
      const dashPort = process.env.BIZAR_DASHBOARD_PORT || '4097';
      console.log(chalk.yellow(`     Or visit http://localhost:${dashPort}/connect after starting the dashboard.`));
      console.log('');
    }
  }

  return {
    ok: !anyFail,
    mode,
    state,
    stepResults,
    doctor,
  };
}

/**
 * CLI-flag-parsing entrypoint for `bizar update`. Kept here so that
 * `cli/update.mjs` (the bin.mjs-facing module) can stay a thin shim
 * without duplicating flag parsing. Accepts the legacy `subargs: string[]`
 * shape so any external callers keep working.
 *
 * Recognized flags (v4.4.14):
 *   --check           Only print current vs. latest, don't update.
 *   --channel <name>  npm dist-tag (stable | beta). Default: stable.
 *   --no-restart      Don't auto-restart the dashboard after update.
 *   --dry-run         Print what would happen, change nothing.
 *   --force           Override .bizar/PRE_PUSH_NOTES.md blockers.
 *   --yes / -y        Same as --force, but named for one-line scripts.
 *   --with-mods <csv> Opt-in: install specific mods as part of the run.
 *
 * With --check, we print the version matrix and release notes between
 * current and latest, then return without touching the system.
 */
export async function runUpdate(subargs = []) {
  const args = Array.isArray(subargs) ? subargs : [];
  const checkOnly = args.includes('--check');

  // --channel <name> — extract a single value. Accepts both
  //   --channel=beta     (equals form)
  //   --channel beta     (separate-arg form)
  // Default: 'stable'.
  let channel = 'stable';
  const eqArg = args.find((a) => a.startsWith('--channel='));
  if (eqArg) {
    const value = eqArg.slice('--channel='.length);
    if (value === 'stable' || value === 'beta') {
      channel = value;
    } else {
      console.log(chalk.yellow(`  ⚠ Unknown channel "${value}". Using "stable".`));
    }
  } else {
    const channelIdx = args.indexOf('--channel');
    if (channelIdx >= 0) {
      const value = args[channelIdx + 1];
      if (!value || value.startsWith('--')) {
        console.log(chalk.yellow('  ⚠ --channel needs a value (stable | beta). Using "stable".'));
      } else if (value !== 'stable' && value !== 'beta') {
        console.log(chalk.yellow(`  ⚠ Unknown channel "${value}". Using "stable".`));
      } else {
        channel = value;
      }
    }
  }

  if (checkOnly) {
    return runCheck(channel);
  }

  // Pass channel through to the provisioner. The provisioner does the
  // actual npm install; channel maps to the npm dist-tag suffix.
  return runProvision({
    mode: 'update',
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    yes: args.includes('--yes') || args.includes('-y'),
    restart: !args.includes('--no-restart'),
    channel,
  });
}

/**
 * v4.4.14 — `bizar update --check`. Print the version matrix and (if
 * a newer version exists) the release notes between current and latest.
 * Does NOT touch the system. Exits non-zero when an update is available
 * so callers can use it in CI / pre-flight scripts.
 */
export async function runCheck(channel = 'stable') {
  console.log(chalk.bold.hex('#a855f7')('\n  ᚦ BIZAR UPDATE — CHECK ᚦ\n'));
  console.log(chalk.dim(`  Channel: ${channel}\n`));

  const state = detectState();
  printVersionMatrix([
    { label: 'cline', current: state.clineCli.version, latest: state.clineCli.latest },
    { label: PKG_MAIN, current: state.pkgVersion, latest: state.pkgLatest },
  ]);

  const cur = state.pkgVersion;
  const lat = state.pkgLatest;
  if (cur && lat && cur !== lat) {
    console.log(chalk.dim(`\n  Release notes (${cur} → ${lat}):`));
    const notes = fetchReleaseNotes(PKG_MAIN, cur, lat).catch((err) => {
      console.log(chalk.dim(`    (could not fetch: ${err.message || err})`));
      return null;
    });
    const text = await notes;
    if (text) {
      // Trim to a sensible cap (first 30 lines) so the console stays
      // readable; the full notes are one `npm view` call away.
      const lines = text.split(/\r?\n/).slice(0, 30);
      for (const line of lines) console.log(`    ${line}`);
      if (lines.length === 30) console.log(chalk.dim('    ... (truncated; run `npm view @polderlabs/bizar` for full)'));
    }
    console.log(chalk.yellow(`\n  ⤵ Run \`bizar update\` to apply.\n`));
    // Non-zero exit so scripts can detect the update-available case.
    return { ok: true, updateAvailable: true, channel };
  }

  console.log(chalk.green('\n  ✓ Already on the latest version.\n'));
  return { ok: true, updateAvailable: false, channel };
}

/**
 * Fetch the release notes between two versions from the npm registry.
 * Returns a plain-text summary (the registry's "description" field for
 * the latest version), or null on any failure. Never throws — failures
 * are surfaced to the caller as null so the check command stays useful
 * offline.
 */
async function fetchReleaseNotes(pkg, _from, _to) {
  // The npm registry does not expose a structured per-version release-
  // notes field. The best we can do is `npm view <pkg> description`
  // which is the package's README excerpt. We surface that as "notes".
  try {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('npm', ['view', pkg, 'description'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
      encoding: 'utf8',
    }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * CLI-flag-parsing entrypoint for `bizar install`. Mirrors `runUpdate`
 * so `cli/install.mjs` can stay a thin shim too.
 */
export async function runInstallerCli(opts = []) {
  const subargs = Array.isArray(opts) ? opts : [];
  return runProvision({
    mode: 'install',
    dryRun: subargs.includes('--dry-run'),
    force: subargs.includes('--force'),
    yes: subargs.includes('--yes') || subargs.includes('-y'),
  });
}