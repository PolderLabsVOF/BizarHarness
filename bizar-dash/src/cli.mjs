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
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BIZAR_HOME = join(homedir(), '.config', 'bizar');
const PORT_FILE = join(BIZAR_HOME, 'dashboard.port');
const PID_FILE = join(BIZAR_HOME, 'dashboard.pid');
const DEFAULT_PORT = 4321;

function showHelp() {
  console.log(`
  bizar-dash — Web + TUI dashboard for the Bizar agent platform

  Usage:
    bizar-dash                    Launch the dashboard (default = web)
    bizar-dash start              Start the dashboard in this process
    bizar-dash stop               Kill the running dashboard
    bizar-dash status             Show port + URL of any running dashboard
    bizar-dash tui [--no-web]     Run the TUI dashboard
    bizar-dash --bg, --detach     Start in background, return to shell
    bizar-dash --web-only         Web dashboard only (no TUI)
    bizar-dash --no-web           TUI only (no browser)
    bizar-dash --help             Show this help

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

async function startDashboard({ port, projectRoot, opencodeConfigDir, bizarRoot } = {}) {
  const { createServer } = await import('./server/server.mjs');
  const { launchBrowser } = await import('./server/browser.mjs');

  const usePort = port || (await findFreePort(DEFAULT_PORT));
  const { server, close } = createServer({
    port: usePort,
    projectRoot: projectRoot || process.cwd(),
    opencodeConfigDir: opencodeConfigDir || join(homedir(), '.config', 'opencode'),
    bizarRoot: bizarRoot || join(__dirname, '..', '..'),
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(usePort, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  mkdirSync(BIZAR_HOME, { recursive: true });
  writeFileSync(PORT_FILE, String(usePort), 'utf8');
  writeFileSync(PID_FILE, String(process.pid), 'utf8');

  const url = `http://localhost:${usePort}/`;
  await launchBrowser(url);
  console.log(`Bizar dashboard: ${url}`);
  console.log('Press Ctrl-C to stop the dashboard.');

  await new Promise(() => {});
  // Caller keeps the process alive
  return { url, port: usePort, close };
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
    console.log(`Use 'bizar-dash status' to check, 'bizar-dash stop' to stop.`);
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
    console.log('No Bizar dashboard is running. Use: bizar-dash start');
  }
}

async function runTui({ launchWeb } = {}) {
  const { createServer } = await import('./server/server.mjs');
  const { launchBrowser } = await import('./server/browser.mjs');
  const { launchTui } = await import('./server/tui.mjs');

  const port = await findFreePort(DEFAULT_PORT);
  const { server, close: closeServer } = createServer({
    port,
    projectRoot: process.cwd(),
    opencodeConfigDir: join(homedir(), '.config', 'opencode'),
    bizarRoot: join(__dirname, '..', '..'),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
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

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
} else if (args[0] === 'stop') {
  await stopDashboard();
} else if (args[0] === 'status') {
  showStatus();
} else if (args[0] === 'tui') {
  const rest = args.slice(1);
  const skipWeb = rest.includes('--no-web');
  await runTui({ launchWeb: !skipWeb });
} else if (args.includes('--bg') || args.includes('--detach')) {
  await startInBackground(['start']);
} else if (args.includes('--web-only')) {
  await startDashboard();
} else if (args[0] === 'start' || args.length === 0) {
  await startDashboard();
} else {
  // Default: show help if we don't understand
  showHelp();
}
