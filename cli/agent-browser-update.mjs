/**
 * cli/agent-browser-update.mjs
 *
 * v6.0.0 — Install / update / verify the `agent-browser` CLI.
 *
 * `agent-browser` is a native Rust CLI from vercel-labs (~38K★) that
 * gives Bizar agents a complete browser-automation surface:
 *   - 100+ typed CLI commands (open, snapshot, click, fill, screenshot, ...)
 *   - Native MCP stdio server (`agent-browser mcp`)
 *   - Self-healing snapshot-based element refs (`@e2`)
 *   - Plugin system (vault, recorder, ...)
 *   - Vercel AI SDK + AI Gateway integration
 *
 * This module is the single source of truth for installing and
 * updating `agent-browser`. It is used by:
 *   - cli/install.mjs (during `bizar install`)
 *   - cli/provision.mjs (during `bizar update`)
 *   - cli/agent-browser-up.sh (the bash idempotent starter; on first
 *     run it shells to `npm install -g agent-browser` if the binary
 *     is missing — this module is the rich equivalent)
 *
 * Public API:
 *   detectState()       probe what's installed without modifying
 *   install(opts)       install + download Chrome for Testing
 *   update(opts)        upgrade to the latest version
 *   ensureRunning()     bring the daemon up if it's down
 *   printStatus()       one-line status for the user
 *
 * All functions are idempotent and safe to re-run.
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';

const DEFAULT_DAEMON_PORT = 9223;
const DEFAULT_PROFILE_DIR = join(homedir(), '.agent-browser', 'profile');

// ── detection ──────────────────────────────────────────────────────────

/**
 * Probe the current agent-browser install without modifying anything.
 *
 * Returns a structured state object:
 *   {
 *     installed: boolean,
 *     version: string | null,
 *     chromeReady: boolean,
 *     daemonRunning: boolean,
 *     profileDir: string,
 *     daemonPort: number,
 *   }
 */
export function detectState() {
  const state = {
    installed: false,
    version: null,
    chromeReady: false,
    daemonRunning: false,
    profileDir: DEFAULT_PROFILE_DIR,
    daemonPort: DEFAULT_DAEMON_PORT,
    bin: null,
  };

  // 1. Find the binary
  const bin = findAgentBrowserBin();
  state.bin = bin;
  if (!bin) return state;

  // 2. Get the version
  try {
    const out = execSync(`"${bin}" --version`, { encoding: 'utf8', timeout: 5_000 }).trim();
    state.version = out;
    state.installed = true;
  } catch {
    return state;
  }

  // 3. Check Chrome for Testing
  const chromeDir = join(homedir(), '.cache', 'agent-browser', 'chrome');
  if (existsSync(chromeDir)) state.chromeReady = true;

  // 4. Check daemon (read env on every call so tests can override)
  const port = parseInt(process.env.AGENT_BROWSER_PORT ?? String(DEFAULT_DAEMON_PORT), 10);
  state.daemonPort = port;
  state.daemonRunning = isDaemonUp(port);

  return state;
}

