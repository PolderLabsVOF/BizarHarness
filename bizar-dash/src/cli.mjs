#!/usr/bin/env node
/**
 * src/cli.mjs
 *
 * v3.0.0 — `bizar-dash` command.
 *
 * v3.20.7 — Added `cleanup` subcommand and duplicate-dashboard detection.
 * Running `bizar dash start` while another dashboard (on any port in
 * the default range) is already serving will refuse and point at
 * `cleanup` unless `--force` is given. Solves the "dashboard on
 * port 4321 won't go away" zombie problem.
 *
 * Subcommands:
 *   start    — launch dashboard (default)
 *   stop     — kill the running dashboard
 *   status   — print port + URL of any running dashboard
 *   tui      — run the TUI dashboard
 *   cleanup  — find and kill zombie / orphan dashboards (keeps canonical)
 *   --no-web — TUI only (no browser)
 *   --web-only — web only
 *   --bg, --detach — start in background and return
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import {
  findAllDashboards,
  killDashboard,
  clearCanonicalFiles,
  waitForExit,
  summarize,
} from './cli/dashboard-ports.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Use %APPDATA%\bizar on Windows, ~/.config/bizar on Unix.
const BIZAR_HOME = process.platform === 'win32'
  ? join(process.env.APPDATA || homedir(), 'bizar')
  : join(homedir(), '.config', 'bizar');
const PORT_FILE = join(BIZAR_HOME, 'dashboard.port');
const PID_FILE = join(BIZAR_HOME, 'dashboard.pid');
const DEFAULT_PORT = 4321;

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg?.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function showHelp() {
  console.log(`
  bizar — Web + TUI dashboard for the Bizar agent platform

  Usage:
    bizar                    Launch the dashboard (default = web)
    bizar start              Start the dashboard in this process
    bizar stop               Kill the running dashboard
    bizar status             Show port + URL of any running dashboard
    bizar cleanup            Find and kill zombie / orphan dashboards
    bizar tui [--no-web]     Run the TUI dashboard
    bizar --bg, --detach     Start in background, return to shell
    bizar --web-only         Web dashboard only (no TUI)
    bizar --no-web           TUI only (no browser)
    bizar --help             Show this help

  Notes:
    The dashboard reads your opencode config at
    ~/.config/opencode/. The per-project state lives in
    ~/.config/opencode/projects/<id>/. Mods are installed to
    ~/.config/bizar/mods/.

  Install:
    npm install -g @polderlabs/bizar-dash
    npm install -g @polderlabs/bizar    # required peer
  `);
}

async function findFreePort(preferred) {
  const net = await import('node:net');
  for (let p = preferred; p < preferred + 100; p++) {
    if (await isPortFree(net, p)) return p;
  }
  throw new Error(`no free port in range ${preferred}..${preferred + 99}`);
}

function isPortFree(net, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    server.once('error', () => finish(false));
    server.once('listening', () => server.close(() => finish(true)));
    const t = setTimeout(() => finish(false), 1000);
    server.listen(port, '127.0.0.1', () => clearTimeout(t));
  });
}

async function startDashboard({ port, projectRoot, opencodeConfigDir, bizarRoot, bg = false } = {}) {
  const { createServer } = await import('./server/server.mjs');
  const { launchBrowser } = await import('./server/browser.mjs');

  // v3.20.7 — Detect duplicate dashboards BEFORE binding the port.
  // If another dashboard is already serving (on any port in the
  // default range), refuse to start unless --force. This prevents
  // the "two dashboards, one is a zombie" deadlock.
  const force = process.argv.includes('--force') || process.argv.includes('-f');
  if (!force) {
    const existing = await findAllDashboards();
    const others = existing.filter((i) => i.state === 'healthy' && i.pid !== process.pid);
    if (others.length > 0) {
      console.error('  ✗ Another Bizar dashboard is already running.');
      console.error('');
      for (const inst of others) {
        const port = inst.port ? `:${inst.port}` : '';
        console.error(`    pid ${inst.pid}${port}  [${inst.state}]  ${inst.cmdline.slice(0, 80)}`);
      }
      console.error('');
      console.error('  To replace it, run `bizar dash cleanup` first, or pass');
      console.error('  --force to skip this check.');
      console.error('  To stop the canonical one, use `bizar dash stop`.');
      process.exit(1);
    }
  }

  const usePort = port || (await findFreePort(DEFAULT_PORT));
  const { server, close } = await createServer({
    port: usePort,
    projectRoot: projectRoot || process.cwd(),
    opencodeConfigDir: opencodeConfigDir || (
      process.platform === 'win32'
        ? join(process.env.APPDATA || homedir(), 'opencode')
        : join(homedir(), '.config', 'opencode')
    ),
    bizarRoot: bizarRoot || join(__dirname, '..', '..'),
  });

  // v3.6.0 — Default bind is localhost (more secure). Operators
  // exposing the dashboard over Tailscale or LAN can override with
  // BIZAR_DASHBOARD_BIND=0.0.0.0 (the auth.mjs token will then gate
  // the surface).
  const bindHost = process.env.BIZAR_DASHBOARD_BIND || '127.0.0.1';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(usePort, bindHost, () => {
      server.off('error', reject);
      resolve();
    });
  });

  mkdirSync(BIZAR_HOME, { recursive: true });
  writeFileSync(PORT_FILE, String(usePort), 'utf8');
  writeFileSync(PID_FILE, String(process.pid), 'utf8');

  // v3.6.0 — Surface the bind in the URL hint so the operator can see
  // whether they're bound to localhost only or to all interfaces.
  const url = bindHost === '127.0.0.1' || bindHost === 'localhost'
    ? `http://localhost:${usePort}/`
    : `http://${bindHost}:${usePort}/`;
  console.log(`Bizar dashboard: ${url} (bind: ${bindHost})`);
  if (!bg) {
    // Foreground mode: try to launch the browser; then block on a
    // signal so the process keeps running until the operator hits
    // Ctrl-C (or `bizar stop`).
    launchBrowser(url).catch(() => {});
    console.log('Press Ctrl-C to stop the dashboard.');
    let shuttingDown = false;
    const cleanup = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      try { close(); } catch { /* ignore */ }
      try { unlinkSync(PORT_FILE); } catch { /* ignore */ }
      try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    };
    const handleSignal = () => {
      cleanup();
      process.exit(0);
    };
    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);
    await new Promise(() => {});
    return { url, port: usePort, close };
  }
  // Background mode: do NOT launch a browser (the caller already detached),
  // do NOT block on a signal. The caller (detachAfterBoot) decides how to
  // keep this process alive (or not) once we return.
  return { url, port: usePort, close };
}

