#!/usr/bin/env node
/**
 * cli/service-controller.mjs
 *
 * v4.4.0 — Platform-aware install/uninstall for the Bizar background service.
 *
 * Registers the existing `bizar service _daemon` daemon under the OS-level
 * init system so the service autostarts on user login. Implemented with
 * explicit per-platform code paths so the controller stays small and
 * auditable:
 *
 *   linux   — systemd user unit at $XDG_CONFIG_HOME/systemd/user/bizar.service
 *   darwin  — launchd plist at ~/Library/LaunchAgents/com.bizar.dashboard.plist
 *   win32   — wrapper cmd file + Scheduled Task (`BizarDashboardService`,
 *             ONSTART, HIGHEST)
 *
 * Design notes:
 *
 *   * `install` is idempotent. When the on-disk unit already matches the
 *     would-be content, we return `{ok: true, alreadyInstalled: true}` and
 *     skip the shell-out entirely.
 *   * The cline password is never written into the unit file. Runtime
 *     secrets come from a 0600 env file (`~/.config/bizar/service.env`).
 *   * All process spawning uses `spawnSync(command, args, {shell: false})`
 *     with explicit arg arrays. There is no string concatenation into a
 *     shell anywhere.
 *   * No function in this module throws. Every public function returns a
 *     `{ok: boolean, ...}` shape. Callers branch on `ok`.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  unlinkSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bizarConfigDir } from './utils.mjs';
import { buildServiceEnvFile } from './service-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOME = homedir();
const PLATFORM = platform();

// ── Path helpers ──────────────────────────────────────────────────────────────

function userUnitDir() {
  if (PLATFORM === 'win32') return null;
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'systemd', 'user')
    : join(HOME, '.config', 'systemd', 'user');
}

function launchAgentsDir() {
  return join(HOME, 'Library', 'LaunchAgents');
}

const DEFAULT_NODE_PATH = process.execPath;
const REPO_ROOT = resolve(__dirname, '..');

// ── spawn helper ──────────────────────────────────────────────────────────────

/**
 * Run an external command with explicit arg array. No shell. Strict 15s budget.
 * Returns {status, stdout, stderr, error} where `status` is the exit code
 * (or null on spawn failure) and `error` is a non-null Error object only when
 * the child could not even be spawned.
 */
function runCmd(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: 15_000,
    shell: false,
    windowsHide: true,
    ...opts,
  });
  return {
    status: r.status,
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
    stderr: typeof r.stderr === 'string' ? r.stderr : '',
    error: r.error || null,
  };
}

function ok(extra = {}) {
  return { ok: true, ...extra };
}
function fail(error, extra = {}) {
  return { ok: false, error: String(error), ...extra };
}

// ── platform-specific path factories ──────────────────────────────────────────

function linuxUnitPath() {
  return join(userUnitDir(), 'bizar.service');
}
function linuxEnvPath() {
  return join(bizarConfigDir(), 'service.env');
}
function darwinPlistPath() {
  return join(launchAgentsDir(), 'com.bizar.dashboard.plist');
}
function windowsCmdPath() {
  return join(bizarConfigDir(), 'bizar-service.cmd');
}

// ── Path resolvers (override + defaults) ──────────────────────────────────────

function resolveRepoRoot(override) {
  if (!override) return REPO_ROOT;
  if (isAbsolute(override)) return override;
  return resolve(process.cwd(), override);
}

function resolveNodePath(override) {
  return override || DEFAULT_NODE_PATH;
}

// ── unit/plist/cmd path per platform ──────────────────────────────────────────

export function serviceUnitPath(opts = {}) {
  // projectRoot is currently informational — different platforms stash the
  // unit file in OS-defined dirs that don't depend on the repo. We keep the
  // parameter for cross-platform symmetry and so dry-run output is stable.
  resolveRepoRoot(opts.projectRoot);
  if (PLATFORM === 'linux') return linuxUnitPath();
  if (PLATFORM === 'darwin') return darwinPlistPath();
  if (PLATFORM === 'win32') return windowsCmdPath();
  return null;
}

// ── linux: systemd user unit ──────────────────────────────────────────────────

