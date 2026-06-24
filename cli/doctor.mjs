/**
 * cli/doctor.mjs
 *
 * v3.12.2 — `bizar doctor` subcommand.
 *
 * Runs a battery of health checks against the local Bizar / opencode
 * install and reports pass/fail for each. Returns a structured summary
 * suitable for callers (e.g. `bizar update`) that want to act on the
 * result without re-printing the per-check output.
 *
 * The checks are intentionally tolerant: missing optional tools
 * (rtk/semble/skills) don't fail the run, and the dashboard check is
 * skipped silently if no port file exists. The goal is "is your
 * install healthy?" not "is every conceivable thing present?".
 *
 * Usage:
 *   import { runDoctor } from './doctor.mjs';
 *   const r = await runDoctor();                    // prints everything
 *   const r = await runDoctor({ silent: true });    // returns summary only
 */
import chalk from 'chalk';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { opencodeConfigDir, opencodeAgentsDir } from './utils.mjs';

const REQUIRED_AGENTS = ['odin.md', 'quick.md', 'thor.md', 'tyr.md'];

// ── helpers ─────────────────────────────────────────────────────────────────

function bizarConfigDir() {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'bizar')
    : join(homedir(), '.config', 'bizar');
}

/**
 * Run a check function and capture its result. The check either
 * returns a string message (pass) or throws an Error (fail).
 */
async function runCheck(name, fn) {
  try {
    const message = await fn();
    return { name, ok: true, message: message || 'ok' };
  } catch (err) {
    return {
      name,
      ok: false,
      message: err && err.message ? err.message : String(err),
    };
  }
}

function which(cmd) {
  const probe = spawnSync('which', [cmd], { stdio: 'ignore' });
  return probe.status === 0;
}

// ── individual checks ───────────────────────────────────────────────────────

