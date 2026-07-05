/**
 * cli/commands/plugin.mjs
 *
 * v5.0.0 — Plugin marketplace CLI.
 *
 * Talks to the running dashboard's HTTP API (which in turn uses
 * `bizar-dash/src/server/plugins/{registry,store,sandbox}.mjs`).
 *
 * Usage:
 *   bizar plugin search <query>             — search the registry
 *   bizar plugin install <id>               — install from registry
 *   bizar plugin list                       — list installed
 *   bizar plugin info <id>                  — show details + config schema
 *   bizar plugin config <id> [key] [value]  — get/set config (dot-path key)
 *   bizar plugin update <id>                — update to latest
 *   bizar plugin uninstall <id>             — remove
 *   bizar plugin invoke <id> <method> [...args]   — run a plugin method
 */
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── Config dir helper (same shape as cli/commands/mod.mjs) ────────────────

function getBizarConfigDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA
      ? join(process.env.APPDATA, 'bizar')
      : join(homedir(), '.config', 'bizar');
  }
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'bizar')
    : join(homedir(), '.config', 'bizar');
}

// ── Help ───────────────────────────────────────────────────────────────────

export function showPluginHelp() {
  console.log(`
  bizar plugin — Manage marketplace plugins (via the dashboard's HTTP API)

  Usage:
    bizar plugin search <query>              Search the public registry
    bizar plugin install <id>                Install a plugin from the registry
    bizar plugin list                        List installed plugins
    bizar plugin info <id>                   Show details + config schema
    bizar plugin config <id> [key] [value]   Get or set a config value
    bizar plugin update <id>                 Update to the latest version
    bizar plugin uninstall <id>              Remove a plugin
    bizar plugin invoke <id> <method> [...args]   Invoke a plugin method

  Examples:
    bizar plugin search deploy
    bizar plugin install vercel-deploy
    bizar plugin info vercel-deploy
    bizar plugin config vercel-deploy apiKey sk-xxx
    bizar plugin update vercel-deploy
    bizar plugin invoke vercel-deploy deploy ./my-project

  Description:
    Subcommands call the running dashboard's HTTP API. If no dashboard is
    reachable, you'll be told to run \`bizar dash start --bg\` first.

    \`bizar plugin config <id> <key> <value>\` sets a single key at the
    given dot-path. To replace the entire config object, use the dashboard
    UI or the REST API directly.
  `);
}

// ── API helpers (mirror cli/commands/mod.mjs) ──────────────────────────────

async function request(baseUrl, method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
    const err = new Error(`${method} ${path} failed: ${msg}`);
    err.status = res.status;
    err.code = json?.error;
    throw err;
  }
  return { status: res.status, json };
}

async function readDashboardUrl() {
  const portFile = join(getBizarConfigDir(), 'dashboard.port');
  let port = null;
  try {
    port = parseInt(readFileSync(portFile, 'utf8').trim(), 10);
    if (!Number.isFinite(port) || port <= 0) port = null;
  } catch {
    port = null;
  }
  if (!port) {
    console.error(
      chalk.red('  ✗ Dashboard is not running (no port file at ' + portFile + ').'),
    );
    console.error(chalk.dim('  Start it first: `bizar dash start --bg`'));
    process.exit(1);
  }
  return `http://127.0.0.1:${port}`;
}

// ── Subcommand implementations ─────────────────────────────────────────────

async function cmdSearch(args, baseUrl) {
  const query = args.join(' ').trim();
  const r = await request(baseUrl, 'GET',
    `/api/plugins/registry?q=${encodeURIComponent(query)}`);
  const { plugins = [], registry: reg } = r.json;
  console.log(chalk.dim(`  Source: ${reg?.source || '(unknown)'}`));
  console.log('');
  if (plugins.length === 0) {
    console.log(chalk.dim('  (no plugins matched)'));
    return;
  }
  for (const p of plugins) {
    const installed = p.installed
      ? chalk.green(`installed v${p.installedVersion || '?'}`)
      : chalk.dim('not installed');
    const upgrade = p.upgradeAvailable
      ? chalk.yellow(` ↑ v${p.upgradeAvailable} available`)
      : '';
    console.log(
      `  ${p.id.padEnd(24)} v${(p.version || '?').padEnd(10)} ${installed}${upgrade}  ${p.name || ''}`,
    );
  }
}

