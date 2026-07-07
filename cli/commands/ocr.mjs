/**
 * cli/commands/ocr.mjs
 *
 * v5.0.0 — OCR CLI subcommand.
 *
 * Subcommands:
 *   bizar ocr list              List recent OCR operations
 *   bizar ocr process <file>    Run OCR on a local image file
 *   bizar ocr configure         Show current dashboard connection
 */

import chalk from 'chalk';
import { readFileSync, existsSync } from 'node:fs';
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

async function apiPost(path, body = {}) {
  const { port, secret } = readDashboardConn();
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}${path}`;
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`cline:${secret}`).toString('base64')}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(`${path}: ${data?.message || data?.error || res.statusText}`);
  return data;
}

// ── Help ──────────────────────────────────────────────────────────────────────

export function showOcrHelp() {
  console.log(`
  bizar ocr — OCR (Optical Character Recognition) operations

  Usage:
    bizar ocr list                List recent OCR operations
    bizar ocr process <file>      Run OCR on a local image file and save result
    bizar ocr configure           Show the current dashboard connection

  Examples:
    bizar ocr list
    bizar ocr process screenshot.png
  `);
}

// ── Subcommand handlers ────────────────────────────────────────────────────────

async function listOcr() {
  try {
    const data = await apiGet('/api/ocr/list');
    const entries = data.entries || [];
    if (entries.length === 0) {
      console.log(chalk.dim('  No OCR entries yet.'));
      return;
    }
    console.log('');
    console.log(chalk.bold('  Recent OCR Operations'));
    console.log('');
    for (const e of entries) {
      const date = e.savedAt ? new Date(e.savedAt).toLocaleString() : '—';
      console.log(`  ${chalk.bold(e.id)}`);
      console.log(`    Date:   ${date}`);
      console.log(`    Path:   ${e.notePath || '—'}`);
      console.log(`    Length: ${e.textLength || 0} chars`);
      console.log('');
    }
  } catch (err) {
    console.error(chalk.red(`  ✗ Failed to list OCR entries: ${err.message}`));
    process.exit(1);
  }
}

async function processImage(filePath) {
  if (!filePath) {
    console.error(chalk.red('  Error: image file path is required'));
    console.error('  Usage: bizar ocr process <file>');
    process.exit(1);
  }

  if (!existsSync(filePath)) {
    console.error(chalk.red(`  ✗ File not found: ${filePath}`));
    process.exit(1);
  }

  console.log(chalk.bold(`  Processing: ${filePath}`));

  try {
    const imageBuffer = readFileSync(filePath);
    const base64 = imageBuffer.toString('base64');

    console.log(chalk.dim('  Sending to OCR endpoint…'));

    const result = await apiPost('/api/ocr/process', { image: base64, lang: 'eng' });
    console.log('');
    console.log(chalk.green('  ✓ OCR complete'));
    console.log(`    Note:  ${result.notePath}`);
    console.log(`    Chars: ${result.text?.length || 0}`);
    console.log('');
    console.log(chalk.bold('  Extracted Text:'));
    console.log('');
    console.log(`  ${(result.text || '(no text found)').substring(0, 2000)}`);
    if ((result.text?.length || 0) > 2000) {
      console.log(chalk.dim(`  … (truncated, ${result.text.length} total chars)`));
    }
    console.log('');
  } catch (err) {
    console.error(chalk.red(`  ✗ OCR failed: ${err.message}`));
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
}

// ── Main dispatcher ────────────────────────────────────────────────────────────

export async function run(name, args, isHelpRequest) {
  const sub = args[0];
  const subArgs = args.slice(1);

  if (!sub || sub === '--help' || sub === '-h' || isHelpRequest) {
    showOcrHelp();
    return;
  }

  switch (sub) {
    case 'list':
      await listOcr();
      break;
    case 'process':
      await processImage(subArgs[0]);
      break;
    case 'configure':
      showConfigure();
      break;
    default:
      console.error(chalk.red(`  ✗ Unknown subcommand: ${sub}`));
      showOcrHelp();
      process.exit(1);
  }
}
