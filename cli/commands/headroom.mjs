/**
 * cli/commands/headroom.mjs
 *
 * Headroom context compression CLI.
 * v3.17.0+ — status, stats, install, wrap, unwrap, start, stop, doctor.
 */
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

const HOME = homedir();
const BIZAR_HOME = join(HOME, '.config', 'bizar');

// ── Dashboard connection ────────────────────────────────────────────────────────

function readDashboardConn() {
  const portFile = join(BIZAR_HOME, 'dashboard.port');
  const authFile = join(BIZAR_HOME, 'dashboard-secret');
  let port = 4321;
  let secret = '';
  try {
    if (existsSync(portFile)) {
      const parsed = parseInt(readFileSync(portFile, 'utf8').trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) port = parsed;
    }
  } catch { /* ignore */ }
  try {
    if (existsSync(authFile)) secret = readFileSync(authFile, 'utf8').trim();
  } catch { /* ignore */ }
  return { port, secret };
}

// ── Help ───────────────────────────────────────────────────────────────────────

export function showHeadroomHelp() {
  console.log(`
  bizar headroom — Manage Headroom context compression

  Usage:
    bizar headroom status              Show live status (installed, proxy, wrapped)
    bizar headroom stats              Show compression stats for the last 24h
    bizar headroom install            Install headroom via pip or npm
    bizar headroom wrap               Wrap opencode to route through the proxy
    bizar headroom unwrap             Unwrap opencode
    bizar headroom start              Start the proxy server
    bizar headroom stop              Stop the proxy server
    bizar headroom doctor            Run headroom doctor health check

  Examples:
    bizar headroom status
    bizar headroom stats
    bizar headroom install
    bizar headroom wrap
  `);
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function apiGet(path) {
  const { port, secret } = readDashboardConn();
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}${path}`;
  const headers = { accept: 'application/json' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`opencode:${secret}`).toString('base64')}`;
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(`${path}: ${data?.message || data?.error || res.statusText}`);
  return data;
}

async function apiPost(path, body = {}) {
  const { port, secret } = readDashboardConn();
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}${path}`;
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`opencode:${secret}`).toString('base64')}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(`${path}: ${data?.message || data?.error || res.statusText}`);
  return data;
}

// ── Command runner ────────────────────────────────────────────────────────────

async function runHeadroomCommand(headroomArgs) {
  const sub = headroomArgs[0];
  const flags = headroomArgs.slice(1).filter((a) => a.startsWith('-'));
  const positional = headroomArgs.slice(1).filter((a) => !a.startsWith('-'));

  if (!sub || sub === '--help' || sub === '-h' || flags.includes('--help') || flags.includes('-h')) {
    showHeadroomHelp();
    return;
  }

  if (sub === 'status') {
    const s = await apiGet('/api/headroom/status');
    console.log('');
    console.log(chalk.bold('  Headroom status'));
    console.log('');
    console.log(`    ${chalk.dim('installed:')}   ${s.installed ? chalk.green('yes') : chalk.red('no')} ${s.version || ''}`);
    console.log(`    ${chalk.dim('proxy:')}       ${s.proxyRunning ? chalk.green('running') : chalk.yellow('stopped')} ${s.proxyPort ? `@ ${s.proxyPort}` : ''} ${s.proxyPid ? `(PID ${s.proxyPid})` : ''}`);
    console.log(`    ${chalk.dim('wrapped:')}     ${s.wrapped ? chalk.green('yes') : chalk.yellow('no')}`);
    console.log(`    ${chalk.dim('healthy:')}     ${s.healthy === 'ok' ? chalk.green('ok') : s.healthy === 'warn' ? chalk.yellow('warn') : chalk.red('fail')}`);
    if (s.messages && s.messages.length > 0) {
      console.log('');
      for (const m of s.messages) {
        console.log(`    ${m}`);
      }
    }
    console.log('');
    return;
  }

  if (sub === 'stats') {
    const hours = parseInt(positional[0], 10) || 24;
    const st = await apiGet(`/api/headroom/stats?hours=${hours}`);
    console.log('');
    console.log(chalk.bold(`  Headroom stats (${hours}h)`));
    console.log('');
    if (st.error) {
      console.log(chalk.yellow(`    ${st.error}`));
    } else {
      console.log(`    ${chalk.dim('tokens saved:')}    ${(st.tokensSaved || 0).toLocaleString()}`);
      console.log(`    ${chalk.dim('compression:')}    ${st.compressionRatio ? `${Math.round(st.compressionRatio * 100)}%` : '—'}`);
      console.log(`    ${chalk.dim('cache hits:')}     ${st.cacheHits ?? '—'}`);
      console.log(`    ${chalk.dim('transforms:')}     ${st.transforms ?? '—'}`);
    }
    console.log('');
    return;
  }

  if (sub === 'install') {
    const r = await apiPost('/api/headroom/install', { force: true });
    if (r.installed) {
      console.log(chalk.green(`  ✓ Headroom installed via ${r.method}${r.version ? ` (${r.version})` : ''}`));
    } else {
      console.log(chalk.red('  ✗ Install failed. Try: pip install "headroom-ai[all]"'));
    }
    return;
  }

  if (sub === 'wrap') {
    const port = parseInt(positional[0], 10) || 8787;
    const r = await apiPost('/api/headroom/wrap', { port });
    if (r.ok) {
      console.log(chalk.green(`  ✓ opencode wrapped with Headroom on port ${port}`));
    } else {
      console.log(chalk.red(`  ✗ Wrap failed: ${r.log || 'unknown error'}`));
    }
    return;
  }

  if (sub === 'unwrap') {
    const r = await apiPost('/api/headroom/unwrap');
    if (r.ok) {
      console.log(chalk.green('  ✓ opencode unwrapped from Headroom'));
    } else {
      console.log(chalk.red('  ✗ Unwrap failed'));
    }
    return;
  }

  if (sub === 'start') {
    const port = parseInt(positional[0], 10) || 8787;
    const r = await apiPost('/api/headroom/proxy/start', { port, host: '127.0.0.1' });
    if (r.ok) {
      console.log(chalk.green(`  ✓ Proxy started on 127.0.0.1:${port} (PID ${r.pid})`));
    } else {
      console.log(chalk.red('  ✗ Proxy start failed'));
    }
    return;
  }

  if (sub === 'stop') {
    const r = await apiPost('/api/headroom/proxy/stop');
    if (r.ok) {
      console.log(chalk.green('  ✓ Proxy stopped'));
    } else {
      console.log(chalk.red('  ✗ Proxy stop failed'));
    }
    return;
  }

  if (sub === 'doctor') {
    // Run `headroom doctor` locally
    const child = spawn('headroom', ['doctor'], { stdio: 'inherit' });
    await new Promise((resolve) => child.on('close', resolve));
    return;
  }

  console.error(chalk.red(`  ✗ Unknown headroom subcommand: ${sub}`));
  showHeadroomHelp();
  process.exit(1);
}

export async function run(name, args, isHelpRequest) {
  await runHeadroomCommand(args);
}