async function checkOpencodeReachable() {
  const r = spawnSync('opencode', ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (r.status !== 0) {
    throw new Error(`opencode --version exited ${r.status}`);
  }
  return (r.stdout || r.stderr || '').trim().split('\n')[0] || 'opencode available';
}

async function checkConfigValid() {
  const cfgPath = join(opencodeConfigDir(), 'opencode.json');
  if (!existsSync(cfgPath)) {
    throw new Error(`not found at ${cfgPath}`);
  }
  try {
    JSON.parse(readFileSync(cfgPath, 'utf8'));
  } catch (err) {
    throw new Error(`invalid JSON: ${err.message}`);
  }
  return 'opencode.json parses';
}

async function checkPluginEntryPresent() {
  const cfgPath = join(opencodeConfigDir(), 'opencode.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const plugins = Array.isArray(cfg.plugin) ? cfg.plugin : [];
  if (plugins.length === 0) {
    throw new Error('no plugin entries in opencode.json');
  }
  const hasBizar = plugins.some((p) => {
    if (typeof p === 'string') return p.includes('bizar');
    if (p && typeof p === 'object') {
      return (
        (p.name || '').includes('bizar') ||
        (p.path || '').includes('bizar')
      );
    }
    return false;
  });
  if (!hasBizar) {
    throw new Error('bizar not found in plugin[]');
  }
  return 'bizar present in plugin[]';
}

async function checkPluginPathResolves() {
  const cfgPath = join(opencodeConfigDir(), 'opencode.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const plugins = Array.isArray(cfg.plugin) ? cfg.plugin : [];
  let lastChecked = null;
  for (const p of plugins) {
    if (!p || typeof p !== 'object' || !p.path) continue;
    const entryPath = p.path;
    const isAbs = entryPath.startsWith('/') || /^[a-z]:[\\/]/i.test(entryPath);
    const resolved = isAbs ? entryPath : join(opencodeConfigDir(), entryPath);
    lastChecked = resolved;
    if (!existsSync(resolved)) {
      throw new Error(`plugin path does not exist: ${resolved}`);
    }
  }
  if (lastChecked === null) {
    return 'no plugin path to check';
  }
  return `plugin path resolves: ${lastChecked}`;
}

async function checkDeployedPluginPresent() {
  const r = spawnSync('npm', ['root', '-g'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (r.status !== 0) {
    throw new Error('npm root -g failed');
  }
  const root = (r.stdout || '').trim();
  const pkgPath = join(root, '@polderlabs', 'bizar-plugin', 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error('@polderlabs/bizar-plugin not installed globally');
  }
  return '@polderlabs/bizar-plugin present';
}

async function checkAgentFilesInstalled() {
  const dir = opencodeAgentsDir();
  if (!existsSync(dir)) {
    throw new Error(`agents dir missing: ${dir}`);
  }
  const missing = REQUIRED_AGENTS.filter((f) => !existsSync(join(dir, f)));
  if (missing.length > 0) {
    throw new Error(`missing: ${missing.join(', ')}`);
  }
  return `all ${REQUIRED_AGENTS.length} core agents present`;
}

/**
 * Lenient: passes if at least one of rtk/semble/skills is on PATH.
 * These are informational — none of them are strictly required for
 * `bizar doctor` to do its job, and missing them shouldn't fail the
 * overall health report.
 */
async function checkToolsAvailable() {
  const tools = ['rtk', 'semble', 'skills'];
  const found = tools.filter(which);
  if (found.length === 0) {
    throw new Error(`none of ${tools.join('/')} on PATH`);
  }
  return `available: ${found.join(', ')}`;
}

async function checkDashboardReachable() {
  const portFile = join(bizarConfigDir(), 'dashboard.port');
  if (!existsSync(portFile)) {
    return 'no dashboard port file (skipped)';
  }
  let port;
  try {
    port = parseInt(readFileSync(portFile, 'utf8').trim(), 10);
  } catch {
    throw new Error(`could not read port from ${portFile}`);
  }
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`invalid port in ${portFile}: ${port}`);
  }
  const r = spawnSync(
    'curl',
    ['-fsS', '-m', '2', `http://127.0.0.1:${port}/api/health`],
    { encoding: 'utf8', timeout: 5000 },
  );
  if (r.status !== 0) {
    throw new Error(`dashboard on port ${port} not reachable`);
  }
  return `dashboard reachable on port ${port}`;
}

async function checkProviderConfigSanity() {
  const cfgPath = join(opencodeConfigDir(), 'opencode.json');
  if (!existsSync(cfgPath)) {
    throw new Error('opencode.json missing');
  }
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const openrouter = cfg.provider && cfg.provider.openrouter;
  if (!openrouter) {
    throw new Error('provider.openrouter block missing');
  }
  const models = openrouter.models || {};
  const saneNames = Object.entries(models).filter(([, m]) => {
    return (
      m &&
      typeof m === 'object' &&
      'interleaved' in m &&
      'reasoning' in m
    );
  });
  if (saneNames.length === 0) {
    throw new Error(
      'no MiniMax-style model with interleaved + reasoning flags',
    );
  }
  return `provider.openrouter + ${saneNames.length} model(s) sane`;
}

const CHECKS = [
  ['opencode-reachable', checkOpencodeReachable],
  ['opencode-config-valid', checkConfigValid],
  ['plugin-entry-present', checkPluginEntryPresent],
  ['plugin-path-resolves', checkPluginPathResolves],
  ['deployed-plugin-present', checkDeployedPluginPresent],
  ['agent-files-installed', checkAgentFilesInstalled],
  ['tools-available', checkToolsAvailable],
  ['dashboard-reachable', checkDashboardReachable],
  ['provider-config-sanity', checkProviderConfigSanity],
];

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Run all health checks. Prints per-check output unless `opts.silent`.
 * Always prints a final summary line. Returns `{ passed, failed, results }`.
 */
export async function runDoctor(opts = {}) {
  const silent = !!opts.silent;
  const results = [];
  for (const [name, fn] of CHECKS) {
    const r = await runCheck(name, fn);
    results.push(r);
    if (!silent) {
      const marker = r.ok ? chalk.green('✓') : chalk.red('✗');
      const label = name.padEnd(28);
      const msg = r.ok ? chalk.dim(`  ${r.message}`) : chalk.red(`  ${r.message}`);
      console.log(`  ${marker} ${label}${msg}`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  // Always print a summary line if there were failures, or if not silent.
  if (failed > 0 || !silent) {
    console.log('');
    if (failed === 0) {
      console.log(
        chalk.green(`  ✓ ${passed} checks passed, ${failed} failed`),
      );
    } else {
      console.log(
        chalk.yellow(`  ⚠ ${passed} checks passed, ${failed} failed`),
      );
    }
  }

  return { passed, failed, results };
}