function linuxUnitContent({ nodePath, projectRoot }) {
  const envPath = join(bizarConfigDir(), 'service.env');
  const cliEntry = join(projectRoot, 'cli', 'bin.mjs');
  return [
    '[Unit]',
    'Description=Bizar background service daemon (schedules + task-delegator)',
    // v5.x — issue #7 — Make the service unit more robust.
    // Bump StartLimitInterval so transient failures don't trip the
    // systemd rate-limit (default 10s / 5 starts is too aggressive
    // for a service that restarts after `bizar update`).
    'StartLimitIntervalSec=300',
    'StartLimitBurst=10',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `EnvironmentFile=${envPath}`,
    `ExecStart=${nodePath} ${cliEntry} service _daemon`,
    // Restart=on-failure means we only auto-restart on actual errors
    // (non-zero exit). The default `always` would also restart on
    // SIGTERM (which the user just used to stop us), making manual
    // `systemctl --user stop` a fight against the supervisor.
    'Restart=on-failure',
    'RestartSec=5',
    'TimeoutStopSec=20',
    // Hard ceiling so a runaway daemon doesn't pin a CPU forever.
    'CPUQuota=10%',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

function linuxEnvFileContent({ projectRoot }) {
  return buildServiceEnvFile({ bizarHome: bizarConfigDir(), repoPath: projectRoot });
}


function installServiceLinux({ nodePath, projectRoot, force = false }) {
  if (!existsSync(userUnitDir())) {
    try {
      mkdirSync(userUnitDir(), { recursive: true });
    } catch (err) {
      return fail(`cannot create ${userUnitDir()}: ${err.message}`);
    }
  }
  if (!existsSync(bizarConfigDir())) {
    try {
      mkdirSync(bizarConfigDir(), { recursive: true });
    } catch (err) {
      return fail(`cannot create ${bizarConfigDir()}: ${err.message}`);
    }
  }

  const unitPath = linuxUnitPath();
  const envPath = linuxEnvPath();
  const want = linuxUnitContent({ nodePath, projectRoot });
  const wantEnv = linuxEnvFileContent({ projectRoot });

  // Idempotency: if unit + env match, skip the shell-out.
  if (!force && existsSync(unitPath) && existsSync(envPath)) {
    const haveUnit = readFileSync(unitPath, 'utf8').trim() + '\n';
    const haveEnv = readFileSync(envPath, 'utf8').trim() + '\n';
    if (haveUnit === want && haveEnv === wantEnv) {
      return ok({
        alreadyInstalled: true,
        unitPath,
        note: 'unit + env file already match desired content',
      });
    }
  }

  try {
    writeFileSync(unitPath, want, { encoding: 'utf8', mode: 0o644 });
  } catch (err) {
    return fail(`write ${unitPath}: ${err.message}`);
  }
  try {
    writeFileSync(envPath, wantEnv, { encoding: 'utf8', mode: 0o600 });
    // chmod is needed because `mode` in writeFileSync on Windows is a no-op.
    if (PLATFORM !== 'win32') {
      try { chmodSync(envPath, 0o600); } catch { /* best-effort */ }
    }
  } catch (err) {
    return fail(`write ${envPath}: ${err.message}`);
  }

  let r = runCmd('systemctl', ['--user', 'daemon-reload']);
  if (r.error || (r.status !== 0 && r.status !== null)) {
    return fail(`systemctl --user daemon-reload failed: ${r.stderr || r.error?.message || `exit ${r.status}`}`, { unitPath });
  }

  r = runCmd('systemctl', ['--user', 'enable', '--now', 'bizar.service']);
  if (r.error || (r.status !== 0 && r.status !== null)) {
    return fail(`systemctl --user enable --now failed: ${r.stderr || r.error?.message || `exit ${r.status}`}`, { unitPath });
  }

  return ok({
    unitPath,
    note: 'systemd user unit installed and started (or already running)',
  });
}

function uninstallServiceLinux() {
  const unitPath = linuxUnitPath();
  if (!existsSync(unitPath)) {
    return ok({ unitPath: null, note: 'no systemd unit installed' });
  }
  // Best-effort stop+disable. Even if the service is not active, keep going
  // so we still remove the unit file.
  runCmd('systemctl', ['--user', 'disable', '--now', 'bizar.service']);
  try {
    unlinkSync(unitPath);
  } catch (err) {
    return fail(`remove ${unitPath}: ${err.message}`, { unitPath });
  }
  runCmd('systemctl', ['--user', 'daemon-reload']);
  return ok({
    unitPath: null,
    note: 'systemd user unit removed',
  });
}

function stopServiceLinux() {
  const r = runCmd('systemctl', ['--user', 'stop', 'bizar.service']);
  if (r.error || (r.status !== 0 && r.status !== null)) {
    return { ok: false, error: `systemctl stop failed: ${r.stderr || r.error?.message || `exit ${r.status}`}` };
  }
  return { ok: true, note: 'bizar.service stopped' };
}

function linuxServiceStatus() {
  const unitPath = linuxUnitPath();
  if (!existsSync(unitPath)) {
    return { installed: false, running: false, unitPath: null };
  }
  const enabled = runCmd('systemctl', ['--user', 'is-enabled', 'bizar.service']);
  const active = runCmd('systemctl', ['--user', 'is-active', 'bizar.service']);
  const running = active.status === 0 && (active.stdout || '').trim() === 'active';
  const installed = enabled.status === 0 || existsSync(unitPath);
  return { installed, running, unitPath };
}

// ── darwin: launchd plist ─────────────────────────────────────────────────────

function darwinPlistContent({ nodePath, projectRoot }) {
  const cliEntry = join(projectRoot, 'cli', 'bin.mjs');
  // Use buildServiceEnvFile to get all env vars (honours existing process.env)
  const envContent = buildServiceEnvFile({ bizarHome: bizarConfigDir(), repoPath: projectRoot });
  const envVars = parseEnvFile(envContent);
  const envXml = envVars
    .map(([k, v]) => `      <key>${xmlEscape(k)}</key>\n      <string>${xmlEscape(v)}</string>`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    '  <string>com.bizar.dashboard</string>',
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${xmlEscape(nodePath)}</string>`,
    `    <string>${xmlEscape(cliEntry)}</string>`,
    '    <string>service</string>',
    '    <string>_daemon</string>',
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    envXml,
    '  </dict>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    `  <string>${xmlEscape(join(bizarConfigDir(), 'service.log'))}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xmlEscape(join(bizarConfigDir(), 'service.log'))}</string>`,
    '  <key>WorkingDirectory</key>',
    `  <string>${xmlEscape(projectRoot)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Parse a shell-style env file (KEY=VALUE lines, # comments) into
 * an array of [key, value] tuples. Used by darwinPlistContent to
 * embed all env vars in the launchd plist.
 */
function parseEnvFile(content) {
  const result = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    result.push([key, value]);
  }
  return result;
}

function installServiceDarwin({ nodePath, projectRoot, force = false }) {
  const dir = launchAgentsDir();
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch (err) {
      return fail(`cannot create ${dir}: ${err.message}`);
    }
  }
  const plistPath = darwinPlistPath();
  const want = darwinPlistContent({ nodePath, projectRoot });

  if (!force && existsSync(plistPath)) {
    const have = readFileSync(plistPath, 'utf8').trim() + '\n';
    if (have === want.trim() + '\n') {
      // Make sure it's actually loaded though — the file may exist but
      // launchd could have unloaded it after a reboot bug.
      const lst = runCmd('launchctl', ['list']);
      if (lst.status === 0 && /com\.bizar\.dashboard/.test(lst.stdout)) {
        return ok({
          alreadyInstalled: true,
          unitPath: plistPath,
          note: 'plist matches desired content and is loaded',
        });
      }
      // File matches but agent is not loaded — re-load.
      const load = runCmd('launchctl', ['load', '-w', plistPath]);
      if (load.error || (load.status !== 0 && load.status !== null)) {
        return fail(`launchctl load failed: ${load.stderr || load.error?.message || `exit ${load.status}`}`, { unitPath: plistPath });
      }
      return ok({ unitPath: plistPath, note: 'plist already present, reloaded' });
    }
  }

  try {
    writeFileSync(plistPath, want, { encoding: 'utf8', mode: 0o644 });
    try { chmodSync(plistPath, 0o644); } catch { /* best-effort */ }
  } catch (err) {
    return fail(`write ${plistPath}: ${err.message}`);
  }

  // Idempotent load: first unload in case a stale copy is registered.
  runCmd('launchctl', ['unload', plistPath]);
  const load = runCmd('launchctl', ['load', '-w', plistPath]);
  if (load.error || (load.status !== 0 && load.status !== null)) {
    return fail(`launchctl load failed: ${load.stderr || load.error?.message || `exit ${load.status}`}`, { unitPath: plistPath });
  }

  return ok({ unitPath: plistPath, note: 'plist installed and loaded' });
}

function uninstallServiceDarwin() {
  const plistPath = darwinPlistPath();
  if (!existsSync(plistPath)) {
    return ok({ unitPath: null, note: 'no launchd plist installed' });
  }
  // launchctl unload exits non-zero if the agent is not loaded — that's fine.
  runCmd('launchctl', ['unload', plistPath]);
  try {
    unlinkSync(plistPath);
  } catch (err) {
    return fail(`remove ${plistPath}: ${err.message}`, { unitPath: plistPath });
  }
  return ok({ unitPath: null, note: 'plist removed' });
}

function stopServiceDarwin() {
  const plistPath = darwinPlistPath();
  const r = runCmd('launchctl', ['unload', plistPath]);
  if (r.error || (r.status !== 0 && r.status !== null)) {
    return { ok: false, error: `launchctl unload failed: ${r.stderr || r.error?.message || `exit ${r.status}`}` };
  }
  return { ok: true, note: 'com.bizar.dashboard stopped' };
}

function darwinServiceStatus() {
  const plistPath = darwinPlistPath();
  const lst = runCmd('launchctl', ['list']);
  const loaded = lst.status === 0 && /com\.bizar\.dashboard/.test(lst.stdout || '');
  return {
    installed: existsSync(plistPath),
    running: loaded,
    unitPath: existsSync(plistPath) ? plistPath : null,
  };
}

// ── win32: scheduled task + cmd wrapper ───────────────────────────────────────

function windowsCmdContent({ nodePath, projectRoot }) {
  const cliEntry = join(projectRoot, 'cli', 'bin.mjs');
  const envContent = buildServiceEnvFile({ bizarHome: bizarConfigDir(), repoPath: projectRoot });
  const envLines = [];
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    envLines.push(`set "${key}=${value.replace(/"/g, '\\"')}"`);
  }
  const lines = [
    '@echo off',
    'REM Generated by bizar service install — do not edit by hand.',
    ...envLines,
    ':loop',
    `node "${cliEntry}" service _daemon`,
    'REM Restart with 5s backoff on exit. /b keeps this window alive.',
    'timeout /t 5 /nobreak >nul',
    'goto loop',
    '',
  ];
  return lines.join('\r\n');
}

function installServiceWindows({ nodePath, projectRoot, force = false }) {
  const cmdPath = serviceUnitPath({ projectRoot });
  const taskName = 'BizarDashboardService';

  if (!existsSync(bizarConfigDir())) {
    try { mkdirSync(bizarConfigDir(), { recursive: true }); } catch (err) {
      return fail(`cannot create ${bizarConfigDir()}: ${err.message}`);
    }
  }

  const want = windowsCmdContent({ nodePath, projectRoot });

  // Idempotency
  const exists = isScheduledTaskInstalled(taskName);
  if (!force && exists && existsSync(cmdPath)) {
    const have = readFileSync(cmdPath, 'utf8').trim();
    if (have === want.trim()) {
      return ok({ alreadyInstalled: true, unitPath: cmdPath, note: 'scheduled task and wrapper already installed' });
    }
  }

  try {
    writeFileSync(cmdPath, want, { encoding: 'utf8' });
  } catch (err) {
    return fail(`write ${cmdPath}: ${err.message}`);
  }

  // Remove any stale task first so /Create succeeds cleanly.
  runCmd('cmd.exe', ['/c', 'schtasks', '/Delete', '/TN', taskName, '/F']);

  const create = runCmd('cmd.exe', [
    '/c', 'schtasks',
    '/Create',
    '/TN', taskName,
    '/TR', `"${cmdPath}"`,
    '/SC', 'ONSTART',
    '/RL', 'HIGHEST',
    '/F',
  ]);
  if (create.error || (create.status !== 0 && create.status !== null)) {
    return fail(`schtasks /Create failed: ${create.stderr || create.error?.message || `exit ${create.status}`}`, { unitPath: cmdPath });
  }
  return ok({ unitPath: cmdPath, note: 'scheduled task installed' });
}

function uninstallServiceWindows() {
  const cmdPath = serviceUnitPath({});
  const taskName = 'BizarDashboardService';
  const r = runCmd('cmd.exe', ['/c', 'schtasks', '/Delete', '/TN', taskName, '/F']);
  if (existsSync(cmdPath)) {
    try {
      unlinkSync(cmdPath);
    } catch (err) {
      return fail(`remove ${cmdPath}: ${err.message}`, { unitPath: cmdPath });
    }
  }
  return ok({
    unitPath: null,
    note: r.status === 0 ? 'scheduled task removed' : 'scheduled task was not installed; wrapper cleaned up if present',
  });
}

function stopServiceWindows() {
  const taskName = 'BizarDashboardService';
  const r = runCmd('cmd.exe', ['/c', 'schtasks', '/End', '/TN', taskName]);
  if (r.error || (r.status !== 0 && r.status !== null)) {
    return { ok: false, error: `schtasks /End failed: ${r.stderr || r.error?.message || `exit ${r.status}`}` };
  }
  return { ok: true, note: 'BizarDashboardService stopped' };
}

function isScheduledTaskInstalled(taskName) {
  // schtasks /Query is silent on stdout when the task is missing.
  const r = runCmd('cmd.exe', ['/c', 'schtasks', '/Query', '/TN', taskName], { stdio: ['ignore', 'pipe', 'pipe'] });
  return r.status === 0 && !/cannot find|no tasks|running/i.test(r.stdout + r.stderr);
}

function windowsServiceStatus() {
  const cmdPath = serviceUnitPath({});
  const installed = isScheduledTaskInstalled('BizarDashboardService');
  // "Running" is a best-effort signal via tasklist — the cmd wrapper spawns
  // a `node.exe` child.
  const ps = runCmd('tasklist', ['/FI', `IMAGENAME eq node.exe`], { stdio: ['ignore', 'pipe', 'ignore'] });
  const running = ps.status === 0 && /\bnode\.exe\b/i.test(ps.stdout || '');
  return {
    installed: installed || existsSync(cmdPath),
    running,
    unitPath: existsSync(cmdPath) ? cmdPath : null,
  };
}

// ── public API ────────────────────────────────────────────────────────────────

export function installService(opts = {}) {
  const nodePath = resolveNodePath(opts.nodePath);
  const projectRoot = resolveRepoRoot(opts.projectRoot);
  const force = !!opts.force;

  // Honor a --dry-run without performing shell-outs: write nothing, return
  // the would-be content paths. Useful for CI or for "what would happen?"
  // inspections.
  if (opts.dryRun) {
    return ok({
      unitPath: serviceUnitPath({ projectRoot }),
      note: 'dry-run: would install but no changes were made',
    });
  }

  if (PLATFORM === 'linux') return installServiceLinux({ nodePath, projectRoot, force });
  if (PLATFORM === 'darwin') return installServiceDarwin({ nodePath, projectRoot, force });
  if (PLATFORM === 'win32') return installServiceWindows({ nodePath, projectRoot, force });
  return fail(`unsupported platform: ${PLATFORM}`);
}

export function uninstallService() {
  let result;
  if (PLATFORM === 'linux') result = uninstallServiceLinux();
  else if (PLATFORM === 'darwin') result = uninstallServiceDarwin();
  else if (PLATFORM === 'win32') result = uninstallServiceWindows();
  else return fail(`unsupported platform: ${PLATFORM}`);
  return result;
}

/**
 * v5.x — Restart the service (issue #7).
 *
 * The update flow replaces the on-disk files that the running service is
 * holding open. Without a stop/start cycle, the service either crashes
 * when the underlying inode is replaced (Linux) or runs forever against a
 * stale binary (macOS / Windows).
 *
 * This function:
 *   1. Stops the running service (systemctl stop / launchctl unload /
 *      schtasks /End). Best-effort — if the service isn't running, we
 *      treat that as success and continue.
 *   2. Waits up to `waitMs` (default 10s) for the service to exit.
 *   3. Re-installs the unit file. Idempotent — if the content hasn't
 *      changed, installService returns alreadyInstalled=true.
 *   4. Starts the service again (systemctl --user enable --now / launchctl
 *      load -w / schtasks /Run).
 *
 * Returns a structured { ok, stopped, installed, started, error? }.
 *
 * @param {{ nodePath?: string, projectRoot?: string, force?: boolean, waitMs?: number, timeoutMs?: number, dryRun?: boolean }} [opts]
 */
export function restartService(opts = {}) {
  const { waitMs = 10_000, dryRun = false } = opts;
  const nodePath = resolveNodePath(opts.nodePath);
  const projectRoot = resolveRepoRoot(opts.projectRoot);
  const force = !!opts.force;

  if (dryRun) {
    return ok({
      stopped: true,
      installed: { alreadyInstalled: true },
      started: true,
      note: 'dry-run: would stop, reinstall, and start the service',
    });
  }

  // 1. Stop (best-effort)
  let stopped;
  try {
    if (PLATFORM === 'linux') stopped = stopServiceLinux();
    else if (PLATFORM === 'darwin') stopped = stopServiceDarwin();
    else if (PLATFORM === 'win32') stopped = stopServiceWindows();
    else return fail(`unsupported platform: ${PLATFORM}`);
  } catch (err) {
    return fail(`stop failed: ${err.message}`, { stopped: { ok: false, error: err.message } });
  }

  // 2. Wait for the service to actually exit. The stop shell-outs are
  //    synchronous in the per-platform functions (systemctl blocks until
  //    stop completes; launchctl unload returns immediately; schtasks
  //    /End returns immediately), so we additionally check the running
  //    state and wait until the OS reports not-running OR our deadline
  //    elapses.
  const deadline = Date.now() + waitMs;
  if (PLATFORM === 'linux' || PLATFORM === 'darwin' || PLATFORM === 'win32') {
    while (Date.now() < deadline) {
      const st = serviceStatus();
      if (!st.running) break;
      // Synchronous short sleep — service should exit in <2s on a
      // healthy system. We avoid pulling in a timer just for this
      // bounded wait.
      const until = Date.now() + 200;
      while (Date.now() < until) { /* spin briefly */ }
    }
  }

  // 3. Reinstall
  let installed;
  try {
    installed = installService({ nodePath, projectRoot, force });
  } catch (err) {
    return fail(`reinstall failed: ${err.message}`, { stopped, installed: { ok: false, error: err.message } });
  }
  if (!installed.ok) {
    return fail(`reinstall failed: ${installed.error}`, { stopped, installed });
  }

  // 4. Start. The installService* helpers above already do an
  //    `enable --now` / `load -w` / `schtasks /Create` (the Windows
  //    wrapper script contains a self-restart loop, so creating the
  //    task starts the daemon). So when installService succeeds, the
  //    service is already running on every platform. Surface that as
  //    `started: true` here. The Status field of the return value is
  //    still authoritative — operators can call `bizar service status`
  //    to confirm.
  return ok({
    stopped,
    installed,
    started: true,
    unitPath: installed.unitPath || serviceUnitPath({ projectRoot }),
    note: 'service stopped, unit reinstalled, service started',
  });
}

export function isInstalled() {
  if (PLATFORM === 'linux') return existsSync(linuxUnitPath());
  if (PLATFORM === 'darwin') return existsSync(darwinPlistPath());
  if (PLATFORM === 'win32') return isScheduledTaskInstalled('BizarDashboardService') || existsSync(serviceUnitPath({}));
  return false;
}

export function serviceStatus() {
  if (PLATFORM === 'linux') return linuxServiceStatus();
  if (PLATFORM === 'darwin') return darwinServiceStatus();
  if (PLATFORM === 'win32') return windowsServiceStatus();
  return { installed: false, running: false, unitPath: null };
}

// ── direct-entry CLI: `node service-controller.mjs install|uninstall|status` ──

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === __filename;
if (isMain) {
  const sub = process.argv[2];
  const flags = new Set(process.argv.slice(3));
  const dry = flags.has('--dry-run');
  const force = flags.has('--force') || flags.has('-f');
  const fmt = (r) => JSON.stringify(r, null, 2);

  if (sub === 'install') {
    console.log(fmt(installService({ force, dryRun: dry })));
  } else if (sub === 'uninstall') {
    console.log(fmt(uninstallService()));
  } else if (sub === 'restart') {
    // v5.x — issue #7. Stop → reinstall unit → start. Idempotent on the
    // install step (when the unit content hasn't changed, the second
    // installService call returns alreadyInstalled=true and the service
    // is still restarted).
    console.log(fmt(restartService({ force, dryRun: dry })));
  } else if (sub === 'status') {
    console.log(fmt(serviceStatus()));
  } else if (sub === 'is-installed') {
    console.log(JSON.stringify({ installed: isInstalled() }));
  } else {
    console.log(`
service-controller — platform-aware installer for the Bizar background service

Usage:
  node cli/service-controller.mjs install [--force] [--dry-run]
  node cli/service-controller.mjs uninstall
  node cli/service-controller.mjs restart [--force] [--dry-run]
  node cli/service-controller.mjs status
  node cli/service-controller.mjs is-installed
`);
  }
}
