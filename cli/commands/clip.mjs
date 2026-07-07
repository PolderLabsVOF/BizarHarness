/**
 * cli/commands/clip.mjs
 *
 * v5.0.0 — Web Clipper CLI subcommand.
 *
 * Subcommands:
 *   bizar clip list              List recent clips
 *   bizar clip delete <id>       Delete a clip from the log
 *   bizar clip configure         Show current dashboard URL
 */

import chalk from 'chalk';
// Mirror `readDashboardConn` from clip.mjs / minimax.mjs / usage.mjs.
function readDashboardConn() {
  const cfgDir = process.env.XDG_CONFIG_HOME
    ? require_('node:path').join(process.env.XDG_CONFIG_HOME, 'bizar')
    : require_('node:path').join(require_('node:os').homedir(), '.config', 'bizar');
  const portPath = require_('node:path').join(cfgDir, 'dashboard.port');
  const secretPath = require_('node:path').join(cfgDir, 'dashboard.secret');
  const port = require_('node:fs').existsSync(portPath)
    ? parseInt(require_('node:fs').readFileSync(portPath, 'utf8').trim(), 10)
    : 4321;
  const secret = require_('node:fs').existsSync(secretPath)
    ? require_('node:fs').readFileSync(secretPath, 'utf8').trim()
    : '';
  return {
    port: Number.isFinite(port) && port > 0 ? port : 4321,
    secret,
  };
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiGet(path) {
  const { port, secret } = readDashboardConn();
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}${path}`;
  const headers = { accept: 'application/json' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`cline:${secret}`).toString('base64')}`;
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(`${path}: ${data?.message || data?.error || res.statusText}`);
  return data;
}

async function apiDel(path) {
  const { port, secret } = readDashboardConn();
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}${path}`;
  const headers = { accept: 'application/json' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`cline:${secret}`).toString('base64')}`;
  const res = await fetch(url, { method: 'DELETE', headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(`${path}: ${data?.message || data?.error || res.statusText}`);
  return data;
}

// ── Help ──────────────────────────────────────────────────────────────────────

export function showClipHelp() {
  console.log(`
  bizar clip — Manage web clips (saved via the browser extension or bookmarklet)

  Usage:
    bizar clip list               List recent clips
    bizar clip delete <id>        Delete a clip from the log
    bizar clip configure          Show the current dashboard connection

  Examples:
    bizar clip list
    bizar clip delete my_page_1712345678
  `);
}

// ── Subcommand handlers ────────────────────────────────────────────────────────

async function listClips() {
  try {
    const data = await apiGet('/api/clipboard/list');
    const clips = data.clips || [];
    if (clips.length === 0) {
      console.log(chalk.dim('  No clips yet.'));
      return;
    }
    console.log('');
    console.log(chalk.bold('  Recent Clips'));
    console.log('');
    for (const c of clips) {
      const date = c.savedAt ? new Date(c.savedAt).toLocaleString() : '—';
      console.log(`  ${chalk.bold(c.id)}`);
      console.log(`    Title: ${c.title || 'Untitled'}`);
      console.log(`    Saved: ${date}`);
      console.log(`    Path:  ${c.notePath || '—'}`);
      console.log('');
    }
  } catch (err) {
    console.error(chalk.red(`  ✗ Failed to list clips: ${err.message}`));
    process.exit(1);
  }
}

async function deleteClip(id) {
  if (!id) {
    console.error(chalk.red('  Error: clip ID is required'));
    console.error('  Usage: bizar clip delete <id>');
    process.exit(1);
  }
  try {
    await apiDel(`/api/clipboard/${encodeURIComponent(id)}`);
    console.log(chalk.green(`  ✓ Clip "${id}" deleted from log.`));
  } catch (err) {
    if (err.message.includes('404')) {
      console.error(chalk.red(`  ✗ Clip "${id}" not found.`));
    } else {
      console.error(chalk.red(`  ✗ Failed to delete clip: ${err.message}`));
    }
    process.exit(1);
  }
}

function showConfigure() {
  const conn = readDashboardConn();
  console.log('');
  console.log(chalk.bold('  Dashboard Connection'));
  console.log('');
  console.log(`  URL:   http://127.0.0.1:${conn.port}`);
  console.log(`  Auth:  ${conn.secret ? 'enabled' : 'disabled'}`);
  console.log('');
  console.log(chalk.dim('  To change the dashboard URL, use: bizar dash configure'));
  console.log('');
}

// ── Main dispatcher ────────────────────────────────────────────────────────────

export async function run(name, args, isHelpRequest) {
  const sub = args[0];
  const subArgs = args.slice(1);

  if (!sub || sub === '--help' || sub === '-h' || isHelpRequest) {
    showClipHelp();
    return;
  }

  switch (sub) {
    case 'list':
      await listClips();
      break;
    case 'delete':
      await deleteClip(subArgs[0]);
      break;
    case 'configure':
      showConfigure();
      break;
    default:
      console.error(chalk.red(`  ✗ Unknown subcommand: ${sub}`));
      showClipHelp();
      process.exit(1);
  }
}
