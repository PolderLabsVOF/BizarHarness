#!/usr/bin/env node
/**
 * cli/service.mjs
 *
 * v4.4.0 — Background service daemon for Bizar.
 *
 * Subcommands:
 *   start          — spawn the service detached, return immediately
 *   stop           — kill the service
 *   status         — show running state
 *   logs           — tail the service log
 *   follow / tail  — tail the service log live
 *   install        — register with systemd / launchd / scheduled task
 *   uninstall      — unregister the OS-level autostart
 *   install --force  — re-install even when the unit matches
 *   uninstall --force — re-uninstall even when not present
 *
 * The service:
 *   - Watches per-project schedules
 *   - Ticks the task backlog (Stream B's task-delegator) when present
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
  rmSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOME = homedir();

function bizarConfigDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA
      ? join(process.env.APPDATA, 'bizar')
      : join(HOME, '.config', 'bizar');
  }
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'bizar')
    : join(HOME, '.config', 'bizar');
}

const BIZAR_HOME = bizarConfigDir();
const LOG_FILE = join(BIZAR_HOME, 'service.log');
const PID_FILE = join(BIZAR_HOME, 'service.pid');
const TICK_MS = 5_000; // 5s

function nowIso() {
  return new Date().toISOString();
}

function ensureDir() {
  mkdirSync(BIZAR_HOME, { recursive: true });
}

function removePidFile() {
  try {
    rmSync(PID_FILE, { force: true });
  } catch {
    /* ignore */
  }
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
    removePidFile();
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped Bizar service (pid ${pid}).`);
  } catch (err) {
    console.log(`Could not stop service: ${err.message}`);
  }
  removePidFile();
}

function serviceStatus() {
  // v4.4.0 — surface both the old PID-file status (so a manually-started
  // session is still observable) and the OS-level registration status
  // (systemd / launchd / schtasks). Process stays responsive with the
  // unconditional `await import`.
  const pid = readPid();
  const alive = pid && isAlive(pid);
  if (pid && !alive) {
    removePidFile();
  }
  (async () => {
    let unitInfo = null;
    try {
      const { serviceStatus: ctrlStatus } = await import('./service-controller.mjs');
      unitInfo = ctrlStatus();
    } catch {
      /* service-controller optional */
    }
    if (alive) {
      console.log(`Bizar service: running (pid ${pid})`);
      console.log(`Log: ${LOG_FILE}`);
    } else {
      console.log('Bizar service: stopped (no live PID)');
    }
    if (unitInfo) {
      const unitBit = unitInfo.unitPath
        ? `${unitInfo.installed ? 'installed' : 'partial'} (${unitInfo.unitPath})`
        : 'not registered';
      const runBit = unitInfo.running ? 'running' : 'not running';
      console.log(`Bizar OS-level unit: ${unitBit}, ${runBit}`);
    }
  })();
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
    ensureDir();
    writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch (err) {
    console.error(`Cannot write PID file ${PID_FILE}: ${err.message}`);
    process.exit(1);
  }
  logLine(`service started (pid ${process.pid})`);

  // Resolve the runner module. v4.0.0: the dashboard ships inside this package.
  // We keep legacy fallbacks for users who still have @polderlabs/bizar-dash
  // installed globally.
  const candidates = [
    // v4.0.0 primary: <repo>/bizar-dash/src/server/schedules-runner.mjs
    join(__dirname, '..', 'bizar-dash', 'src', 'server', 'schedules-runner.mjs'),
    // v4.4.0 sibling: <repo>/bizar-dash/src/server/task-delegator.mjs
    // Exported under the same runner module shape (default export) so the
    // service can call .tickBacklog() alongside .schedulesRunner.tick().
    join(__dirname, '..', 'bizar-dash', 'src', 'server', 'task-delegator.mjs'),
    // Legacy fallbacks — users with @polderlabs/bizar-dash still installed:
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
  // v4.4.0 — Probe a sibling `task-delegator.mjs` separately so the backlog
  // tick works regardless of which file won the race above. ESM namespace
  // objects are non-extensible, so we cannot mutate `runner` to attach a
  // `taskDelegator` property — instead, capture the imported module in a
  // local binding and reference it from `tick()` below.
  let taskDelegator = null;
  if (runner && runner.taskDelegator && typeof runner.taskDelegator.tickBacklog === 'function') {
    // The runner already exposes taskDelegator (e.g. task-delegator.mjs
    // resolved as the runner). Use it.
    taskDelegator = runner.taskDelegator;
  } else {
    const tdCandidates = [
      join(__dirname, '..', 'bizar-dash', 'src', 'server', 'task-delegator.mjs'),
      join(process.cwd(), 'node_modules', '@polderlabs', 'bizar-dash', 'src', 'server', 'task-delegator.mjs'),
      join(__dirname, '..', 'node_modules', '@polderlabs', 'bizar-dash', 'src', 'server', 'task-delegator.mjs'),
    ];
    for (const c of tdCandidates) {
      if (existsSync(c)) {
        try {
          const td = await import(c);
          if (td && td.taskDelegator && typeof td.taskDelegator.tickBacklog === 'function') {
            taskDelegator = td.taskDelegator;
            logLine(`using task-delegator at ${c}`);
            break;
          }
        } catch (err) {
          logLine(`failed to import task-delegator at ${c}: ${err.message}`);
        }
      }
    }
  }
  if (!runner) {
    logLine('FATAL: could not locate @polderlabs/bizar-dash/schedules-runner. Service exiting.');
    removePidFile();
    process.exit(2);
  }

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    logLine(`service stopping (pid ${process.pid})`);
    removePidFile();
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
    // v4.4.0 — Drive the task backlog. The local binding is a closure
    // capture, not an attached property, because ESM namespace objects
    // are non-extensible. The check is intentionally lazy — if Stream B's
    // task-delegator hasn't landed yet, this is a no-op.
    try {
      if (taskDelegator && typeof taskDelegator.tickBacklog === 'function') {
        const r = await taskDelegator.tickBacklog({ logLine });
        if (r && (r.promoted || r.dispatched)) {
          const promoted = r.promoted || 0;
          const dispatched = r.dispatched || 0;
          logLine(`backlog: ${promoted} promoted, ${dispatched} dispatched`);
        }
      }
    } catch (err) {
      logLine(`backlog tick error: ${err.message}`);
    }
  };

  // Run immediately, then on a 5s interval
  await tick();
  setInterval(tick, TICK_MS);
}

export async function runService(sub, _rest) {
  if (sub === '_daemon') {
    // Internal entrypoint used by the systemd / launchd / schtasks unit.
    // The OS-level unit invokes `node cli/bin.mjs service _daemon` so this
    // branch makes the dispatch round-trip work.
    await daemonLoop();
    return;
  }
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
  if (sub === 'install') {
    const { installService } = await import('./service-controller.mjs');
    const force = Array.isArray(_rest) && (_rest.includes('--force') || _rest.includes('-f'));
    const dryRun = Array.isArray(_rest) && (_rest.includes('--dry-run'));
    const r = installService({ force, dryRun });
    if (r.ok) {
      console.log(`[bizar-service] installed${r.alreadyInstalled ? ' (already)' : ''}.`);
      if (r.unitPath) console.log(`[bizar-service] unit: ${r.unitPath}`);
      if (r.note) console.log(`[bizar-service] ${r.note}`);
    } else {
      console.error(`[bizar-service] install failed: ${r.error}`);
      process.exitCode = 1;
    }
    return;
  }
  if (sub === 'uninstall') {
    const { uninstallService } = await import('./service-controller.mjs');
    const force = Array.isArray(_rest) && (_rest.includes('--force') || _rest.includes('-f'));
    const r = uninstallService();
    if (r.ok) {
      console.log(`[bizar-service] uninstalled.`);
      if (r.note) console.log(`[bizar-service] ${r.note}`);
    } else {
      console.error(`[bizar-service] uninstall failed: ${r.error}`);
      process.exitCode = 1;
    }
    return;
  }
  console.log(`
  bizar service — Manage the background service daemon

  Usage:
    bizar service start
    bizar service stop
    bizar service status
    bizar service logs
    bizar service follow
    bizar service install [--force] [--dry-run]
    bizar service uninstall [--force]

  Description:
    install / uninstall register the daemon with systemd (Linux),
    launchd (macOS), or a scheduled task (Windows) so it autostarts at
    user login. install is idempotent — when the on-disk unit matches
    the desired content, it returns without restarting the service.
    Pass --force to overwrite or to drop a stale registration.
  `);
}

// ── direct entry: when invoked as `node cli/service.mjs _daemon` ──────────
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === __filename;
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
  } else if (sub === 'install') {
    const { installService } = await import('./service-controller.mjs');
    const flags = process.argv.slice(3);
    const force = flags.includes('--force') || flags.includes('-f');
    const dryRun = flags.includes('--dry-run');
    const r = installService({ force, dryRun });
    if (r.ok) {
      console.log(`[bizar-service] installed${r.alreadyInstalled ? ' (already)' : ''}.`);
      if (r.unitPath) console.log(`[bizar-service] unit: ${r.unitPath}`);
      if (r.note) console.log(`[bizar-service] ${r.note}`);
    } else {
      console.error(`[bizar-service] install failed: ${r.error}`);
      process.exit(1);
    }
  } else if (sub === 'uninstall') {
    const { uninstallService } = await import('./service-controller.mjs');
    const flags = process.argv.slice(3);
    const force = flags.includes('--force') || flags.includes('-f');
    const r = uninstallService();
    if (r.ok) {
      console.log(`[bizar-service] uninstalled.`);
      if (r.note) console.log(`[bizar-service] ${r.note}`);
    } else {
      console.error(`[bizar-service] uninstall failed: ${r.error}`);
      process.exit(1);
    }
  } else {
    console.log(`
  bizar service — Manage the background service daemon

  Usage:
    node cli/service.mjs start
    node cli/service.mjs stop
    node cli/service.mjs status
    node cli/service.mjs logs
    node cli/service.mjs follow
    node cli/service.mjs install [--force] [--dry-run]
    node cli/service.mjs uninstall [--force]
    `);
  }
}