/**
 * Called after startDashboard returns in background mode. The server is
 * listening and the PID/PORT files are written. We intentionally keep
 * the process alive (a Node process with nothing keeping it busy exits
 * once the event loop is empty), but detach stdio and ignore signals so
 * the launching shell can exit cleanly while the dashboard keeps
 * serving.
 */
function detachAfterBoot() {
  console.log(`Detached. Use 'bizar dash stop' to terminate, 'bizar dash status' to check.`);
  // Don't exit — the server keeps the event loop busy. But stop
  // responding to stdin so the parent shell can close.
  if (process.stdin && process.stdin.pause) process.stdin.pause();
}

async function startInBackground(args) {
  const binPath = join(__dirname, 'cli.mjs');
  const child = spawn(process.execPath, [binPath, ...args], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: process.env,
  });
  child.on('error', (err) => {
    console.error(`Failed to start background dashboard: ${err.message}`);
  });
  child.unref();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (existsSync(PORT_FILE)) {
    const port = readFileSync(PORT_FILE, 'utf8').trim();
    console.log(`Bizar dashboard started in background on http://localhost:${port}/`);
    console.log(`Use 'bizar status' to check, 'bizar stop' to stop.`);
  } else {
    console.log('Bizar dashboard starting in background (port file not yet written)...');
  }
}

/**
 * v3.20.7 — Find and kill every non-canonical dashboard. Keeps the
 * canonical one (PID file) intact. Useful when a previous start left
 * a zombie behind, or when an old dashboard on a different port is
 * still serving.
 */
