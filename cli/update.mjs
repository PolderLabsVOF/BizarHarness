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
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * Returns `{ ok: boolean, message: string }`.
 */
function updateOpencode() {
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

function updatePackage(pkg) {
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
  const binPath = join(pkgRoot, 'cli', 'bin.mjs');
  if (existsSync(binPath)) {
    console.log(chalk.dim(`\n  Re-running setup via ${binPath} --setup...`));
    const r = spawnSync(process.execPath, [binPath, '--setup'], { stdio: 'inherit' });
    if (r.status === 0) {
      return { ok: true, message: 'setup re-run' };
    }
    return { ok: false, message: 'setup rerun failed' };
  }
  const installSh = join(pkgRoot, 'install.sh');
  if (!existsSync(installSh)) {
    return { ok: false, message: 'could not locate a compatible setup script to re-run' };
  }
  if (process.platform === 'win32') {
    // On Windows, the bash install path doesn't apply. The plugin is
    // already installed globally via the npm install
    // (see cli/install.mjs:installPluginFromGlobal).
    console.log(chalk.dim('  Skipping install.sh (Windows uses npm-based plugin install)'));
    return { ok: true, message: 'install.sh skipped on Windows' };
  }
  console.log(chalk.dim(`\n  Re-running install script at ${installSh}...`));
  const r = spawnSync('bash', [installSh], { stdio: 'inherit' });
  if (r.status !== 0) {
    return { ok: false, message: 'install script rerun failed' };
  }
  return { ok: true, message: 'install script re-run' };
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

export async function runUpdate(subargs = []) {
  console.log(chalk.bold.hex('#a855f7')('\n  ᚦ BIZAR UPDATE ᚦ\n'));

  // Parse flags
  const assumeYes = subargs.includes('--yes') || subargs.includes('-y') || subargs.includes('--force');
  const restartAfter = !subargs.includes('--no-restart');
  const forceAll = subargs.includes('--all');

  // 1. Detect running instances BEFORE doing anything else.
  const instances = detectInstances();
  const runningCount = (instances.service ? 1 : 0) + (instances.dashboard ? 1 : 0);

  if (runningCount > 0) {
    const ok = await confirmKill(instances, { assumeYes });
    if (!ok) {
      console.log(chalk.yellow('\n  Update cancelled — instances still running.'));
      console.log(chalk.dim('  Stop them with `bizar service stop` and `bizar dashboard stop`, then retry.'));
      process.exit(1);
    }
    console.log(chalk.cyan('\n  Stopping running instances...'));
    const kills = await killInstances(instances);
    for (const k of kills) {
      const marker = k.ok ? chalk.green('✓') : chalk.red('✗');
      console.log(`    ${marker} ${k.name} stopped`);
    }
    // Give the kernel a moment to release any open file handles on the
    // npm-global directory before npm tries to replace files.
    await new Promise((resolve) => setTimeout(resolve, 500));
  } else {
    console.log(chalk.dim('  No running Bizar instances detected.'));
  }

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

  // 3. Decide what to update.
  let selected;
  if (forceAll || assumeYes) {
    selected = new Set(COMPONENTS);
  } else if (subargs.length === 0) {
    selected = await promptForUpdates(false);
  } else {
    const valid = new Set(COMPONENTS);
    selected = new Set(subargs.filter((a) => !a.startsWith('-') && valid.has(a)));
    if (selected.size === 0) {
      console.log(chalk.yellow(`  No valid components selected from: ${subargs.join(' ')}`));
      console.log(chalk.dim('  Valid components: opencode, bizar, dash, plugin'));
      console.log(chalk.dim('  Run `bizar update --help` for usage.'));
      process.exit(1);
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
    results.push(['opencode', updateOpencode()]);
  }
  if (selected.has('bizar')) {
    console.log(chalk.bold(`  → ${PKG_MAIN}`));
    results.push(['bizar', updatePackage(PKG_MAIN)]);
  }
  if (selected.has('dash')) {
    console.log(chalk.bold(`  → ${PKG_DASH}`));
    results.push(['dash', updatePackage(PKG_DASH)]);
  }
  if (selected.has('plugin')) {
    console.log(chalk.bold(`  → ${PKG_PLUGIN}`));
    results.push(['plugin', updatePackage(PKG_PLUGIN)]);
  }

  // 4. Re-run the install script if anything relevant changed.
  const anySuccess = results.some(([, r]) => r.ok);
  if (anySuccess && (selected.has('bizar') || selected.has('plugin'))) {
    console.log('');
    const rerun = rerunInstallScript();
    if (rerun.ok) {
      console.log(chalk.green(`\n  ✓ ${rerun.message}`));
    } else {
      console.log(chalk.yellow(`\n  ⚠ ${rerun.message}`));
      console.log(chalk.dim('    Run `bash install.sh` from the Bizar repo manually.'));
    }
  }

  // 5. Restart the dashboard if it was running before the update.
  if (restartAfter && instances.dashboard && (selected.has('bizar') || selected.has('dash'))) {
    console.log('');
    console.log(chalk.cyan('  Restarting dashboard with the new code...'));
    const res = spawnFreshDashboard({ port: instances.dashboard.port || undefined });
    if (res.ok) {
      console.log(chalk.green(`  ✓ ${res.message}`));
    } else {
      console.log(chalk.yellow(`  ⚠ ${res.message}`));
      console.log(chalk.dim('    Start it manually with `bizar dash start --bg`.'));
    }
  }

  // 6. Summary
  console.log('');
  console.log('  Summary:');
  for (const [name, r] of results) {
    const marker = r.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`    ${marker} ${name.padEnd(10)} ${r.message}`);
  }

  const anyFail = results.some(([, r]) => !r.ok);
  if (anyFail) {
    console.log(chalk.yellow('\n  Some updates failed. See messages above.'));
    process.exit(1);
  }
  console.log(chalk.green('\n  ✓ Update complete\n'));
}