async function cmdInstall(args, baseUrl) {
  const id = args[0];
  if (!id) {
    console.error(chalk.red('  ✗ Missing plugin id. Usage: bizar plugin install <id>'));
    process.exit(1);
  }
  const force = args.includes('--force') || args.includes('-f');
  const r = await request(baseUrl, 'POST', '/api/plugins/install',
    { pluginId: id, force });
  console.log(chalk.green(`  ✓ Installed "${r.json.id}" v${r.json.version}`));
}

async function cmdList(_args, baseUrl) {
  const r = await request(baseUrl, 'GET', '/api/plugins/installed');
  const plugins = r.json.plugins || [];
  if (plugins.length === 0) {
    console.log(chalk.dim('  (no plugins installed)'));
    return;
  }
  for (const p of plugins) {
    console.log(`  ${p.id.padEnd(24)} v${(p.version || '?').padEnd(10)} ${p.name || ''}`);
  }
}

async function cmdInfo(args, baseUrl) {
  const id = args[0];
  if (!id) {
    console.error(chalk.red('  ✗ Missing plugin id. Usage: bizar plugin info <id>'));
    process.exit(1);
  }
  // Try registry first (gets description + schema); fall back to
  // installed lookup if not in registry.
  let plugin;
  try {
    const r = await request(baseUrl, 'GET',
      `/api/plugins/registry/${encodeURIComponent(id)}`);
    plugin = r.json;
  } catch (err) {
    if (err.status !== 404) throw err;
    plugin = null;
  }
  const installed = await safeGetInstalled(id, baseUrl);
  const merged = { ...(plugin || {}), ...(installed || {}) };
  if (!merged.id) {
    console.error(chalk.red(`  ✗ Plugin "${id}" not found in registry or installed list`));
    process.exit(1);
  }
  console.log(`  ${chalk.bold(merged.name || merged.id)} ${chalk.dim('v' + (merged.version || '?'))}`);
  if (merged.description) console.log(`  ${chalk.dim(merged.description)}`);
  if (merged.author) console.log(`  ${chalk.dim('author:')} ${merged.author}`);
  if (merged.category) console.log(`  ${chalk.dim('category:')} ${merged.category}`);
  if (Array.isArray(merged.tags) && merged.tags.length) {
    console.log(`  ${chalk.dim('tags:')} ${merged.tags.join(', ')}`);
  }
  if (merged.homepage) console.log(`  ${chalk.dim('homepage:')} ${merged.homepage}`);
  if (Array.isArray(merged.permissions) && merged.permissions.length) {
    console.log(`  ${chalk.dim('permissions:')} ${merged.permissions.join(', ')}`);
  }
  if (installed) {
    console.log('');
    console.log(`  ${chalk.dim('install path:')} ${installed.path}`);
    console.log(`  ${chalk.dim('installed:')} ${installed.installedAt}`);
    console.log(`  ${chalk.dim('config:')}`);
    if (!installed.config || Object.keys(installed.config).length === 0) {
      console.log(chalk.dim('    (empty)'));
    } else {
      for (const [k, v] of Object.entries(installed.config)) {
        const display = typeof v === 'string' && v.length > 40
          ? v.slice(0, 37) + '...'
          : JSON.stringify(v);
        console.log(`    ${chalk.cyan(k)}: ${display}`);
      }
    }
  }
}

async function safeGetInstalled(id, baseUrl) {
  try {
    const r = await request(baseUrl, 'GET', '/api/plugins/installed');
    return (r.json.plugins || []).find((p) => p.id === id) || null;
  } catch {
    return null;
  }
}