async function cleanupDashboards({ force = false, signal = 'SIGTERM' } = {}) {
  const instances = await findAllDashboards();
  if (instances.length === 0) {
    console.log('No dashboards detected.');
    return 0;
  }
  console.log(summarize(instances));
  console.log('');

  // Strategy:
  //   - Always kill zombies (PID alive, port unreachable to /api/health)
  //   - Always kill orphans (port responds but no PID file knows about it)
  //   - Kill healthy non-canonical duplicates unless --force-with-canonical
  //   - Never kill the canonical PID (the user can `bizar dash stop` it)
  const canonical = instances.find((i) => i.isCanonical && i.pid);
  const targets = instances.filter((i) => {
    if (i.pid && i.pid === canonical?.pid) return false; // never kill canonical
    if (i.state === 'zombie' || i.state === 'orphan') return true;
    if (i.state === 'dead') return true; // dead PIDs just need their canonical files cleared
    if (i.state === 'healthy' && !i.isCanonical && force) return true;
    if (i.state === 'healthy' && !i.isCanonical) return false; // skip by default
    return false;
  });

  if (targets.length === 0) {
    console.log('Nothing to clean up. Use --force to also kill healthy non-canonical duplicates.');
    // Still clear canonical files if PID is dead
    if (canonical && !existsSync(`/proc/${canonical.pid}`)) {
      console.log(`Canonical PID ${canonical.pid} is dead — clearing stale port file.`);
      clearCanonicalFiles();
    }
    return 0;
  }

  let killed = 0;
  for (const inst of targets) {
    if (inst.pid) {
      console.log(`  Killing pid ${inst.pid} (${inst.state}, port ${inst.port || '?'}) — ${signal}`);
      const ok = killDashboard(inst.pid, signal);
      if (ok) killed += 1;
    } else if (inst.state === 'orphan') {
      // No PID — port is held by a process we don't know. Tell the user.
      console.log(`  Orphan on port ${inst.port}: no PID file claims it. Use 'lsof -i :${inst.port}' or 'fuser ${inst.port}/tcp' to find the owner.`);
    } else if (inst.state === 'dead') {
      console.log(`  Dead PID ${inst.pid} — clearing stale port/pid files.`);
      clearCanonicalFiles(inst.pid);
    }
  }

  // If we sent SIGTERM, wait briefly for graceful exit then SIGKILL stragglers.
  if (signal === 'SIGTERM' && killed > 0) {
    const pids = targets.filter((t) => t.pid).map((t) => t.pid);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    for (const pid of pids) {
      try {
        process.kill(pid, 0); // still alive?
        // Yes — escalate to SIGKILL
        console.log(`  Escalating to SIGKILL for pid ${pid}`);
        killDashboard(pid, 'SIGKILL');
      } catch {
        // already exited — good
      }
    }
  }

  // Clear canonical files if the canonical PID is dead.
  if (canonical && !existsSync(`/proc/${canonical.pid}`)) {
    console.log(`Canonical PID ${canonical.pid} is dead — clearing stale port file.`);
    clearCanonicalFiles();
  }

  console.log('');
  console.log(`Cleaned up ${killed} dashboard${killed === 1 ? '' : 's'}.`);
  return killed;
}

async function stopDashboard() {
  if (!existsSync(PID_FILE)) {
    console.log('No Bizar dashboard is running.');
    return;
  }
  const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
  if (!Number.isFinite(pid)) {
    console.log(`Bad PID file: ${PID_FILE}`);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped Bizar dashboard (pid ${pid}).`);
  } catch (err) {
    console.log(`Could not stop dashboard (pid ${pid}): ${err.message}`);
  }
  try { unlinkSync(PORT_FILE); } catch { /* ignore */ }
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
}

function showStatus() {
  if (existsSync(PORT_FILE)) {
    const port = readFileSync(PORT_FILE, 'utf8').trim();
    console.log(`Bizar dashboard is running at http://localhost:${port}/`);
    if (existsSync(PID_FILE)) {
      console.log(`PID: ${readFileSync(PID_FILE, 'utf8').trim()}`);
    }
  } else {
    console.log('No Bizar dashboard is running. Use: bizar start');
  }
}

