/**
 * cli/commands/minimax.mjs
 *
 * MiniMax Token Plan integration CLI.
 * v4.5.0+ — status, remains, test, config, clear, reset-onboarding.
 */
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

async function minimaxApi(path, opts = {}) {
  const { port, secret } = readDashboardConn();
  const url = `http://127.0.0.1:${port}${path}`;
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`opencode:${secret}`).toString('base64')}`;
  const method = (opts.method || 'GET').toUpperCase();
  try {
    const resp = await fetch(url, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (!resp.ok) {
      return { ok: false, error: `http_${resp.status}`, message: data?.message || data?.error || resp.statusText, status: resp.status };
    }
    return { ok: true, status: resp.status, data };
  } catch (err) {
    return { ok: false, error: 'network_error', message: err && err.message ? err.message : String(err) };
  }
}

// ── Help ───────────────────────────────────────────────────────────────────────

export function showMinimaxHelp() {
  console.log(`
  bizar minimax — Manage the MiniMax Token Plan integration

  Usage:
    bizar minimax status              Show whether the Subscription Key is configured
                                       and where it was resolved from (auth.json,
                                       opencode.json, env var, or none).
    bizar minimax remains              Fetch the live 5-hour + weekly remaining
                                       quota per model. Shows reset times.
    bizar minimax test                 Smoke-test the key with a one-shot chat
                                       completion. Prints the usage block.
    bizar minimax config <key>         Save a new Subscription Key to
                                       ~/.local/share/opencode/auth.json. The
                                       key never leaves this machine.
    bizar minimax clear                Remove the Subscription Key from
                                       opencode's auth.json.
    bizar minimax reset-onboarding    Re-trigger the first-run wizard. Use
                                       this if the key was changed outside the
                                       dashboard and you want to re-enter it.

  Flags:
    --base-url <url>    Override the Token Plan host (default: https://www.minimax.io)
    --chat-url  <url>    Override the chat-completions host (default: https://api.minimax.io/v1)
    --yes                 Skip the confirmation prompt on 'clear' and 'reset-onboarding'
  `);
}

// ── Subcommand handlers ─────────────────────────────────────────────────────────

async function runMinimaxCommand(minimaxArgs) {
  const sub = minimaxArgs[0];
  const flags = minimaxArgs.slice(1).filter((a) => a.startsWith('-'));
  const positional = minimaxArgs.slice(1).filter((a) => !a.startsWith('-'));
  const yes = flags.includes('--yes') || flags.includes('-y');

  if (!sub || sub === '--help' || sub === '-h' || flags.includes('--help') || flags.includes('-h')) {
    showMinimaxHelp();
    return;
  }

  if (sub === 'status') {
    const r = await minimaxApi('/api/minimax/status');
    if (!r.ok) {
      console.error(chalk.red(`  ✗ ${r.message || r.error}`));
      process.exit(1);
    }
    if (!r.data) {
      console.error(chalk.red('  ✗ Dashboard returned no data. Is the dashboard running?'));
      console.error(chalk.dim(`    Tried: http://127.0.0.1:4321/api/minimax/status`));
      process.exit(1);
    }
    const s = r.data;
    console.log('');
    console.log(chalk.bold('  MiniMax Token Plan status'));
    console.log('');
    console.log(`    ${chalk.dim('configured:')}    ${s.configured ? chalk.green('yes') : chalk.red('no')}`);
    console.log(`    ${chalk.dim('key source:')}    ${chalk.cyan(s.source)}`);
    if (s.apiKeyHint) console.log(`    ${chalk.dim('key hint:')}      ${s.apiKeyHint}`);
    console.log(`    ${chalk.dim('group id:')}     ${s.groupId}`);
    console.log(`    ${chalk.dim('token host:')}   ${s.tokenBaseUrl}`);
    console.log(`    ${chalk.dim('chat host:')}    ${s.chatBaseUrl}`);
    console.log(`    ${chalk.dim('key format:')}   ${s.keyPatternValid === true ? chalk.green('ok') : s.keyPatternValid === false ? chalk.red('unexpected prefix') : chalk.dim('n/a')}`);
    console.log('');
    if (s.cache) {
      console.log(`    ${chalk.dim('cached:')}         ${new Date(s.cache.fetchedAt).toLocaleString()} (${s.cache.modelCount} models)`);
    } else {
      console.log(`    ${chalk.dim('cached:')}         none yet — run \`bizar minimax remains\` to populate`);
    }
    return;
  }

  if (sub === 'remains') {
    const r = await minimaxApi('/api/minimax/remains');
    if (!r.ok) {
      console.error(chalk.red(`  ✗ ${r.message || r.error}`));
      process.exit(1);
    }
    if (!r.data) {
      console.error(chalk.red('  ✗ Dashboard returned no data. Is the dashboard running?'));
      console.error(chalk.dim(`    Tried: http://127.0.0.1:4321/api/minimax/remains`));
      process.exit(1);
    }
    if (!r.data?.ok) {
      console.error(chalk.red(`  ✗ ${r.data?.message || r.data?.error || 'unknown'}`));
      process.exit(1);
    }
    const data = r.data;
    console.log('');
    console.log(chalk.bold(`  MiniMax Token Plan quota  (${new Date(data.fetchedAt).toLocaleString()})`));
    if (data.apiKeyHint) console.log(chalk.dim(`  Key: ${data.apiKeyHint} · source: ${data.keySource} · group: ${data.groupId}`));
    console.log('');
    for (const m of data.models || []) {
      const five = m.current_interval_remaining_percent;
      const week = m.current_weekly_remaining_percent;
      // Bar shows CONSUMED as filled (inverted from remaining)
      const fiveConsumed = 100 - five;
      const weekConsumed = 100 - week;
      const fiveBar = '█'.repeat(Math.round(fiveConsumed / 5)) + '░'.repeat(20 - Math.round(fiveConsumed / 5));
      const weekBar = '█'.repeat(Math.round(weekConsumed / 5)) + '░'.repeat(20 - Math.round(weekConsumed / 5));
      const fiveColor = five >= 75 ? chalk.green : five >= 25 ? chalk.yellow : chalk.red;
      const weekColor = week >= 75 ? chalk.green : week >= 25 ? chalk.yellow : chalk.red;
      console.log(`    ${chalk.bold(m.model_name)}`);
      console.log(`      ${chalk.dim('5h:')}    ${fiveColor(five + '%'.padStart(4))} ${fiveBar}  resets in ${m.intervalResetInHuman}`);
      console.log(`      ${chalk.dim('week:')}  ${weekColor(week + '%'.padStart(4))} ${weekBar}  resets in ${m.weeklyResetInHuman}`);
      console.log('');
    }
    return;
  }

  if (sub === 'test') {
    const prompt = positional[0] || 'Reply with the single word: pong';
    const r = await minimaxApi('/api/minimax/test', {
      method: 'POST',
      body: { prompt, model: 'MiniMax-M3', maxTokens: 32 },
    });
    if (!r.ok) {
      console.error(chalk.red(`  ✗ ${r.message || r.error}`));
      process.exit(1);
    }
    if (!r.data) {
      console.error(chalk.red('  ✗ Dashboard returned no data. Is the dashboard running?'));
      console.error(chalk.dim(`    Tried: http://127.0.0.1:4321/api/minimax/test`));
      process.exit(1);
    }
    const data = r.data;
    if (!data?.ok) {
      console.error(chalk.red(`  ✗ ${data?.message || data?.error || 'unknown'}`));
      process.exit(1);
    }
    console.log('');
    console.log(chalk.green('  ✓ Key works'));
    console.log(`    ${chalk.dim('model:')}     ${data.model}`);
    console.log(`    ${chalk.dim('finish:')}    ${data.finishReason}`);
    if (data.content) console.log(`    ${chalk.dim('content:')}    ${JSON.stringify(data.content.slice(0, 80))}${data.content.length > 80 ? '…' : ''}`);
    if (data.usage) {
      console.log(`    ${chalk.dim('usage:')}      total=${data.usage.total_tokens} prompt=${data.usage.prompt_tokens} completion=${data.usage.completion_tokens}`);
    }
    return;
  }

  if (sub === 'config' || sub === 'set') {
    const key = positional[0];
    if (!key) {
      console.error(chalk.red('  ✗ Missing key. Usage: bizar minimax config <sk-cp-…>'));
      process.exit(1);
    }
    if (!/^sk-(cp|ant|or)-[A-Za-z0-9_-]{20,}$/.test(key)) {
      console.error(chalk.red('  ✗ Key does not look like a MiniMax key (expected sk-cp-…, sk-ant-…, or sk-or-… prefix)'));
      process.exit(1);
    }
    console.log(chalk.dim('  Saving to opencode auth.json…'));
    const r = await minimaxApi('/api/minimax/onboarding/save-key', {
      method: 'POST',
      body: { key, groupId: 'default' },
    });
    if (!r.ok) {
      console.error(chalk.red(`  ✗ ${r.message || r.error}`));
      process.exit(1);
    }
    if (!r.data) {
      console.error(chalk.red('  ✗ Dashboard returned no data. Is the dashboard running?'));
      console.error(chalk.dim(`    Tried: http://127.0.0.1:4321/api/minimax/onboarding/save-key`));
      process.exit(1);
    }
    console.log(chalk.green(`  ✓ Saved to ${r.data?.path}`));
    console.log(`    ${chalk.dim('key hint:')} ${r.data?.apiKeyHint}`);
    return;
  }

  if (sub === 'clear' || sub === 'remove') {
    if (!yes) {
      console.log(chalk.yellow(`  ⚠ This will remove the MiniMax Subscription Key from opencode's auth.json.`));
      console.log(chalk.dim('  Continue? [y/N]'));
      const buf = [];
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { buf.push(c); if (c.includes('\n')) process.stdin.pause(); });
      await new Promise((resolve) => process.stdin.once('close', resolve));
      const answer = buf.join('').trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        console.log(chalk.dim('  Cancelled.'));
        return;
      }
    }
    const authFile = join(HOME, '.local', 'share', 'opencode', 'auth.json');
    let auth = {};
    try {
      if (existsSync(authFile)) auth = JSON.parse(readFileSync(authFile, 'utf8'));
    } catch { /* ignore */ }
    if (auth.minimax) {
      delete auth.minimax;
      writeFileSync(authFile, JSON.stringify(auth, null, 2) + '\n', 'utf8');
      console.log(chalk.green('  ✓ MiniMax key removed from auth.json'));
    } else {
      console.log(chalk.dim('  No MiniMax key was configured.'));
    }
    return;
  }

  if (sub === 'reset-onboarding' || sub === 'reset') {
    if (!yes) {
      console.log(chalk.yellow('  ⚠ This will re-trigger the first-run MiniMax onboarding wizard.'));
      console.log(chalk.dim('  Continue? [y/N]'));
      const buf = [];
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { buf.push(c); if (c.includes('\n')) process.stdin.pause(); });
      await new Promise((resolve) => process.stdin.once('close', resolve));
      const answer = buf.join('').trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        console.log(chalk.dim('  Cancelled.'));
        return;
      }
    }
    const r = await minimaxApi('/api/minimax/onboarding', {
      method: 'POST',
      body: { dismissedAt: null },
    });
    if (!r.ok) {
      console.error(chalk.red(`  ✗ ${r.message || r.error}`));
      process.exit(1);
    }
    console.log(chalk.green('  ✓ Onboarding wizard will show on next dashboard load'));
    return;
  }

  console.error(chalk.red(`  ✗ Unknown minimax subcommand: ${sub}`));
  showMinimaxHelp();
  process.exit(1);
}

export async function run(name, args, isHelpRequest) {
  await runMinimaxCommand(args);
}
