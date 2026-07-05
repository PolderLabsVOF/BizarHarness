/**
 * cli/commands/dash.mjs
 *
 * Dashboard (bizar dash) subcommand dispatcher.
 */
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const BIZAR_HOME = join(__dirname, '..', '..');

export function showDashHelp() {
  console.log(`
  bizar dash — Manage the Bizar dashboard

  Usage:
    bizar dash <subcommand> [options]　

  Subcommands:
    start [--bg] [--port N]   Start the dashboard (default port 4321)
    stop                       Stop the running dashboard
    status                     Show dashboard port and URL
    cleanup                    Find + kill zombie/orphan dashboards
    tui [--no-web]             Launch the TUI

  Options:
    --bg                       Detach and run in background (for start)
    --port N                   Override the default port
    --no-web                   Skip launching the web UI (for tui)

  Examples:
    bizar dash start
    bizar dash start --bg
    bizar dash stop
    bizar dash status
    bizar dash tui
    bizar dash tui --no-web

  Note:
    \`bizar dashboard\` is a deprecated alias for \`bizar dash\` and still
    works, but new code should use \`bizar dash\`.

  OpenTelemetry (optional, env vars):
    BIZAR_OTEL=1                       Enable OpenTelemetry tracing (off by default)
    OTEL_ENABLED=1                     Alias that also opts in
    OTEL_EXPORTER_OTLP_ENDPOINT        OTLP HTTP traces endpoint
                                       (default http://localhost:4318/v1/traces)
  `);
}

// ── Option parsing ──────────────────────────────────────────────────────────────

/**
 * Parse dash-specific options from an array of args.
 * Returns { opts, remaining } where opts have --bg / --port stripped.
 */
export function parseDashOpts(dashArgs) {
  const opts = { bg: false, port: null, noWeb: false };
  const remaining = [];
  for (let i = 0; i < dashArgs.length; i++) {
    const a = dashArgs[i];
    if (a === '--bg') {
      opts.bg = true;
    } else if (a === '--no-web') {
      opts.noWeb = true;
    } else if (a === '--port' && i + 1 < dashArgs.length) {
      opts.port = Number(dashArgs[i + 1]);
      i++;
    } else {
      remaining.push(a);
    }
  }
  return { opts, remaining };
}

// ── Dashboard CLI loader ───────────────────────────────────────────────────────

/**
 * Try to load the dashboard CLI module.
 * v4.0.0: the dashboard ships inside this package at bizar-dash/src/cli.mjs.
 * A legacy npm-global fallback is kept for the transitional period.
 */
export async function loadDashCli() {
  const primary = join(__dirname, '..', '..', 'bizar-dash', 'src', 'cli.mjs');

  // Legacy npm-global fallback (only computed if primary is missing)
  let legacyFallbacks = [];
  try {
    const { execFileSync } = await import('node:child_process');
    const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000 }).trim();
    if (npmRoot) legacyFallbacks = [join(npmRoot, '@polderlabs', 'bizar-dash', 'src', 'cli.mjs')];
  } catch { /* npm not available or no globals — fine */ }

  const candidates = [primary, ...legacyFallbacks];

  for (const p of candidates) {
    try {
      const url = pathToFileURL(p).href;
      const mod = await import(url);
      return mod;
    } catch (_e) {
      // try next
    }
  }
  return null;
}

// ── Main dispatcher ────────────────────────────────────────────────────────────

/**
 * Dispatch a dashboard subcommand by loading the dashboard module and
 * calling the appropriate exported function.
 */
export async function runDash(dashArgs) {
  const { opts, remaining } = parseDashOpts(dashArgs);
  const sub = remaining[0];
  const subOpts = { ...opts, subArgs: remaining.slice(1) };

  const dashModule = await loadDashCli();
  if (!dashModule) {
    console.error(chalk.red('  ✗ Dashboard not found.'));
    console.error(chalk.dim('  this should not happen — please report a bug at github.com/DrB0rk/BizarHarness/issues'));
    process.exit(1);
  }

  switch (sub) {
    case 'start':
      if (subOpts.bg) {
        await dashModule.startInBackground(['start', ...(subOpts.subArgs || [])]);
      } else {
        await dashModule.start(subOpts);
      }
      break;
    case 'stop':
      await dashModule.stop(subOpts);
      break;
    case 'status':
      await dashModule.status(subOpts);
      break;
    case 'cleanup':
      await dashModule.cleanup(subOpts);
      break;
    case 'tui':
      await dashModule.tui(subOpts);
      break;
    default:
      console.error(chalk.red(`  ✗ Unknown subcommand: ${sub}`));
      showDashHelp();
      process.exit(1);
  }
}

export async function run(name, args, isHelpRequest) {
  // Handle 'dashboard' as deprecated alias for 'dash'
  if (name === 'dashboard') {
    process.stdout.write(chalk.yellow('  ⚠ `bizar dashboard` is deprecated, use `bizar dash` instead.\n'));
  }
  if (args.length === 0 || isHelpRequest) {
    showDashHelp();
    return;
  }
  await runDash(args);
}