async function runTui({ launchWeb } = {}) {
  const { createServer } = await import('./server/server.mjs');
  const { launchBrowser } = await import('./server/browser.mjs');
  const { launchTui } = await import('./server/tui.mjs');

  const port = await findFreePort(DEFAULT_PORT);
  const { server, close: closeServer } = await createServer({
    port,
    projectRoot: process.cwd(),
    opencodeConfigDir: (
      process.platform === 'win32'
        ? join(process.env.APPDATA || homedir(), 'opencode')
        : join(homedir(), '.config', 'opencode')
    ),
    bizarRoot: join(__dirname, '..', '..'),
  });
  // v3.6.0 — Honor BIZAR_DASHBOARD_BIND same as startDashboard.
  const bindHost = process.env.BIZAR_DASHBOARD_BIND || '127.0.0.1';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, bindHost, () => {
      server.off('error', reject);
      resolve();
    });
  });
  mkdirSync(BIZAR_HOME, { recursive: true });
  writeFileSync(PORT_FILE, String(port), 'utf8');
  writeFileSync(PID_FILE, String(process.pid), 'utf8');

  if (launchWeb) {
    const url = `http://localhost:${port}/`;
    launchBrowser(url).catch(() => {});
    console.log(`Web dashboard: ${url}`);
  }

  try {
    await launchTui({ port });
  } finally {
    try { closeServer(); } catch { /* ignore */ }
    try { unlinkSync(PORT_FILE); } catch { /* ignore */ }
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
  }
}

// ── Exports (in-process use by `bizar` via @polderlabs/bizar-dash/dash-cli) ──
export { startDashboard as start, stopDashboard as stop, showStatus as status, runTui as tui, cleanupDashboards as cleanup };
export { startDashboard, stopDashboard, showStatus, runTui, startInBackground, cleanupDashboards };

function isMainEntry() {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

// ── CLI dispatch (only when this file is the entry point) ────────────────────
// When `bizar` imports this file in-process, import.meta.url does not match
// process.argv[1], so none of the code below runs.
async function main() {
  const args = process.argv.slice(2);

  // Install CLI-level signal handlers ONLY when running as a CLI entry point.
  // When imported in-process, the parent process owns its signals.
  process.on('SIGINT', () => {
    stopDashboard().finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    stopDashboard().finally(() => process.exit(0));
  });

  // Parse --port and --bind from CLI args (v3.11.1 — was missing)
  const portArgIdx = args.indexOf('--port');
  const portArg = portArgIdx >= 0 ? parseInt(args[portArgIdx + 1], 10) : undefined;
  const bindArgIdx = args.indexOf('--bind');
  const bindArg = bindArgIdx >= 0 ? args[bindArgIdx + 1] : undefined;
  const portOpts = {};
  if (Number.isFinite(portArg)) portOpts.port = portArg;
  if (bindArg) process.env.BIZAR_DASHBOARD_BIND = bindArg;

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
  } else if (args.includes('--version') || args.includes('-v')) {
    console.log(readVersion());
  } else if (args[0] === 'stop') {
    await stopDashboard();
  } else if (args[0] === 'status') {
    showStatus();
  } else if (args[0] === 'cleanup') {
    // v3.20.7 — `bizar dash cleanup` finds and kills zombie/orphan
    // dashboards. --force also kills healthy non-canonical duplicates.
    // --kill escalates to SIGKILL.
    const force = args.includes('--force') || args.includes('-f');
    const kill = args.includes('--kill');
    await cleanupDashboards({ force, signal: kill ? 'SIGKILL' : 'SIGTERM' });
  } else if (args[0] === 'tui') {
    const rest = args.slice(1);
    const skipWeb = rest.includes('--no-web');
    await runTui({ launchWeb: !skipWeb });
  } else if (args[0] === 'start' && (args.includes('--bg') || args.includes('--detach'))) {
    // `bizar start --bg` (or --detach) — start in background and return.
    // MUST be matched before the plain `start` branch or the --bg flag
    // is ignored and we run the dashboard in the foreground.
    const portIdx = args.indexOf('--port');
    const bgPort = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : undefined;
    const bgOpts = { bg: true, ...(Number.isFinite(bgPort) ? { port: bgPort } : {}) };
    await startDashboard(bgOpts).then(() => detachAfterBoot());
  } else if (args.includes('--bg') || args.includes('--detach')) {
    // Bare `bizar --bg` / `bizar --detach` — same intent.
    await startDashboard({ bg: true }).then(() => detachAfterBoot());
  } else if (args.includes('--web-only')) {
    await startDashboard(portOpts);
  } else if (args[0] === 'start' || args.length === 0) {
    await startDashboard(portOpts);
  } else {
    showHelp();
  }
}

if (isMainEntry()) {
  main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