function findAgentBrowserBin() {
  // 1. Explicit override
  if (process.env.AGENT_BROWSER_BIN && existsSync(process.env.AGENT_BROWSER_BIN)) {
    return process.env.AGENT_BROWSER_BIN;
  }
  // 2. Well-known npm-global locations
  const candidates = [
    '/usr/local/bin/agent-browser',
    '/opt/homebrew/bin/agent-browser',
    join(homedir(), '.local', 'bin', 'agent-browser'),
    join(homedir(), '.npm', 'bin', 'agent-browser'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // 3. PATH lookup
  try {
    const r = execSync('command -v agent-browser', { encoding: 'utf8', timeout: 2_000 }).trim();
    if (r && existsSync(r)) return r;
  } catch {
    // fall through
  }
  return null;
}

function isDaemonUp(port) {
  try {
    execSync(
      `curl -fsS --max-time 1 "http://127.0.0.1:${port}/json/version" >/dev/null 2>&1`,
      { shell: '/bin/bash', timeout: 2_000 },
    );
    return true;
  } catch {
    return false;
  }
}

// ── install / update ───────────────────────────────────────────────────

/**
 * Install agent-browser. Idempotent: skips steps that are already
 * complete. Returns the updated state.
 *
 * @param {object} opts
 * @param {boolean} [opts.silent=false]   suppress info output (for CI)
 * @param {boolean} [opts.dryRun=false]   print actions, make no changes
 * @param {string}  [opts.channel='latest']  npm dist-tag (e.g. 'beta')
 * @param {boolean} [opts.startDaemon=true]   start the daemon after install
 */
export function install(opts = {}) {
  const { silent = false, dryRun = false, channel = 'latest', startDaemon = true } = opts;
  const log = silent ? () => {} : (msg) => console.log(chalk.cyan('  → ') + msg);

  const before = detectState();
  if (before.installed) {
    log(`agent-browser ${before.version} already installed at ${before.bin}`);
    if (startDaemon && !before.daemonRunning) {
      log('daemon is down — bringing it up');
      ensureRunning({ silent, dryRun });
    }
    return detectState();
  }

  log(`Installing agent-browser from npm (channel: ${channel})...`);
  if (dryRun) {
    log(`[DRY RUN] would run: npm install -g agent-browser@${channel}`);
    // In dry-run, the binary may not be on PATH. Just return the
    // current state (which includes installed=false) without checking
    // for the after-install state.
    return detectState();
  } else {
    const r = spawnSync('npm', ['install', '-g', `agent-browser@${channel}`], {
      stdio: silent ? 'ignore' : 'inherit',
      timeout: 180_000,
    });
    if (r.status !== 0) {
      throw new Error(`npm install -g agent-browser@${channel} failed (exit ${r.status})`);
    }
  }

  const after = detectState();
  if (!after.installed) {
    throw new Error('agent-browser still not on PATH after install');
  }
  log(`agent-browser ${after.version} installed`);

  log('Downloading Chrome for Testing...');
  if (!dryRun) {
    const r = spawnSync(after.bin, ['install'], {
      stdio: silent ? 'ignore' : 'inherit',
      timeout: 300_000,
    });
    if (r.status !== 0) {
      log(chalk.yellow('Chrome download failed — you can retry with `agent-browser install`'));
    }
  }

  if (startDaemon) {
    ensureRunning({ silent, dryRun });
  }
  return detectState();
}

/**
 * Update agent-browser to the latest version. Idempotent.
 *
 * Same shape as install() but uses `agent-browser upgrade` after the
 * first install (which knows how to detect the install method and run
 * the right update command).
 */
export function update(opts = {}) {
  const { silent = false, dryRun = false, channel = 'latest', startDaemon = true } = opts;
  const log = silent ? () => {} : (msg) => console.log(chalk.cyan('  → ') + msg);

  const before = detectState();
  if (!before.installed) {
    log('agent-browser not installed — calling install()');
    return install(opts);
  }

  log(`agent-browser ${before.version} is installed. Upgrading to ${channel}...`);
  if (dryRun) {
    log(`[DRY RUN] would run: agent-browser upgrade`);
    return detectState();
  } else {
    // First, try `agent-browser upgrade` (the self-updater). If it
    // doesn't exist (older version), fall back to `npm update -g`.
    const r = spawnSync(before.bin, ['upgrade'], {
      stdio: silent ? 'ignore' : 'inherit',
      timeout: 180_000,
    });
    if (r.status !== 0) {
      log('`agent-browser upgrade` failed — falling back to `npm update -g`');
      const r2 = spawnSync('npm', ['update', '-g', `agent-browser@${channel}`], {
        stdio: silent ? 'ignore' : 'inherit',
        timeout: 180_000,
      });
      if (r2.status !== 0) {
        throw new Error(`npm update -g agent-browser@${channel} failed (exit ${r2.status})`);
      }
    }
  }

  const after = detectState();
  if (after.version === before.version) {
    log(`agent-browser already at latest (${after.version})`);
  } else {
    log(`agent-browser updated: ${before.version} → ${after.version}`);
  }

  if (startDaemon && !after.daemonRunning) {
    ensureRunning({ silent, dryRun });
  }
  return after;
}

// ── daemon management ──────────────────────────────────────────────────

/**
 * Bring the agent-browser daemon up if it's down. Idempotent.
 *
 * On macOS, Linux, and Windows, the daemon is started as a background
 * process using `agent-browser serve`. On success, the daemon listens
 * on `http://127.0.0.1:<port>` and is reachable via the typed CLI
 * and the MCP stdio server.
 */
export function ensureRunning(opts = {}) {
  const { silent = false, dryRun = false } = opts;
  const log = silent ? () => {} : (msg) => console.log(chalk.cyan('  → ') + msg);

  const state = detectState();
  if (!state.installed) {
    log('agent-browser is not installed — call install() first');
    return state;
  }
  if (state.daemonRunning) {
    log(`daemon is up (port ${state.daemonPort})`);
    return state;
  }

  log(`starting daemon on port ${state.daemonPort}...`);
  if (dryRun) {
    log(`[DRY RUN] would run: ${state.bin} serve --port ${state.daemonPort} --headless`);
  } else {
    const r = spawnSync('nohup', [
      state.bin, 'serve',
      '--port', `${state.daemonPort}`,
      '--profile', state.profileDir,
      '--headless',
    ], {
      detached: true,
      stdio: 'ignore',
      timeout: 5_000,
    });
    if (r.error) {
      log(chalk.yellow(`daemon spawn failed: ${r.error.message}`));
    }
  }

  // Wait up to 5s for the daemon to bind
  for (let i = 0; i < 50; i++) {
    if (isDaemonUp(state.daemonPort)) {
      log(`daemon is up (port ${state.daemonPort})`);
      return detectState();
    }
    spawnSync('sleep', ['0.1']);
  }
  log(chalk.yellow('daemon did not bind within 5s — check `agent-browser doctor`'));
  return detectState();
}

// ── status ─────────────────────────────────────────────────────────────

/**
 * One-line status for the user. Returns the state object.
 */
export function printStatus() {
  const s = detectState();
  if (!s.installed) {
    console.log(chalk.yellow('  agent-browser: NOT INSTALLED'));
    console.log(chalk.dim('    Install with: npm install -g agent-browser && agent-browser install'));
  } else {
    const daemonTxt = s.daemonRunning
      ? chalk.green('running')
      : chalk.yellow('stopped');
    const chromeTxt = s.chromeReady ? chalk.green('ready') : chalk.yellow('not installed');
    console.log(`  agent-browser ${chalk.cyan(s.version)}  ·  daemon: ${daemonTxt} (port ${s.daemonPort})  ·  chrome: ${chromeTxt}`);
  }
  return s;
}
