/**
 * cli/doctor.mjs
 *
 * v3.12.2 — `bizar doctor` subcommand.
 *
 * Runs a battery of health checks against the local Bizar / cline
 * install and reports pass/fail for each. Returns a structured summary
 * suitable for callers (e.g. `bizar update`) that want to act on the
 * result without re-printing the per-check output.
 *
 * The checks are intentionally tolerant: missing optional tools
 * (headroom/semble/skills) don't fail the run, and the dashboard check
 * is skipped silently if no port file exists. The goal is "is your
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
import { join } from 'node:path';
import { clineConfigDir, clineAgentsDir, which, bizarConfigDir } from './utils.mjs';

// v3.20.11: list every agent the install script is expected to deploy.
// Adding a new agent to `config/agents/` without adding it here causes
// doctor to silently under-count ("all 4 core agents present" when there
// are actually 14). The list mirrors cli/install.mjs AGENT_FILES plus
// `browser-harness.md` (added in v3.20.7) and `_shared/AGENT_BASELINE.md`
// is intentionally excluded (it's a skill, not an agent).
const REQUIRED_AGENTS = [
  'odin.md',
  'vor.md',
  'frigg.md',
  'quick.md',
  'mimir.md',
  'heimdall.md',
  'hermod.md',
  'thor.md',
  'baldr.md',
  'tyr.md',
  'vidarr.md',
  'forseti.md',
  'semble-search.md',
  'browser-harness.md',
];

// ── helpers ─────────────────────────────────────────────────────────────────

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

// ── individual checks ───────────────────────────────────────────────────────

async function checkClineReachable() {
  const r = spawnSync('cline', ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (r.status !== 0) {
    throw new Error(`cline --version exited ${r.status}`);
  }
  return (r.stdout || r.stderr || '').trim().split('\n')[0] || 'cline available';
}

async function checkConfigValid() {
  const cfgPath = join(clineConfigDir(), 'cline.json');
  if (!existsSync(cfgPath)) {
    throw new Error(`not found at ${cfgPath}`);
  }
  try {
    JSON.parse(readFileSync(cfgPath, 'utf8'));
  } catch (err) {
    throw new Error(`invalid JSON: ${err.message}`);
  }
  return 'cline.json parses';
}

async function checkPluginEntryPresent() {
  const cfgPath = join(clineConfigDir(), 'cline.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const plugins = Array.isArray(cfg.plugin) ? cfg.plugin : [];
  if (plugins.length === 0) {
    throw new Error('no plugin entries in cline.json');
  }
  const hasBizar = plugins.some((p) => {
    if (typeof p === 'string') return p.includes('bizar');
    if (Array.isArray(p)) {
      const [path] = p;
      return typeof path === 'string' && path.includes('bizar');
    }
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
  const cfgPath = join(clineConfigDir(), 'cline.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const plugins = Array.isArray(cfg.plugin) ? cfg.plugin : [];
  let lastChecked = null;
  for (const p of plugins) {
    let entryPath = null;
    if (Array.isArray(p)) {
      const [path] = p;
      if (typeof path === 'string') entryPath = path;
    } else if (p && typeof p === 'object' && p.path) {
      entryPath = p.path;
    }
    if (!entryPath) continue;
    const isAbs = entryPath.startsWith('/') || /^[a-z]:[\\/]/i.test(entryPath);
    const resolved = isAbs ? entryPath : join(clineConfigDir(), entryPath);
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
  const dir = clineAgentsDir();
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
 * Lenient: passes if at least one of headroom/semble/skills is on PATH.
 * These are informational — none of them are strictly required for
 * `bizar doctor` to do its job, and missing them shouldn't fail the
 * overall health report.
 */
async function checkToolsAvailable() {
  const tools = ['headroom', 'semble', 'skills'];
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
  const cfgPath = join(clineConfigDir(), 'cline.json');
  if (!existsSync(cfgPath)) {
    throw new Error('cline.json missing');
  }
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const minimax = cfg.provider && cfg.provider.minimax;
  if (!minimax) {
    // Warn instead of throw — provision.mjs auto-adds this block on
    // install/update, but users with an older pre-v5 cline.json
    // may not have it yet.
    return 'warn: provider.minimax block missing (run `bizar update` to patch)';
  }
  const models = minimax.models || {};
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
  return `provider.minimax + ${saneNames.length} model(s) sane`;
}

const CHECKS = [
  ['cline-reachable', checkClineReachable],
  ['cline-config-valid', checkConfigValid],
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
 * Prints a final summary line unless `opts.json` is true.
 * Returns `{ passed, failed, results }`.
 */
export async function runDoctor(opts = {}) {
  const silent = !!opts.silent;
  const jsonMode = !!opts.json;
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

  // Print summary line only when not in JSON mode
  if (!jsonMode && (failed > 0 || !silent)) {
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