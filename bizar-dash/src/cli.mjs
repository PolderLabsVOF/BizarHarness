#!/usr/bin/env node
/**
 * src/cli.mjs
 *
 * v3.0.0 — `bizar-dash` command.
 *
 * Subcommands:
 *   start    — launch dashboard (default)
 *   stop     — kill the running dashboard
 *   status   — print port + URL of any running dashboard
 *   tui      — run the TUI dashboard
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
export { startDashboard as start, stopDashboard as stop, showStatus as status, runTui as tui };
export { startDashboard, stopDashboard, showStatus, runTui, startInBackground };

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
