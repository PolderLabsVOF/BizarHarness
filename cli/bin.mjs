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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { runInstaller } from './install.mjs';
import { runAudit } from './audit.mjs';
import { runInit } from './init.mjs';
import { runExport } from './export.mjs';
import runPlan from './plan.mjs';
import { runUpdate } from './update.mjs';
import { runGraph } from './graph.mjs';
import { ensureSetup, checkSetupStatus } from './bootstrap.mjs';

const args = process.argv.slice(2);
const isHelpRequest = args.includes('--help') || args.includes('-h');
const isVersionRequest = args.includes('--version') || args.includes('-v');

// ── Bootstrap ─────────────────────────────────────────────────────────────────
// Every bin command checks setup status on first invocation.
// Skip only when: --postinstall (manual trigger), --check (status only),
// --help / --version (informational), BIZAR_SKIP_INSTALL=1 (disabled),
// or already handled via npm script.
if (
  !args.includes('--postinstall') &&
  !args.includes('--check') &&
  !isHelpRequest &&
  !isVersionRequest &&
  !process.env.BIZAR_SKIP_INSTALL
) {
  await ensureSetup({ silent: true });
}
// ─────────────────────────────────────────────────────────────────────────────

function readCliVersion() {
  try {
    const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getBizarConfigDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA
      ? join(process.env.APPDATA, 'bizar')
      : join(process.env.HOME || process.cwd(), '.config', 'bizar');
  }
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'bizar')
    : join(process.env.HOME || process.cwd(), '.config', 'bizar');
}

function showHelp() {
  console.log(`
  Bizar — Norse Pantheon Agent System for opencode

  Usage:
    bizar                       Launch the TUI dashboard (auto-runs first-time setup if needed)
    bizar --web                 Launch TUI + auto-open web dashboard
    bizar --no-web              Launch TUI only (no browser)
    bizar --web-only            Web dashboard only (no TUI, in browser)
    bizar --bg, --detach        Launch web dashboard in background, return to shell
    bizar install               Run the interactive installer
    bizar audit                 Run security audit on agent configuration
    bizar init                  Initialize .bizar/ in current project
    bizar export [target]       Export agents/rules to another harness
    bizar plan <subcommand>     Manage visual plans
    bizar graph                 Per-project knowledge graph (powered by graphify)
    bizar test-gate             Detect & run the project's test suite
    bizar update                Update opencode, bizar, and/or bizar-plugin
    bizar service               Manage the background service daemon
    bizar dashboard             Launch the web dashboard (uses bizar)
    bizar --setup               Re-run setup manually (agents, plugin, RTK, Semble, Skills CLI)
    bizar --check               Print setup status as JSON, exit 1 if setup needed
    bizar --version             Show package version
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

  Usage:
    bizar init

  Description:
    Detects the project stack, creates .bizar/PROJECT.md and
    .bizar/AGENTS_SELF_IMPROVEMENT.md, installs relevant skills,
    and builds the per-project knowledge graph in .bizar/graph/
    (requires graphify — pip install graphifyy — otherwise the
    graph step is skipped gracefully).
  `);
}

function showGraphHelp() {
  console.log(`
  bizar graph — Per-project knowledge graph (powered by graphify)

  Usage:
    bizar graph build              # full build of the project graph
    bizar graph update             # incremental rebuild
    bizar graph query "<text>"     # query the graph
    bizar graph path "<A>" "<B>"   # shortest path between concepts
    bizar graph explain "<X>"      # all nodes related to a concept
    bizar graph watch              # watch for changes and rebuild
    bizar graph status             # show graph path, size, node/edge/community counts
    bizar graph install            # install graphify + drop OpenCode skill/plugin

  Requires Python 3.10+ and \`graphify\` (pip install graphifyy).
  Graph data lives in .bizar/graph/ inside this project.
  `);
}

function showExportHelp() {
  console.log(`
  bizar export — Export agents/rules to another harness

  Usage:
    bizar export [claude|cursor|opencode]

  Description:
    Copies installed Bizar agents and rules into another harness format.
  `);
}

function showInstallHelp() {
  console.log(`
  bizar install — Run the interactive installer

  Usage:
    bizar install

  Description:
    Installs agents, rules, commands, plugin support, RTK, Semble,
    and the Skills CLI.
  `);
}

