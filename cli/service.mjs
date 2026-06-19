#!/usr/bin/env node
/**
 * cli/service.mjs
 *
 * v3.0.0 — Background service daemon for Bizar.
 *
 * Subcommands:
 *   start    — spawn the service detached, return immediately
 *   stop     — kill the service
 *   status   — show running state
 *   logs     — tail the service log
 *
 * The service:
 *   - Watches per-project schedules
 *   - Fires due schedules (interval / cron / once)
 *   - Records every run in schedules.json
 *   - Logs to ~/.config/bizar/service.log
 *   - Writes its PID to ~/.config/bizar/service.pid
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOME = homedir();
const BIZAR_HOME = join(HOME, '.config', 'bizar');
const LOG_FILE = join(BIZAR_HOME, 'service.log');
const PID_FILE = join(BIZAR_HOME, 'service.pid');
const TICK_MS = 5_000; // 5s

function nowIso() {
  return new Date().toISOString();
}

function ensureDir() {
  mkdirSync(BIZAR_HOME, { recursive: true });
}

function logLine(line) {
  try {
    ensureDir();
    appendFileSync(LOG_FILE, `[${nowIso()}] ${line}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startService() {
  const existing = readPid();
  if (existing && isAlive(existing)) {
    console.log(`Service already running (pid ${existing}).`);
    return;
  }
  // Spawn detached child
  const child = spawn(process.execPath, [__filename, '_daemon'], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: process.env,
  });
  child.on('error', (err) => {
    console.error(`Failed to start service: ${err.message}`);
  });
  child.unref();
  await new Promise((r) => setTimeout(r, 800));
  const pid = readPid();
  if (pid && isAlive(pid)) {
    console.log(`Bizar service started (pid ${pid}).`);
    console.log(`Log: ${LOG_FILE}`);
  } else {
    console.log('Service start command issued, but PID not yet alive. Check the log.');
  }
}

function stopService() {
  const pid = readPid();
  if (!pid) {
    console.log('No Bizar service is running.');
    return;
  }
  if (!isAlive(pid)) {
    console.log(`Stale PID file (pid ${pid} not running). Cleaning up.`);
    try { writeFileSync(PID_FILE, ''); } catch { /* ignore */ }
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped Bizar service (pid ${pid}).`);
  } catch (err) {
    console.log(`Could not stop service: ${err.message}`);
  }
  try {
    writeFileSync(PID_FILE, '');
  } catch { /* ignore */ }
}

function serviceStatus() {
  const pid = readPid();
  if (!pid) {
    console.log('Bizar service: stopped (no PID file)');
    return;
  }
  if (!isAlive(pid)) {
    console.log(`Bizar service: stopped (stale PID file: ${pid})`);
    return;
  }
  console.log(`Bizar service: running (pid ${pid})`);
  console.log(`Log: ${LOG_FILE}`);
}

function tailLogs(follow) {
  if (!existsSync(LOG_FILE)) {
    console.log('(no log file yet)');
    return;
  }
  // Read the last 50 lines synchronously; if --follow, switch to a tail
  // loop.
  const text = readFileSync(LOG_FILE, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const tail = lines.slice(-50).join('\n');
  console.log(tail);
  if (follow) {
    console.log('--- following log (Ctrl-C to exit) ---');
    let pos = text.length;
    setInterval(() => {
      try {
        const cur = readFileSync(LOG_FILE, 'utf8');
        if (cur.length > pos) {
          process.stdout.write(cur.slice(pos));
          pos = cur.length;
        }
      } catch {
        /* ignore */
      }
    }, 1000);
  }
}

/**
 * The actual daemon loop. Imports the runner from the bizarre-dash package
 * via a relative path (so this file works without npm packaging).
 */
async function daemonLoop() {
  try {
    writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch (err) {
    console.error(`Cannot write PID file ${PID_FILE}: ${err.message}`);
    process.exit(1);
  }
  logLine(`service started (pid ${process.pid})`);

  // Resolve the runner module. The daemon lives in the bizar package;
  // the runner lives in the bizarre-dash package. We try a few candidate
  // paths so this works whether bizarre-dash is installed globally,
  // locally, or alongside the source tree (development).
  const candidates = [
    // dev: <repo>/bizar-dash/src/server/schedules-runner.mjs
    join(__dirname, '..', 'bizar-dash', 'src', 'server', 'schedules-runner.mjs'),
    // npm-global fallback
    join(HOME, '.npm-global', 'lib', 'node_modules', '@polderlabs', 'bizar-dash', 'src', 'server', 'schedules-runner.mjs'),
  ];
  // Probe $PWD and global node_modules
  try {
    const { execSync } = await import('node:child_process');
    const root = execSync('npm root -g', { encoding: 'utf8', timeout: 5000 }).trim();
    candidates.push(join(root, '@polderlabs', 'bizar-dash', 'src', 'server', 'schedules-runner.mjs'));
  } catch {
    /* ignore */
  }
  // local node_modules (cwd)
  candidates.push(join(process.cwd(), 'node_modules', '@polderlabs', 'bizar-dash', 'src', 'server', 'schedules-runner.mjs'));
  // local node_modules of this package
  candidates.push(join(__dirname, '..', 'node_modules', '@polderlabs', 'bizar-dash', 'src', 'server', 'schedules-runner.mjs'));
  // also try the parent (when service lives inside a subdir)
  candidates.push(join(__dirname, '..', '..', 'node_modules', '@polderlabs', 'bizar-dash', 'src', 'server', 'schedules-runner.mjs'));

  let runner = null;
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        runner = await import(c);
        logLine(`using runner at ${c}`);
        break;
      } catch (err) {
        logLine(`failed to import runner at ${c}: ${err.message}`);
      }
    }
  }
  if (!runner) {
    logLine('FATAL: could not locate @polderlabs/bizar-dash/schedules-runner. Service exiting.');
    try { writeFileSync(PID_FILE, ''); } catch { /* ignore */ }
    process.exit(2);
  }

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    logLine(`service stopping (pid ${process.pid})`);
    try { writeFileSync(PID_FILE, ''); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const tick = async () => {
    try {
      const fired = await runner.schedulesRunner.tick();
      if (Array.isArray(fired) && fired.length) {
        logLine(`tick fired ${fired.length} schedule(s)`);
      }
    } catch (err) {
      logLine(`tick error: ${err.message}`);
    }
  };

  // Run immediately, then on a 5s interval
  await tick();
  setInterval(tick, TICK_MS);
}

export async function runService(sub, _rest) {
  if (sub === 'start') {
    await startService();
    return;
  }
  if (sub === 'stop') {
    stopService();
    return;
  }
  if (sub === 'status') {
    serviceStatus();
    return;
  }
  if (sub === 'logs') {
    tailLogs(false);
    return;
  }
  if (sub === 'follow' || sub === 'tail') {
    tailLogs(true);
    return;
  }
  console.log(`
  bizar service — Manage the background service daemon

  Usage:
    bizar service start
    bizar service stop
    bizar service status
    bizar service logs
  `);
}

// ── direct entry: when invoked as `node cli/service.mjs _daemon` ──────────
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const sub = process.argv[2];
  if (sub === '_daemon') {
    // Run the daemon loop — never returns
    await daemonLoop();
  } else if (sub === 'stop') {
    stopService();
  } else if (sub === 'status') {
    serviceStatus();
  } else if (sub === 'logs') {
    tailLogs(false);
  } else if (sub === 'start') {
    await startService();
  } else {
    console.log(`
  bizar service — Manage the background service daemon

  Usage:
    node cli/service.mjs start
    node cli/service.mjs stop
    node cli/service.mjs status
    node cli/service.mjs logs
    `);
  }
}
