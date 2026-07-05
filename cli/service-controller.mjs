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
 *   * The opencode password is never written into the unit file. Runtime
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
    'Description=Bizar background service daemon',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `EnvironmentFile=${envPath}`,
    `ExecStart=${nodePath} ${cliEntry} service _daemon`,
    'Restart=always',
    'RestartSec=5',
    'TimeoutStopSec=20',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

function linuxEnvFileContent({ projectRoot }) {
  const lines = [
    `# Generated by bizar service install — do not edit by hand.`,
    `# Source this file from your shell to get the same env that the daemon sees.`,
    `BIZAR_HOME=${bizarConfigDir()}`,
    `PATH=${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`,
    `BIZAR_REPO=${projectRoot}`,
  ];
  // Secrets are NOT written here. A user can append OPENCODE_SERVER_PASSWORD
  // manually, but the controller never copies secrets into the unit file.
  if (process.env.OPENCODE_SERVER_PASSWORD && !process.env.BIZAR_REDACT_PASSWORD) {
    // Honored only if the user opts in via BIZAR_REDACT_PASSWORD=1 — default
    // is to never persist secrets; the comment above documents this.
    lines.push(`OPENCODE_SERVER_PASSWORD=${process.env.OPENCODE_SERVER_PASSWORD}`);
  }
  return lines.join('\n') + '\n';
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
  const envVars = [
    ['BIZAR_HOME', bizarConfigDir()],
    ['PATH', process.env.PATH || '/usr/local/bin:/usr/bin:/bin'],
    ['BIZAR_REPO', projectRoot],
  ];
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
  const lines = [
    '@echo off',
    'REM Generated by bizar service install — do not edit by hand.',
    `set "BIZAR_HOME=${bizarConfigDir()}"`,
    `set "PATH=${process.env.PATH || '%PATH%'}"`,
    `:loop`,
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
  if (PLATFORM === 'linux') return uninstallServiceLinux();
  if (PLATFORM === 'darwin') return uninstallServiceDarwin();
  if (PLATFORM === 'win32') return uninstallServiceWindows();
  return fail(`unsupported platform: ${PLATFORM}`);
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
  node cli/service-controller.mjs status
  node cli/service-controller.mjs is-installed
`);
  }
}
