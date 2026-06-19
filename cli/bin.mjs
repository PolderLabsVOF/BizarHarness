#!/usr/bin/env node
/**
 * cli/bin.mjs
 *
 * v3.0.0 — `bizar` runtime CLI.
 *
 * Architecture:
 *   - `bizar` is the core runtime + installer + audit/init/export/update/plan
 *     + service commands.
 *   - The dashboard lives in a separate package, `@polderlabs/bizar-dash`.
 *     If it's installed, `bizar dashboard` / `bizar --web*` will defer to it.
 *     If not, the user is told to install it.
 *
 * Subcommands (unchanged from v2.7.0):
 *   install, audit, init, export, plan, update, test-gate, service
 *
 * Flags (unchanged):
 *   --web / --no-web / --web-only / --bg / --detach
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { runInstaller, runPostInstall } from './install.mjs';
import { runAudit } from './audit.mjs';
import { runInit } from './init.mjs';
import { runExport } from './export.mjs';
import runPlan from './plan.mjs';
import { runUpdate } from './update.mjs';
import { ensureSetup, checkSetupStatus } from './bootstrap.mjs';

const args = process.argv.slice(2);

// ── Bootstrap ─────────────────────────────────────────────────────────────────
// Every bin command checks setup status on first invocation.
// Skip only when: --postinstall (manual trigger), --check (status only),
// BIZAR_SKIP_INSTALL=1 (disabled), or already handled via npm script.
if (
  !args.includes('--postinstall') &&
  !args.includes('--check') &&
  !process.env.BIZAR_SKIP_INSTALL
) {
  await ensureSetup({ silent: true });
}
// ─────────────────────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
  Bizar — Norse Pantheon Agent System for opencode

  Usage:
    bizar                       Launch the TUI dashboard (auto-runs first-time setup if needed)
    bizar --web                 Launch TUI + auto-open web dashboard
    bizar --no-web              Launch TUI only (no browser)
    bizar --web-only            Web dashboard only (no TUI, in browser)
    bizar --bg, --detach        Launch web dashboard in background, return to shell
    install                     Run the interactive installer
    bizar install               Same as \`install\`
    bizar audit                 Run security audit on agent configuration
    bizar init                  Initialize .bizar/ in current project
    bizar export [target]       Export agents/rules to another harness
    bizar plan <subcommand>     Manage visual plans
    bizar test-gate             Detect & run the project's test suite
    bizar update                Update opencode, bizar, and/or bizar-plugin
    bizar service               Manage the background service daemon
    bizar dashboard             Launch the web dashboard (uses bizar-dash)
    bizar --setup               Re-run setup manually (agents, plugin, RTK, Semble, Skills CLI)
    bizar --check               Print setup status as JSON, exit 1 if setup needed
    bizar --help                Show this help

  Install:
    npm install -g @polderlabs/bizar          Install globally
    npm install -g @polderlabs/bizar-dash     Optional companion dashboard
    npm install -g @polderlabs/bizar-plugin   Bizar opencode plugin

  Notes:
    The TUI is the default command — press 1-8 for tabs, q to quit.
    \`bizar --bg\` launches the dashboard detached; \`bizar dashboard stop\`
    terminates it. The web dashboard lives in the \`@polderlabs/bizar-dash\`
    package — if it's not installed, you'll be prompted to install it.
  `);
}

function showAuditHelp() {
  console.log(`
  bizar audit — Run security audit on agent configuration

  Usage:
    bizar audit
  `);
}

function showInitHelp() {
  console.log(`
  bizar init — Initialize .bizar/ in current project
  `);
}

function showExportHelp() {
  console.log(`
  bizar export — Export agents/rules to another harness
  `);
}

function showTestGateHelp() {
  console.log(`
  bizar test-gate — Detect & run the project's test suite
  `);
}

function showServiceHelp() {
  console.log(`
  bizar service — Manage the background service daemon

  Usage:
    bizar service start        Start the service in background
    bizar service stop         Stop the running service
    bizar service status       Show whether the service is running
    bizar service logs         Tail the service log

  Description:
    The service watches per-project schedules (cron / interval / once)
    and runs them at the right time. It logs to
    ~/.config/bizar/service.log and writes its PID to
    ~/.config/bizar/service.pid.
  `);
}

function showDashboardHelp() {
  console.log(`
  bizar dashboard — Launch the web dashboard (uses @polderlabs/bizar-dash)

  Usage:
    bizar dashboard             Start the dashboard
    bizar dashboard start       Same
    bizar dashboard stop        Kill the running dashboard
    bizar dashboard status      Show port + URL

  Description:
    The dashboard lives in a separate package. If it's not installed,
    you'll see an install hint pointing at @polderlabs/bizar-dash.
  `);
}

/**
 * Detect whether @polderlabs/bizar-dash is installed locally.
 * We probe the global npm root, but also look in the local node_modules
 * of the bizar package itself.
 */
async function findBizarDash() {
  const { execSync } = await import('node:child_process');
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', timeout: 5000 }).trim();
    const dashPath = join(root, '@polderlabs', 'bizar-dash', 'src', 'cli.mjs');
    if (existsSync(dashPath)) return dashPath;
  } catch {
    /* fall through */
  }
  // Local fallback — node_modules of this package
  const here = new URL('..', import.meta.url);
  const localPath = join(here.pathname, '..', 'node_modules', '@polderlabs', 'bizar-dash', 'src', 'cli.mjs');
  if (existsSync(localPath)) return localPath;
  return null;
}

