/**
 * update.mjs — `bizar update` subcommand.
 *
 * Updates the opencode CLI, the @polderlabs/bizar package, the
 * @polderlabs/bizar-dash package, and/or the @polderlabs/bizar-plugin
 * package. By default, prompts for each component individually. With
 * `--all`, updates everything without prompting.
 *
 * Before any install, the command:
 *   1. Detects running instances (background service daemon, dashboard
 *      server, TUI dashboard) by reading the PID files at
 *      ~/.config/bizar/{service,dashboard}.pid and cleaning up any
 *      stale or empty ones.
 *   2. Warns the user explicitly about each running instance, lists
 *      what will be killed, and asks for confirmation. Skipped only
 *      with `--yes` (or `--force`).
 *   3. Sends SIGTERM to each live instance, waits up to 5s for
 *      graceful shutdown, then escalates to SIGKILL for anything
 *      still alive.
 *
 * After a successful update of `bizar` or `bizar-dash`, the dashboard
 * is automatically restarted (using its own `POST /api/restart`
 * endpoint when reachable, or by spawning a new process when not).
 * Use `--no-restart` to skip the restart.
 *
 * After the npm packages are updated, the install script is re-run so
 * the locally deployed plugin source matches the just-upgraded npm
 * version. Without this, the plugin in `~/.config/opencode/plugins/bizar/`
 * would lag one version behind npm and the BUGS.md "version skew"
 * trap would bite.
 *
 * Exit codes:
 *   0 — all requested updates succeeded (or none were requested)
 *   1 — at least one update failed, or the user cancelled the kill
 */

import chalk from 'chalk';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkHeadsUps, findBizarDir } from './heads-up.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

const PKG_MAIN = '@polderlabs/bizar';
const PKG_DASH = '@polderlabs/bizar-dash';
const PKG_PLUGIN = '@polderlabs/bizar-plugin';

// All known components, in the order they should be prompted + updated.
const COMPONENTS = ['opencode', 'bizar', 'dash', 'plugin'];

// ---------------------------------------------------------------------------
// Config paths (mirror the dashboard + service for consistency)
// ---------------------------------------------------------------------------

function bizarConfigDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA
      ? join(process.env.APPDATA, 'bizar')
      : join(homedir(), '.config', 'bizar');
  }
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'bizar')
    : join(homedir(), '.config', 'bizar');
}

const BIZAR_HOME = bizarConfigDir();
const SERVICE_PID_FILE = join(BIZAR_HOME, 'service.pid');
const DASHBOARD_PID_FILE = join(BIZAR_HOME, 'dashboard.pid');
const DASHBOARD_PORT_FILE = join(BIZAR_HOME, 'dashboard.port');

// ---------------------------------------------------------------------------
// PID helpers (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Read and validate a PID file. Returns a live integer PID, or `null`
 * if the file is missing / empty / contains a non-numeric value / the
 * process is not running. Stale or corrupt PID files are removed.
 *
 * Exported so tests can exercise the cleanup behavior without going
 * through the full update flow.
 */
export function readLivePid(pidFile) {
  if (!existsSync(pidFile)) return null;
  let raw;
  try {
    raw = readFileSync(pidFile, 'utf8').trim();
  } catch {
    return null;
  }
  if (!raw) {
    // Empty / corrupt — clean it up so future checks are accurate.
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
    // PID no longer alive — stale PID file.
    try { rmSync(pidFile, { force: true }); } catch { /* ignore */ }
    return null;
  }
}

/**
 * Send SIGTERM, wait up to `timeoutMs`, then SIGKILL if still alive.
 * Returns true if a signal was successfully delivered (or never needed).
 *
 * Implementation note: Linux PIDs are recycled immediately after a
 * process dies, so `process.kill(pid, 0)` after a kill is an unreliable
 * liveness check — the PID may already belong to a brand-new process.
 * We treat any successful signal delivery as success; if SIGKILL is
 * sent, the original process is certainly dead (uncatchable).
 *
 * Cross-platform note: Node.js 14+ maps `process.kill(pid)` without an
 * explicit signal to the platform-appropriate default (`SIGTERM` on
 * POSIX, `TerminateProcess` on Windows). We drop the signal argument so
 * the same code works on both platforms. For the forced-kill phase on
 * Windows we use `taskkill /F /PID <pid>` because `SIGKILL` is not
 * delivered the same way there.
 *
 * Exported for testability.
 */
