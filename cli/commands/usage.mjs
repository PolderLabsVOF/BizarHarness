/**
 * cli/commands/usage.mjs
 *
 * Usage analytics CLI — fetches from the running dashboard.
 * v4.6.0+ — compact usage summary from the JSONL store.
 */
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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

export function showUsageHelp() {
  console.log(`
  bizar usage — Show compact usage analytics summary

  Usage:
    bizar usage [24h|7d|30d]   Show summary for the given range (default: 24h)

  Examples:
    bizar usage
    bizar usage 7d
    bizar usage 30d
  `);
}

// ── Command runner ─────────────────────────────────────────────────────────────

async function runUsageCommand(args, wantJson = false) {
  const range = (args[0] && ['24h', '7d', '30d'].includes(args[0])) ? args[0] : '24h';
  const { port, secret } = readDashboardConn();
  const url = `http://127.0.0.1:${port}/api/usage?range=${range}`;
  const headers = { accept: 'application/json' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`cline:${secret}`).toString('base64')}`;
  try {
    const resp = await fetch(url, { method: 'GET', headers });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (!resp.ok || !data) {
      console.error(chalk.red(`  ✗ Failed to load usage data: ${data?.message ?? resp.statusText}`));
      process.exit(1);
    }
    if (wantJson) {
      process.stdout.write(JSON.stringify(data) + '\n');
      return;
    }
    const t = data.totals;
    console.log('');
    console.log(chalk.bold(`  Usage summary — ${range} (from JSONL store)`));
    console.log('');
    console.log(`    ${chalk.dim('Requests:')}   ${t.requests.toLocaleString()}  (${t.errors} errors)`);
    console.log(`    ${chalk.dim('Tokens:')}     ${t.totalTokens.toLocaleString()} total  (${t.promptTokens.toLocaleString()} prompt · ${t.completionTokens.toLocaleString()} completion)`);
    console.log(`    ${chalk.dim('Cached:')}     ${t.cachedTokens.toLocaleString()} tokens`);
    console.log(`    ${chalk.dim('Reasoning:')}  ${t.reasoningTokens.toLocaleString()} tokens`);
    console.log(`    ${chalk.dim('Avg latency:')} ${t.avgLatencyMs}ms  (p95: ${t.p95LatencyMs}ms)`);
    if (t.costEstimate > 0) {
      console.log(`    ${chalk.dim('Est. cost:')}   $${t.costEstimate.toFixed(4)} USD`);
    }
    console.log('');
    if (data.daily && data.daily.length > 0) {
      console.log(chalk.dim(`  ${chalk.bold('Daily breakdown')}`));
      for (const day of data.daily.slice(-7)) {
        const barLen = Math.round((day.totalTokens / Math.max(...data.daily.map(d => d.totalTokens))) * 20);
        const bar = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
        console.log(`    ${day.date}  ${bar}  ${day.totalTokens.toLocaleString()} tok  ${day.requests} req`);
      }
    }
    if (data.perModel && data.perModel.length > 0) {
      console.log('');
      console.log(chalk.dim(`  ${chalk.bold('Per model')}`));
      for (const m of data.perModel.slice(0, 8)) {
        console.log(`    ${m.modelId.padEnd(24)} ${String(m.requests).padStart(6)} req  ${String(m.totalTokens).padStart(8)} tok`);
      }
    }
    console.log('');
  } catch (err) {
    console.error(chalk.red(`  ✗ Network error: ${err && err.message ? err.message : String(err)}`));
    console.error(chalk.dim('    Is the dashboard running? Run `bizar dash start` first.'));
    process.exit(1);
  }
}

export async function run(name, args, isHelpRequest) {
  await runUsageCommand(args, false);
}