function showUpdateHelp() {
  console.log(`
  bizar update — Update opencode, bizar, bizar-dash, and/or bizar-plugin

  Usage:
    bizar update                       Interactive prompt for components
    bizar update --all                 Update every component
    bizar update opencode bizar dash    Update specific components
    bizar update --all --yes           Update everything + auto-kill running instances
    bizar update --no-restart          Don't auto-restart the dashboard after update
    bizar update --help                Show this help

  Components:
    opencode   the opencode CLI itself
    bizar      @polderlabs/bizar (this CLI + installer + agents + rules)
    dash       @polderlabs/bizar-dash (web dashboard + TUI)
    plugin     @polderlabs/bizar-plugin (opencode plugin)

  Behavior:
    • Detects running Bizar instances (background service daemon, web
      dashboard) by reading ~/.config/bizar/{service,dashboard}.pid and
      cleaning up any stale or empty PID files.
    • Warns the user explicitly before killing each instance. Pass
      --yes / -y / --force to skip the confirmation (required for
      non-interactive shells).
    • Sends SIGTERM, waits up to 5s, escalates to SIGKILL if needed.
    • Re-runs the install script so the deployed plugin source matches
      the just-upgraded npm version (avoids the version-skew trap).
    • If the dashboard was running and bizar / bizar-dash were updated,
      spawns a fresh detached dashboard process with the new code
      (skipped with --no-restart).

  Examples:
    bizar update --all --yes           Headless full update + restart
    bizar update dash                  Update only the dashboard
    bizar update plugin --no-restart   Plugin-only, leave dashboard alone
  `);
}

function showTestGateHelp() {
  console.log(`
  bizar test-gate — Detect & run the project's test suite
  `);
}

function showServiceHelp() {
  const bizarConfigDir = getBizarConfigDir();
  console.log(`
  bizar service — Manage the background service daemon

  Usage:
    bizar service start        Start the service in background
    bizar service stop         Stop the running service
    bizar service status       Show whether the service is running
    bizar service logs         Tail the service log
    bizar service follow       Follow the service log until Ctrl-C

  Description:
    The service watches per-project schedules (cron / interval / once)
    and runs them at the right time. It logs to
    ${bizarConfigDir}/service.log and writes its PID to
    ${bizarConfigDir}/service.pid.
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
  const localPath = fileURLToPath(new URL('../node_modules/@polderlabs/bizar-dash/src/cli.mjs', import.meta.url));
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
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`dashboard exited via signal ${signal}`));
        return;
      }
      reject(new Error(`dashboard exited with code ${code}`));
    });
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
    const bizarConfigDir = process.platform === 'win32'
      ? (process.env.APPDATA
        ? path.join(process.env.APPDATA, 'bizar')
        : path.join(os.homedir(), '.config', 'bizar'))
      : (process.env.XDG_CONFIG_HOME
        ? path.join(process.env.XDG_CONFIG_HOME, 'bizar')
        : path.join(os.homedir(), '.config', 'bizar'));
    const file = path.join(bizarConfigDir, 'settings.json');
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

async function main() {
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
  } else if (isVersionRequest) {
    console.log(readCliVersion());
  } else if (args[0] === 'audit') {
    if (isHelpRequest) showAuditHelp();
    else await runAudit();
  } else if (args[0] === 'init') {
    if (isHelpRequest) showInitHelp();
    else await runInit(process.cwd());
  } else if (args[0] === 'graph') {
    if (isHelpRequest) showGraphHelp();
    else await runGraph(args.slice(1));
  } else if (args[0] === 'export') {
    if (isHelpRequest) showExportHelp();
    else await runExport(parseFlag('--target'));
  } else if (args[0] === 'test-gate') {
    if (isHelpRequest) showTestGateHelp();
    else await runTestGate();
  } else if (args[0] === 'update') {
    if (isHelpRequest) showUpdateHelp();
    else await runUpdate(args.slice(1));
  } else if (args[0] === 'plan') {
    await runPlan(args.slice(1), {});
  } else if (args[0] === 'install') {
    if (isHelpRequest) showInstallHelp();
    else await runInstaller();
  } else if (args[0] === 'service') {
    if (isHelpRequest) showServiceHelp();
    else await runServiceCommand(args[1]);
  } else if (args[0] === 'dashboard' || args[0] === 'start' || args[0] === 'stop' || args[0] === 'status' || args[0] === 'tui') {
    if (isHelpRequest) showDashboardHelp();
    else await delegateToDash(args.slice(1));
  } else if (args.includes('--bg') || args.includes('--detach')) {
    // Delegate to bizar-dash
    await delegateToDash(['--bg']);
  } else if (args.includes('--web-only')) {
    await delegateToDash(['--web-only']);
  } else if (isHelpRequest) {
    showHelp();
  } else {
    // Default: launch the TUI dashboard. The TUI lives in bizar-dash.
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
}

await main().catch((err) => {
  console.error(chalk.red(`bizar: ${err && err.message ? err.message : String(err)}`));
  process.exit(1);
});
