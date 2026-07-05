/**
 * cli/commands/mod.mjs
 *
 * Mod manager CLI — talks to the running dashboard's HTTP API.
 * v3.20.5+ — install, upgrade, list, registry.
 */
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const BIZAR_HOME = join(HOME, '.config', 'bizar');

// ── Config dir helper ──────────────────────────────────────────────────────────

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

// ── Help ───────────────────────────────────────────────────────────────────────

export function showModHelp() {
  console.log(`
  bizar mod — Manage mods (via the dashboard's HTTP API)

  Usage:
    bizar mod upgrade <id> [--backup]   Upgrade an installed mod to the latest version
    bizar mod install <id>              Install a mod from the registry
    bizar mod list                       List installed mods
    bizar mod registry                  Show registry URL + available mods

  Description:
    Subcommands call the running dashboard's HTTP API. If no dashboard is
    reachable, you'll be told to run \`bizar dash start\` first.

    \`bizar mod upgrade <id>\` will:
      1. Snapshot the existing version of the mod
      2. Optionally back up the folder (--backup)
      3. Remove the existing copy (and its opencode-config instructions)
      4. Install the latest version from the registry
      5. Re-install the new mod's instruction files into opencode config
      6. Print from-version → to-version
  `);
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function postJson(baseUrl, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
    throw new Error(`${path} failed: ${msg}`);
  }
  return json;
}

async function getJson(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
    throw new Error(`${path} failed: ${msg}`);
  }
  return json;
}

// ── Command runner ────────────────────────────────────────────────────────────

export async function runModCommand(modArgs) {
  const sub = modArgs[0];
  const positional = modArgs.slice(1).filter((a) => !a.startsWith('-'));
  const flags = modArgs.slice(1).filter((a) => a.startsWith('-'));

  if (!sub || sub === '--help' || sub === '-h' || flags.includes('--help') || flags.includes('-h')) {
    showModHelp();
    return;
  }

  // Read dashboard port from the port file the dashboard writes on start.
  const portFile = join(getBizarConfigDir(), 'dashboard.port');
  let port = null;
  try {
    port = parseInt(readFileSync(portFile, 'utf8').trim(), 10);
    if (!Number.isFinite(port) || port <= 0) port = null;
  } catch {
    port = null;
  }
  if (!port) {
    console.error(chalk.red('  ✗ Dashboard is not running (no port file at ' + portFile + ').'));
    console.error(chalk.dim('  Start it first: `bizar dash start --bg`'));
    process.exit(1);
  }
  const baseUrl = `http://127.0.0.1:${port}`;

  if (sub === 'install') {
    const id = positional[0];
    if (!id) {
      console.error(chalk.red('  ✗ Missing mod id. Usage: bizar mod install <id>'));
      process.exit(1);
    }
    try {
      const m = await postJson(baseUrl, '/api/mods', { id });
      console.log(chalk.green(`  ✓ Installed "${m.id}" v${m.version}`));
    } catch (err) {
      console.error(chalk.red(`  ✗ ${err.message}`));
      process.exit(1);
    }
  } else if (sub === 'upgrade') {
    const id = positional[0];
    if (!id) {
      console.error(chalk.red('  ✗ Missing mod id. Usage: bizar mod upgrade <id> [--backup]'));
      process.exit(1);
    }
    const backup = flags.includes('--backup') || flags.includes('-b');
    try {
      const r = await postJson(baseUrl, `/api/mods/${encodeURIComponent(id)}/upgrade`, { backup });
      const note = r.backupPath ? chalk.dim(` (backup: ${r.backupPath})`) : '';
      console.log(chalk.green(`  ✓ Upgraded "${id}" v${r.from} → v${r.to}`) + note);
    } catch (err) {
      console.error(chalk.red(`  ✗ ${err.message}`));
      process.exit(1);
    }
  } else if (sub === 'list') {
    try {
      const r = await getJson(baseUrl, '/api/mods');
      const mods = r.mods || [];
      if (mods.length === 0) {
        console.log(chalk.dim('  (no mods installed)'));
        return;
      }
      for (const m of mods) {
        const state = m.enabled ? chalk.green('enabled ') : chalk.yellow('disabled');
        console.log(`  ${m.id.padEnd(20)} v${m.version.padEnd(10)} ${state}  ${m.name || ''}`);
      }
    } catch (err) {
      console.error(chalk.red(`  ✗ ${err.message}`));
      process.exit(1);
    }
  } else if (sub === 'registry') {
    try {
      const r = await getJson(baseUrl, '/api/mods/registry');
      console.log(chalk.dim(`  Source: ${r.registry?.source || '(unknown)'}`));
      console.log(chalk.dim(`  Updated: ${r.registry?.updatedAt || '(unknown)'}`));
      console.log('');
      const mods = r.mods || [];
      if (mods.length === 0) {
        console.log(chalk.dim('  (no mods in registry)'));
        return;
      }
      for (const m of mods) {
        const installed = m.installed ? chalk.green(`installed v${m.installedVersion || '?'}`) : chalk.dim('not installed');
        const upgrade = m.upgradeAvailable ? chalk.yellow(` ↑ v${m.upgradeAvailable} available`) : '';
        console.log(`  ${m.id.padEnd(20)} v${(m.latest || '?').padEnd(10)} ${installed}${upgrade}  ${m.name || ''}`);
      }
    } catch (err) {
      console.error(chalk.red(`  ✗ ${err.message}`));
      process.exit(1);
    }
  } else {
    console.error(chalk.red(`  ✗ Unknown mod subcommand: ${sub}`));
    showModHelp();
    process.exit(1);
  }
}

export async function run(name, args, isHelpRequest) {
  await runModCommand(args);
}