/**
 * Delegate a subcommand to the bizar-dash CLI, if installed.
 */
async function delegateToDash(argsForDash) {
  const dashPath = await findBizarDash();
  if (!dashPath) {
    console.log('The Bizar dashboard lives in a separate package.');
    console.log('Install it with:');
    console.log(chalk.cyan('  npm install -g @polderlabs/bizar-dash'));
    return;
  }
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [dashPath, ...argsForDash], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  await new Promise((resolve, reject) => {
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
    child.on('error', reject);
  });
}

function parseFlag(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

async function readAutoLaunchWeb() {
  try {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const file = path.join(os.homedir(), '.config', 'bizar', 'settings.json');
    if (!fs.existsSync(file)) return true;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && parsed.dashboard && typeof parsed.dashboard.autoLaunchWeb === 'boolean') {
      return parsed.dashboard.autoLaunchWeb;
    }
  } catch {
    /* fall through */
  }
  return true;
}

async function runTestGate() {
  console.log(chalk.bold.hex('#a855f7')('\n  ᚦ TEST GATE ᚦ\n'));
  const { execSync } = await import('node:child_process');
  const cwd = process.cwd();
  const possible = [
    { cmd: 'npm test', check: 'package.json' },
    { cmd: 'pytest', check: 'pyproject.toml' },
    { cmd: 'cargo test', check: 'Cargo.toml' },
    { cmd: 'go test ./...', check: 'go.mod' },
  ];
  for (const suite of possible) {
    try {
      if (existsSync(join(cwd, suite.check))) {
        console.log(`  Running: ${suite.cmd}`);
        execSync(suite.cmd, { stdio: 'inherit', timeout: 120000, cwd });
        console.log('\n  ✓ Test gate passed\n');
        return true;
      }
    } catch {
      console.log(`\n  ✗ Test gate failed: ${suite.cmd}\n`);
      process.exit(1);
    }
  }
  console.log('  No test suite detected. Install one to use the test gate.\n');
  return false;
}

/**
 * Service commands — start / stop / status / logs.
 *
 * Implementation lives in cli/service.mjs (created below).
 */
async function runServiceCommand(sub) {
  const { runService } = await import('./service.mjs');
  await runService(sub || 'status', args.slice(2));
}

if (args.includes('--check')) {
  const status = checkSetupStatus();
  console.log(JSON.stringify(status, null, 2));
  process.exit(status.needed ? 1 : 0);
} else if (args.includes('--setup')) {
  await ensureSetup({ silent: false });
  process.exit(0);
} else if (args.includes('--postinstall')) {
  // Legacy manual trigger — now an alias for --setup
  await ensureSetup({ silent: false });
  process.exit(0);
} else if (args[0] === 'audit') {
  if (args.includes('--help') || args.includes('-h')) showAuditHelp();
  else await runAudit();
} else if (args[0] === 'init') {
  if (args.includes('--help') || args.includes('-h')) showInitHelp();
  else await runInit(process.cwd());
} else if (args[0] === 'export') {
  if (args.includes('--help') || args.includes('-h')) showExportHelp();
  else await runExport(parseFlag('--target'));
} else if (args[0] === 'test-gate') {
  if (args.includes('--help') || args.includes('-h')) showTestGateHelp();
  else await runTestGate();
} else if (args[0] === 'update') {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Run bizar update [opencode|bizar|plugin]');
  } else {
    await runUpdate(args.slice(1));
  }
} else if (args[0] === 'plan') {
  await runPlan(args.slice(1), {});
} else if (args[0] === 'install') {
  await runInstaller();
} else if (args[0] === 'service') {
  if (args.includes('--help') || args.includes('-h')) showServiceHelp();
  else await runServiceCommand(args[1]);
} else if (args[0] === 'dashboard') {
  if (args.includes('--help') || args.includes('-h')) showDashboardHelp();
  else await delegateToDash(args.slice(1));
} else if (args.includes('--bg') || args.includes('--detach')) {
  // Delegate to bizarre-dash
  await delegateToDash(['--bg']);
} else if (args.includes('--web-only')) {
  await delegateToDash(['--web-only']);
} else if (args.includes('--help') || args.includes('-h')) {
  showHelp();
} else {
  // Default: launch the TUI dashboard. The TUI lives in bizar-dash.
  // We try to use the bizar-dash package's TUI, but we also support a
  // bundled fallback that imports from this package's local copy.
  const dashPath = await findBizarDash();
  if (dashPath) {
    const skipWeb = args.includes('--no-web');
    const forceWeb = args.includes('--web');
    const settingAuto = await readAutoLaunchWeb();
    const launchWeb = !skipWeb && (forceWeb || settingAuto);
    await delegateToDash(['tui', ...(launchWeb ? [] : ['--no-web'])]);
  } else {
    console.log('The Bizar dashboard is in a separate package:');
    console.log(chalk.cyan('  npm install -g @polderlabs/bizar-dash'));
    console.log('');
    console.log('Or run the installer to set up everything:');
    console.log(chalk.cyan('  npx -y @polderlabs/bizar install'));
  }
}