async function cmdConfig(args, baseUrl) {
  const id = args[0];
  if (!id) {
    console.error(chalk.red(
      '  ✗ Missing plugin id. Usage: bizar plugin config <id> [key] [value]'));
    process.exit(1);
  }
  const installed = await safeGetInstalled(id, baseUrl);
  if (!installed) {
    console.error(chalk.red(`  ✗ Plugin "${id}" is not installed`));
    process.exit(1);
  }
  if (args.length === 1) {
    // No key — print full config.
    console.log(JSON.stringify(installed.config || {}, null, 2));
    return;
  }
  const key = args[1];
  if (args.length === 2) {
    // Just key — print that value.
    const v = getDotPath(installed.config || {}, key);
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  // key + value — replace full config with the new merged value.
  // We merge to avoid wiping sibling keys the user didn't mention.
  const newConfig = JSON.parse(JSON.stringify(installed.config || {}));
  setDotPath(newConfig, key, args.slice(2).join(' '));
  await request(baseUrl, 'PUT',
    `/api/plugins/${encodeURIComponent(id)}`,
    { action: 'config', config: newConfig });
  console.log(chalk.green(`  ✓ Set ${id}.${key}`));
}

function getDotPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function setDotPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

async function cmdUpdate(args, baseUrl) {
  const id = args[0];
  if (!id) {
    console.error(chalk.red('  ✗ Missing plugin id. Usage: bizar plugin update <id>'));
    process.exit(1);
  }
  const r = await request(baseUrl, 'PUT',
    `/api/plugins/${encodeURIComponent(id)}`, { action: 'update' });
  const note = r.json.from === r.json.to
    ? chalk.dim(' (already at latest)')
    : '';
  console.log(chalk.green(`  ✓ Updated "${id}" v${r.json.from} → v${r.json.to}`) + note);
}

async function cmdUninstall(args, baseUrl) {
  const id = args[0];
  if (!id) {
    console.error(chalk.red('  ✗ Missing plugin id. Usage: bizar plugin uninstall <id>'));
    process.exit(1);
  }
  await request(baseUrl, 'DELETE', `/api/plugins/${encodeURIComponent(id)}`);
  console.log(chalk.green(`  ✓ Uninstalled "${id}"`));
}

async function cmdInvoke(args, baseUrl) {
  const [id, method, ...rest] = args;
  if (!id || !method) {
    console.error(chalk.red(
      '  ✗ Usage: bizar plugin invoke <id> <method> [...args]'));
    process.exit(1);
  }
  const r = await request(baseUrl, 'POST',
    `/api/plugins/${encodeURIComponent(id)}/invoke`,
    { method, args: rest });
  if (r.json.ok) {
    console.log(JSON.stringify(r.json.result, null, 2));
  } else {
    console.error(chalk.red(`  ✗ ${r.json.error}`));
    if (r.json.code) console.error(chalk.dim(`    code: ${r.json.code}`));
    process.exit(1);
  }
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

export async function runPluginCommand(pluginArgs) {
  const sub = pluginArgs[0];
  const rest = pluginArgs.slice(1);

  if (!sub || sub === '--help' || sub === '-h') {
    showPluginHelp();
    return;
  }

  const baseUrl = await readDashboardUrl();
  const handlers = {
    search: cmdSearch,
    install: cmdInstall,
    list: cmdList,
    info: cmdInfo,
    config: cmdConfig,
    update: cmdUpdate,
    uninstall: cmdUninstall,
    invoke: cmdInvoke,
  };
  const handler = handlers[sub];
  if (!handler) {
    console.error(chalk.red(`  ✗ Unknown plugin subcommand: ${sub}`));
    showPluginHelp();
    process.exit(1);
  }
  try {
    await handler(rest, baseUrl);
  } catch (err) {
    console.error(chalk.red(`  ✗ ${err.message}`));
    process.exit(1);
  }
}

export async function run(name, args, isHelpRequest) {
  await runPluginCommand(args);
}