export async function killAndWait(pid, { timeoutMs = 5000, label = 'process' } = {}) {
  if (!pid) return true;

  // Phase 1: graceful SIGTERM (or platform default on Windows)
  let sigtermOk = false;
  try {
    process.kill(pid);
    sigtermOk = true;
  } catch (err) {
    if (err.code === 'ESRCH') return true; // already dead
    console.log(chalk.yellow(`    ! could not signal ${label} (pid ${pid}): ${err.message}`));
    return false;
  }

  // Best-effort poll for graceful exit. Note: a signal-handling process
  // (Express dashboard, Node sleeper) usually exits within ~100ms. We
  // poll for up to `timeoutMs`; if anything responds to kill -0 it may be
  // a recycled PID, so we don't treat that as "still our process".
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

  if (sawExit) {
    // Confirmed gone via ESRCH.
    return true;
  }

  // Phase 2: escalate to forced kill. Even if `kill -0` still succeeds
  // (PID recycled or process truly stuck), SIGKILL is uncatchable and
  // the original process — if it was still our PID — is now dead.
  // On Windows, use `taskkill /F` because POSIX SIGKILL semantics don't
  // exist there.
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    if (sigtermOk) {
      console.log(chalk.yellow(`    ! ${label} (pid ${pid}) did not exit gracefully; sent forced kill`));
    }
    // Brief settle for the kernel.
    await new Promise((resolve) => setTimeout(resolve, 200));
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return true;
    console.log(chalk.red(`    ✗ could not force-kill ${label} (pid ${pid}): ${err.message}`));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/**
 * Read the currently installed version of an npm package.
 * Returns `null` if not installed globally.
 */
function currentVersion(pkg) {
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

/**
 * Read the latest version of an npm package from the registry.
 * Returns `null` if the registry is unreachable or the package is not published.
 */
function latestVersion(pkg) {
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

// ---------------------------------------------------------------------------
// Update actions
// ---------------------------------------------------------------------------

/**
 * Update opencode. Tries `opencode upgrade` first (the upstream installer's
 * own command); falls back to `npm install -g opencode-ai@latest`.
 * Pass `{ dryRun: true }` to print what would run without executing.
 * Returns `{ ok: boolean, message: string }`.
 */
function updateOpencode({ dryRun = false } = {}) {
  if (dryRun) {
    console.log(
      chalk.dim(
        '  [dry-run] would run: opencode upgrade (fallback: npm install -g opencode-ai@latest)',
      ),
    );
    return { ok: true, message: '[dry-run] opencode' };
  }
  const r1 = spawnSync('opencode', ['upgrade'], { stdio: 'inherit' });
  if (r1.status === 0) {
    return { ok: true, message: 'opencode updated via `opencode upgrade`' };
  }
  console.log(chalk.dim('  opencode upgrade not available; falling back to npm'));
  const r2 = spawnSync('npm', ['install', '-g', 'opencode-ai@latest'], { stdio: 'inherit' });
  if (r2.status === 0) {
    return { ok: true, message: 'opencode updated via npm' };
  }
  return { ok: false, message: 'opencode update failed — try `opencode upgrade` manually' };
}

function updatePackage(pkg, { dryRun = false } = {}) {
  if (dryRun) {
    console.log(
      chalk.dim(`  [dry-run] would run: npm install -g ${pkg}@latest`),
    );
    return { ok: true, message: `[dry-run] ${pkg}` };
  }
  const r = spawnSync('npm', ['install', '-g', `${pkg}@latest`], { stdio: 'inherit' });
  if (r.status !== 0) {
    return { ok: false, message: `${pkg} update failed` };
  }
  return { ok: true, message: `${pkg} updated` };
}

// ---------------------------------------------------------------------------
// Re-run the install script so the locally deployed plugin matches npm
// ---------------------------------------------------------------------------

/**
 * After updating the npm packages, re-run the install script so the
 * plugin source on disk matches the just-installed version. This is the
 * fix for the BUGS.md "version skew" trap.
 */
function rerunInstallScript() {
  let globalRoot;
  try {
    globalRoot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return { ok: false, message: 'could not locate npm global root; skipping install-script rerun' };
  }
  const pkgRoot = join(globalRoot, ...PKG_MAIN.split('/'));
  // v3.20.11: prefer the canonical `install.sh` script over `cli/bin.mjs
  // --setup`. The bash script is the single source of truth (it handles
  // system deps, chrome-headless-shell runtime libs, browser-harness,
  // opencode.json merging, etc.); the --setup path is a legacy fallback
  // for environments where bash isn't on PATH.
  const installSh = join(pkgRoot, 'install.sh');
  if (process.platform === 'win32') {
    // On Windows without WSL, bash isn't available. The bash script has
    // a Windows fallback that uses npm-based install paths. Fall through
    // to the bin.mjs --setup path, which still does the agent copy +
    // plugin-from-global install on Windows.
    console.log(chalk.dim('  Windows: using bin.mjs --setup path (bash not available)'));
  } else if (existsSync(installSh)) {
    console.log(chalk.dim(`\n  Re-running install script at ${installSh}...`));
    const r = spawnSync('bash', [installSh], { stdio: 'inherit' });
    if (r.status !== 0) {
      return { ok: false, message: 'install script rerun failed' };
    }
    return { ok: true, message: 'install script re-run' };
  } else {
    console.log(chalk.dim('  install.sh not present — falling back to bin.mjs --setup'));
  }
  const binPath = join(pkgRoot, 'cli', 'bin.mjs');
  if (!existsSync(binPath)) {
    return { ok: false, message: 'could not locate a compatible setup script to re-run' };
  }
  console.log(chalk.dim(`\n  Re-running setup via ${binPath} --setup...`));
  const r = spawnSync(process.execPath, [binPath, '--setup'], { stdio: 'inherit' });
  if (r.status === 0) {
    return { ok: true, message: 'setup re-run' };
  }
  return { ok: false, message: 'setup rerun failed' };
}

// ---------------------------------------------------------------------------
// Instance detection + kill
// ---------------------------------------------------------------------------

/**
 * Detect live Bizar instances by reading the well-known PID files.
 * Returns:
 *   { service: { pid, label } | null,
 *     dashboard: { pid, port } | null,
 *     other: Array<{ pid, cmd }> }
 */
function detectInstances() {
  const servicePid = readLivePid(SERVICE_PID_FILE);
  const dashboardPid = readLivePid(DASHBOARD_PID_FILE);
  let port = null;
  if (dashboardPid && existsSync(DASHBOARD_PORT_FILE)) {
    try {
      port = parseInt(readFileSync(DASHBOARD_PORT_FILE, 'utf8').trim(), 10) || null;
    } catch { /* ignore */ }
  }
  return {
    service: servicePid ? { pid: servicePid, label: `bizar service (pid ${servicePid})` } : null,
    dashboard: dashboardPid ? { pid: dashboardPid, port, label: `bizar-dash web dashboard (pid ${dashboardPid}${port ? `, port ${port}` : ''})` } : null,
  };
}

/**
 * Ask the user to confirm killing the listed instances. Returns true if
 * they confirmed, false if they cancelled. Skipped entirely with `assumeYes`.
 */
async function confirmKill(instances, { assumeYes } = {}) {
  const lines = [];
  if (instances.service) lines.push(`  • ${instances.service.label} — background schedule runner`);
  if (instances.dashboard) lines.push(`  • ${instances.dashboard.label} — web UI + API`);
  if (lines.length === 0) return true;
  if (assumeYes) return true;
  console.log('');
  console.log(chalk.bold.yellow('  ⚠  Running Bizar instances detected:'));
  for (const l of lines) console.log(chalk.yellow(l));
  console.log('');
  console.log(chalk.yellow('  These must be stopped before npm can replace the on-disk files.'));
  console.log(chalk.yellow('  Killing them will close any open web tabs / TUI sessions.'));
  console.log('');
  // Best-effort interactive confirmation. Non-TTY (CI / piped input) skips the
  // prompt and aborts — callers should pass `--yes` explicitly in that case.
  if (!process.stdin.isTTY) {
    console.log(chalk.red('  Non-interactive shell detected; rerun with --yes to confirm the kill, or stop the processes manually.'));
    return false;
  }
  try {
    const inquirer = await import('inquirer');
    const { ok } = await inquirer.default.prompt([
      {
        type: 'confirm',
        name: 'ok',
        message: 'Kill the running instance(s) and continue?',
        default: true,
      },
    ]);
    return Boolean(ok);
  } catch (err) {
    console.log(chalk.red(`  ! inquirer unavailable: ${err.message}`));
    return false;
  }
}

async function killInstances(instances) {
  const out = [];
  if (instances.service) {
    const ok = await killAndWait(instances.service.pid, { label: 'bizar service' });
    out.push({ name: 'service', ok });
    if (ok) {
      try { rmSync(SERVICE_PID_FILE, { force: true }); } catch { /* ignore */ }
    }
  }
  if (instances.dashboard) {
    const ok = await killAndWait(instances.dashboard.pid, { label: 'bizar-dash' });
    out.push({ name: 'dashboard', ok });
    if (ok) {
      try { rmSync(DASHBOARD_PID_FILE, { force: true }); } catch { /* ignore */ }
      try { rmSync(DASHBOARD_PORT_FILE, { force: true }); } catch { /* ignore */ }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Restart the dashboard after the update completes
// ---------------------------------------------------------------------------

/**
 * Spawn a fresh dashboard process detached, returning the new PID. The
 * dashboard will use the just-updated @polderlabs/bizar-dash code from
 * the global npm install.
 */
function spawnFreshDashboard({ port } = {}) {
  let globalRoot;
  try {
    globalRoot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return { ok: false, message: 'could not locate npm global root' };
  }
  const dashBin = join(globalRoot, ...PKG_DASH.split('/'), 'src', 'cli.mjs');
  if (!existsSync(dashBin)) {
    return {
      ok: false,
      message: `dashboard binary not found at ${dashBin} (was @polderlabs/bizar-dash installed?)`,
    };
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

// ---------------------------------------------------------------------------
// Repo-level update helpers
// ---------------------------------------------------------------------------

/**
 * v4.4.2 — Detect whether `bizar update` is running from a git checkout
 * or from a globally-installed npm package. When run from the npm
 * install (REPO_ROOT has no `.git/`), the git-pull step is meaningless
 * and aborts the entire update. We no-op it and let the `npm update -g`
 * path handle the version bump.
 *
 * Returns `{ inRepo: boolean, repoRoot: string }` so the caller can
 * decide what to do.
 */
function detectRepoMode() {
  const gitDir = join(REPO_ROOT, '.git');
  return {
    inRepo: existsSync(gitDir),
    repoRoot: REPO_ROOT,
  };
}

/**
 * Pull the latest changes from the git origin. Exits the process if the
 * pull fails (merge conflict etc.), matching the task flow — an update
 * should not proceed when the working tree is dirty.
 */
function runGitPull({ dryRun = false } = {}) {
  const { inRepo } = detectRepoMode();
  if (!inRepo) {
    // Running from a global npm install — there's no checkout to pull.
    // The npm package update is handled separately by updatePackage().
    if (dryRun) {
      console.log(chalk.dim('  [dry-run] skipping git pull (not a git checkout)'));
    }
    return { ok: true, message: 'skipped git pull (not a git checkout)' };
  }
  if (dryRun) {
    console.log(chalk.dim('  [dry-run] would run: git pull --rebase'));
    return { ok: true, message: '[dry-run] git pull --rebase' };
  }
  try {
    execSync('git pull --rebase', { stdio: 'inherit', cwd: REPO_ROOT, timeout: 60000 });
    return { ok: true, message: 'git pull --rebase succeeded' };
  } catch {
    return { ok: false, message: 'git pull --rebase failed — resolve conflicts manually' };
  }
}

/**
 * Copy bundled skills from config/skills/ to the user's .opencode/skills/
 * directory. Currently installs: obsidian, glyph, read-the-damn-docs.
 */
async function installSkills({ dryRun = false } = {}) {
  const skills = ['obsidian', 'glyph', 'read-the-damn-docs'];
  const results = [];
  for (const skill of skills) {
    const src = join(REPO_ROOT, 'config', 'skills', skill);
    const dst = join(homedir(), '.opencode', 'skills', skill);
    if (dryRun) {
      if (existsSync(src)) {
        console.log(chalk.dim(`  [dry-run] would install skill: ${skill}`));
      }
    } else if (existsSync(src)) {
      try {
        await cp(src, dst, { recursive: true });
        console.log(chalk.green(`  ✓ Installed skill: ${skill}`));
        results.push({ skill, ok: true });
      } catch (err) {
        console.log(chalk.yellow(`  ⚠ Failed to install skill: ${skill} — ${err.message}`));
        results.push({ skill, ok: false });
      }
    } else {
      console.log(chalk.dim(`  — Source not found: config/skills/${skill} (skipping)`));
    }
  }
  return results;
}

/**
 * Rebuild the bizar-dash frontend with Vite.
 */
function rebuildDashboard({ dryRun = false } = {}) {
  const dashDir = join(REPO_ROOT, 'bizar-dash');
  const pkgJson = join(dashDir, 'package.json');
  if (!existsSync(pkgJson)) {
    return { ok: false, message: 'bizar-dash/package.json not found — is the dashboard cloned?' };
  }
  if (dryRun) {
    console.log(chalk.dim('  [dry-run] would run: npx vite build (in bizar-dash/)'));
    return { ok: true, message: '[dry-run] dashboard rebuild' };
  }
  console.log(chalk.dim('\n  Rebuilding dashboard...'));
  const r = spawnSync('npx', ['vite', 'build'], {
    stdio: 'inherit', cwd: dashDir, timeout: 120000,
  });
  if (r.status === 0) {
    return { ok: true, message: 'dashboard rebuilt' };
  }
  return { ok: false, message: 'dashboard rebuild failed (try: cd bizar-dash && npx vite build)' };
}

/**
 * Detect and run the project's test suite. Checks for common test runners
 * (npm test, pytest, cargo test, go test) and runs the first one found.
 */
function runTestGate({ dryRun = false } = {}) {
  if (dryRun) {
    console.log(chalk.dim('  [dry-run] would detect and run local test suite'));
    return { ok: true, message: '[dry-run] test gate' };
  }
  const cwd = process.cwd();
  const suites = [
    { cmd: 'npm test',           check: 'package.json' },
    { cmd: 'pytest',             check: 'pyproject.toml' },
    { cmd: 'cargo test',         check: 'Cargo.toml' },
    { cmd: 'go test ./...',      check: 'go.mod' },
  ];
  for (const suite of suites) {
    try {
      if (existsSync(join(cwd, suite.check))) {
        console.log(chalk.dim(`\n  Running test suite: ${suite.cmd}...`));
        execSync(suite.cmd, { stdio: 'inherit', timeout: 120000, cwd });
        return { ok: true, message: `test gate passed (${suite.cmd})` };
      }
    } catch {
      return { ok: false, message: `test gate failed (${suite.cmd})` };
    }
  }
  return { ok: true, message: 'no test suite detected (skipped)' };
}

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

async function promptForUpdates(forceAll) {
  if (forceAll) return new Set(COMPONENTS);
  const inquirer = await import('inquirer');
  const { selections } = await inquirer.default.prompt([
    {
      type: 'checkbox',
      name: 'selections',
      message: 'Which components do you want to update?',
      choices: [
        { name: 'opencode (the opencode CLI itself)', value: 'opencode', checked: true },
        { name: `bizar (${PKG_MAIN})`, value: 'bizar', checked: true },
        { name: `bizar dash (${PKG_DASH}) — web dashboard`, value: 'dash', checked: true },
        { name: `plugin (${PKG_PLUGIN})`, value: 'plugin', checked: true },
      ],
    },
  ]);
  return new Set(selections);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Default behavior policy for `bizar update`:
 *   - Update EVERYTHING (opencode + bizar + dash + plugin) automatically.
 *   - Auto-install any missing component without asking.
 *   - Kill running instances without confirmation (with a brief notice).
 *   - Re-run the install script to refresh the on-disk plugin.
 *   - Restart the dashboard if it was running.
 *
 * The `--pick` / `-p` flag opts into the legacy per-component picker
 * (checkbox UI) for users who want to update only some components.
 *
 * The `--dry-run` flag previews what would happen without touching
 * anything.
 *
 * The `--no-restart` flag skips the dashboard restart step.
 */
export async function runUpdate(subargs = []) {
  console.log(chalk.bold.hex('#a855f7')('\n  ᚦ BIZAR UPDATE ᚦ\n'));

  // Parse flags
  const assumeYes = subargs.includes('--yes') || subargs.includes('-y') || subargs.includes('--force');
  const restartAfter = !subargs.includes('--no-restart');
  const forceAll = subargs.includes('--all');
  const dryRun = subargs.includes('--dry-run');
  // Opt-in interactive picker. Without `--pick`, we update everything
  // automatically. This matches what the user actually wants 95% of
  // the time ("update my install") and removes a prompt that
  // interrupted the flow.
  const interactivePick = subargs.includes('--pick') || subargs.includes('-p');

  if (dryRun) {
    console.log(
      chalk.dim('  --dry-run set: no installs, kills, or restarts will be performed.\n'),
    );
  }

  // 1. Detect running instances BEFORE doing anything else.
  const instances = detectInstances();
  const runningCount = (instances.service ? 1 : 0) + (instances.dashboard ? 1 : 0);

  if (runningCount > 0) {
    if (dryRun) {
      const labels = [];
      if (instances.service) labels.push(instances.service.label);
      if (instances.dashboard) labels.push(instances.dashboard.label);
      console.log(
        chalk.dim(`  [dry-run] would stop running instances: ${labels.join(', ')}`),
      );
    } else {
      // In automatic mode we still print what we're about to kill
      // but don't prompt — the operator asked for a full update and
      // these processes would block the npm replace anyway.
      const labels = [];
      if (instances.service) labels.push(instances.service.label);
      if (instances.dashboard) labels.push(instances.dashboard.label);
      console.log(chalk.yellow(`  ⚠ Stopping running instances: ${labels.join(', ')}`));
      console.log(
        chalk.dim('  (use `--pick` to be prompted before killing in future)'),
      );
      const kills = await killInstances(instances);
      for (const k of kills) {
        const marker = k.ok ? chalk.green('✓') : chalk.red('✗');
        console.log(`    ${marker} ${k.name} stopped`);
      }
      // Give the kernel a moment to release any open file handles on the
      // npm-global directory before npm tries to replace files.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } else {
    console.log(chalk.dim('  No running Bizar instances detected.'));
  }

  // ── Git pull ──────────────────────────────────────────────────────────
  const { inRepo } = detectRepoMode();
  if (dryRun) {
    if (inRepo) {
      console.log(chalk.dim('\n  [dry-run] would pull latest from origin (git pull --rebase)'));
    } else {
      console.log(chalk.dim('\n  [dry-run] skipping git pull (not a git checkout — npm install -g handles version bump)'));
    }
  } else {
    if (inRepo) {
      console.log(chalk.dim('\n  Pulling latest from origin...'));
    } else {
      console.log(chalk.dim('\n  Skipping git pull (not a git checkout — using npm install -g for version bump)'));
    }
    const pull = runGitPull();
    if (pull.ok) {
      console.log(chalk.green(`  ✓ ${pull.message}`));
    } else {
      console.log(chalk.red(`  ✗ ${pull.message}`));
      console.log(chalk.yellow('  Update aborted — resolve git conflicts and retry.'));
      process.exit(1);
    }
  }
  console.log('');

  // 2. Show installed vs. latest versions.
  const cur = {
    opencode: currentVersion('opencode-ai'),
    bizar: currentVersion(PKG_MAIN),
    dash: currentVersion(PKG_DASH),
    plugin: currentVersion(PKG_PLUGIN),
  };
  const latest = {
    opencode: latestVersion('opencode-ai'),
    bizar: latestVersion(PKG_MAIN),
    dash: latestVersion(PKG_DASH),
    plugin: latestVersion(PKG_PLUGIN),
  };

  console.log('');
  console.log('  Installed vs. latest:');
  for (const k of COMPONENTS) {
    const label =
      k === 'plugin' ? PKG_PLUGIN :
      k === 'dash' ? PKG_DASH :
      k === 'bizar' ? PKG_MAIN :
      'opencode-ai';
    const c = cur[k] ?? '(not installed)';
    const l = latest[k] ?? '(unknown)';
    const same = c === l;
    console.log(`    ${label.padEnd(28)} ${c.padEnd(15)} → ${l}${same ? '  ✓ up to date' : '  ⤵ update available'}`);
  }
  console.log('');

  // ── Heads-up gate ───────────────────────────────────────────────────────
  // Check .bizar/PRE_PUSH_NOTES.md for active blockers or warnings before
  // allowing the update to proceed. Blocker entries require --force.
  const bizarDir = findBizarDir(process.cwd());
  if (bizarDir) {
    const headsUp = await checkHeadsUps(bizarDir);
    if (!headsUp.ok) {
      if (dryRun) {
        console.log(chalk.yellow('  Dry-run: found active blocker(s) — update would be blocked.'));
      } else if (assumeYes || subargs.includes('--force')) {
        console.log(chalk.yellow('  ⚠ Active blocker(s) present — proceeding due to --force.'));
      } else {
        console.error(chalk.red('  ✗ Active blocker(s) found in .bizar/PRE_PUSH_NOTES.md.'));
        console.error(chalk.dim('    Archive them with `bizar heads-up archive` or'));
        console.error(chalk.dim('    override with `--force`.'));
        process.exit(1);
      }
    } else if (headsUp.warningCount > 0) {
      console.log(chalk.yellow(`  ⚠ ${headsUp.warningCount} warning(s) in active heads-ups.`));
      // In automatic mode, print the warning count and continue.
      // In interactive mode, ask for confirmation.
      if (!assumeYes && !forceAll && process.stdin.isTTY) {
        try {
          const inquirer = await import('inquirer');
          const { proceed } = await inquirer.default.prompt([
            {
              type: 'confirm',
              name: 'proceed',
              message: 'Heads-up warnings exist. Continue with update?',
              default: true,
            },
          ]);
          if (!proceed) {
            console.log(chalk.yellow('  Update cancelled by user.'));
            process.exit(0);
          }
        } catch {
          // inquirer unavailable — continue anyway
        }
      }
    } else {
      console.log(chalk.green('  ✓ Heads-ups: clear'));
    }
  }
  console.log('');

  // 3. Decide what to update. Default = everything. Any missing package
  // is automatically included so a partial install gets completed.
  let selected;
  if (interactivePick && !dryRun && !forceAll && !assumeYes) {
    selected = await promptForUpdates(false);
  } else {
    // Auto-select: all components + any missing one (so a broken install
    // gets repaired automatically).
    selected = new Set(COMPONENTS);
    for (const k of COMPONENTS) {
      if (cur[k] === null && latest[k] !== null) selected.add(k);
    }
    if (interactivePick) {
      // --pick + --dry-run / --all / --yes → still update everything
      // but make the auto-selection visible so the dry-run output is
      // informative.
      console.log(chalk.dim(`  Auto-selecting all components (--pick ignored due to flags).`));
    }
  }

  if (selected.size === 0) {
    console.log(chalk.dim('  Nothing to update.'));
    return;
  }

  console.log(chalk.cyan(`  Updating: ${[...selected].join(', ')}\n`));

  const results = [];
  if (selected.has('opencode')) {
    console.log(chalk.bold('  → opencode'));
    results.push(['opencode', updateOpencode({ dryRun })]);
  }
  if (selected.has('bizar')) {
    console.log(chalk.bold(`  → ${PKG_MAIN}`));
    results.push(['bizar', updatePackage(PKG_MAIN, { dryRun })]);
  }
  if (selected.has('dash')) {
    console.log(chalk.bold(`  → ${PKG_DASH}`));
    results.push(['dash', updatePackage(PKG_DASH, { dryRun })]);
  }
  if (selected.has('plugin')) {
    console.log(chalk.bold(`  → ${PKG_PLUGIN}`));
    results.push(['plugin', updatePackage(PKG_PLUGIN, { dryRun })]);
  }

  // 4. Re-run the install script if anything relevant changed.
  const anySuccess = results.some(([, r]) => r.ok);
  if (anySuccess && (selected.has('bizar') || selected.has('plugin'))) {
    console.log('');
    if (dryRun) {
      console.log(
        chalk.dim(
          '  [dry-run] would re-run install script (bin.mjs --setup or install.sh)',
        ),
      );
    } else {
      const rerun = rerunInstallScript();
      if (rerun.ok) {
        console.log(chalk.green(`\n  ✓ ${rerun.message}`));
      } else {
        console.log(chalk.yellow(`\n  ⚠ ${rerun.message}`));
        console.log(chalk.dim('    Run `bash install.sh` from the Bizar repo manually.'));
      }
    }
  }

  // ── Install bundled skills ──────────────────────────────────────────
  console.log(chalk.bold('\n  → Installing bundled skills...'));
  const skillResults = await installSkills({ dryRun });
  const skillOk = skillResults.length === 0 || skillResults.every((r) => r.ok);

  // ── Rebuild dashboard ───────────────────────────────────────────────
  console.log(chalk.bold('\n  → Rebuilding dashboard...'));
  const dashRebuild = rebuildDashboard({ dryRun });
  if (dashRebuild.ok) {
    console.log(chalk.green(`  ✓ ${dashRebuild.message}`));
  } else {
    console.log(chalk.yellow(`  ⚠ ${dashRebuild.message}`));
  }

  // ── Test gate ───────────────────────────────────────────────────────
  console.log(chalk.bold('\n  → Running test gate...'));
  const testResult = runTestGate({ dryRun });
  if (testResult.ok) {
    console.log(chalk.green(`  ✓ ${testResult.message}`));
  } else {
    console.log(chalk.red(`  ✗ ${testResult.message}`));
  }

  // ── Restart dashboard ─────────────────────────────────────────────
  // Restart if it was running before, or if the dashboard was just rebuilt.
  if (restartAfter && (instances.dashboard || dashRebuild.ok)) {
    if (dryRun) {
      console.log('');
      console.log(chalk.dim('  [dry-run] would restart dashboard with the new code'));
    } else {
      console.log('');
      console.log(chalk.cyan('  Restarting dashboard with the new code...'));
      const res = spawnFreshDashboard({ port: instances.dashboard?.port || undefined });
      if (res.ok) {
        console.log(chalk.green(`  ✓ ${res.message}`));
      } else {
        console.log(chalk.yellow(`  ⚠ ${res.message}`));
        console.log(chalk.dim('    Start it manually with `bizar dash start --bg`.'));
      }
    }
  }

  // 6. Summary
  console.log('');
  console.log('  Summary:');
  for (const [name, r] of results) {
    const marker = r.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`    ${marker} ${name.padEnd(10)} ${r.message}`);
  }
  // Skills
  for (const sr of skillResults) {
    const marker = sr.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`    ${marker} ${'skill/skills'.padEnd(10)} ${sr.ok ? 'installed' : `failed: ${sr.skill}`}`);
  }
  if (!dashRebuild.ok) {
    console.log(`    ${chalk.yellow('⚠')} ${'dash'.padEnd(10)} ${dashRebuild.message}`);
  }
  const testMarker = testResult.ok ? chalk.green('✓') : chalk.red('✗');
  console.log(`    ${testMarker} ${'test-gate'.padEnd(10)} ${testResult.message}`);

  const allResults = [
    ...results.map(([, r]) => r),
    ...skillResults,
    dashRebuild,
    testResult,
  ];
  const anyFail = allResults.some((r) => !r.ok);
  if (anyFail) {
    console.log(chalk.yellow('\n  Some steps had issues. See messages above.'));
    if (allResults.filter((r) => !r.ok).some((r) => r.message && r.message.includes('failed'))) {
      process.exit(1);
    }
  }
  if (dryRun) {
    console.log(
      chalk.green('\n  ✓ Dry-run complete (no installs, kills, or restarts performed)\n'),
    );
    return;
  }
  console.log(chalk.green('\n  ✓ Update complete\n'));

  // 7. Post-update health check (v3.12.2). Catches a bad config merge or
  // missing files before the user discovers it via a broken opencode session.
  try {
    const { runDoctor } = await import('./doctor.mjs');
    const result = await runDoctor({ silent: true });
    if (result.failed > 0) {
      console.log('');
      console.log(
        chalk.yellow('  ⚠ Post-update health check found issues:'),
      );
      for (const r of result.results) {
        if (!r.ok) {
          console.log(chalk.red(`    ✗ ${r.name}: ${r.message}`));
        }
      }
      console.log(chalk.dim('  Run `bizar doctor` for details.'));
      process.exit(1);
    }
  } catch (err) {
    // Doctor import or runtime failure shouldn't crash the update —
    // log a hint and let the user run `bizar doctor` themselves.
    console.log(
      chalk.yellow(
        `  ⚠ Post-update health check could not run: ${err.message}`,
      ),
    );
    console.log(chalk.dim('  Run `bizar doctor` manually to verify the install.'));
  }
}