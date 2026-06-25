#!/usr/bin/env node
/**
 * cli/bin.mjs
 *
 * v3.10.0 — `bizar` runtime CLI.
 *
 * Architecture:
 *   - `bizar` is the core runtime + installer + audit/init/export/update/plan
 *     + service + dash commands.
 *   - The dashboard lives in `@polderlabs/bizar-dash` as a library.
 *     Commands live under `bizar dash <subcommand>` (new canonical form).
 *     `bizar dashboard` is a deprecated alias (still works, prints warning).
 *
 * Subcommands:
 *   install, audit, init, export, plan, update, test-gate, service, dash
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
    bizar <command> [options]

  Commands:
    install             Run the interactive installer
    audit               Run security audit on agent configuration
    init                Initialize .bizar/ in current project
    export [target]     Export agents/rules to another harness
    plan <subcommand>  Manage visual plans
    graph               Per-project knowledge graph (powered by graphify)
    test-gate           Detect & run the project's test suite
    update              Update opencode, bizar, and/or bizar-plugin
    service             Manage the background service daemon
    bg <subcommand>     Manage background agents (list/view/kill/logs)
    dash <subcommand>   Manage the dashboard (start/stop/status/tui)
    dev-link [src]      Symlink the local plugin source into opencode's plugin dir
    dev-unlink          Remove the dev symlink and restore the deployed copy
    doctor              Check the BizarHarness install for health issues

  Examples:
    bizar install
    bizar audit
    bizar dash start
    bizar dash start --bg
    bizar dash stop
    bizar dash status
    bizar doctor
    bizar update --all --dry-run

  Run \`bizar <command> --help\` for per-command help.

  Install:
    npm install -g @polderlabs/bizar          Install globally
    npm install -g @polderlabs/bizar-dash     Optional dashboard package
    npm install -g @polderlabs/bizar-plugin   Bizar opencode plugin
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
  bizar update — Update opencode, bizar, and/or bizar-plugin

  Usage:
    bizar update                       Interactive prompt for components
    bizar update --all                 Update every component
    bizar update opencode bizar dash    Update specific components
    bizar update --all --yes           Update everything + auto-kill running instances
    bizar update --no-restart          Don't auto-restart the dashboard after update
    bizar update --dry-run             Print what would happen, change nothing
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
    • If the dashboard was running and bizar or dash was updated,
      spawns a fresh detached dashboard process with the new code
      (skipped with --no-restart).
    • Runs \`bizar doctor\` after a successful update to catch config
      regressions before opencode tries to start.
    • If ~/.config/opencode/plugins/bizar is a dev symlink (created
      by \`bizar dev-link\`), the copy step is skipped to preserve the
      link. Use \`bizar dev-unlink\` first, or pass --force.

  Examples:
    bizar update --all --yes           Headless full update + restart
    bizar update dash                  Update only the dashboard
    bizar update plugin --no-restart   Plugin-only, leave dashboard alone
    bizar update --all --dry-run       See what would change without doing it
  `);
}

function showTestGateHelp() {
  console.log(`
  bizar test-gate — Detect & run the project's test suite
  `);
}

function showDevLinkHelp() {
  console.log(`
  bizar dev-link / dev-unlink — Manage a symlink from the opencode plugin dir
  to a local source checkout, so edits propagate to opencode on next session.

  Usage:
    bizar dev-link [source-dir]    Symlink source-dir (default: ./plugins/bizar)
                                   to ~/.config/opencode/plugins/bizar
    bizar dev-link --force         Replace an existing deployed copy
    bizar dev-unlink               Remove the dev symlink + restore from npm
    bizar dev-unlink --force       Remove even if not a symlink (destructive)

  Description:
    By default, opencode loads the Bizar plugin from
    ~/.config/opencode/plugins/bizar, which is a real directory copied
    from the npm package. Edits to plugins/bizar/ in the BizarHarness
    repo don't propagate until you re-run the installer.

    \`bizar dev-link\` replaces that directory with a symlink pointing
    at your local checkout, so source edits are picked up immediately.
    \`bizar dev-unlink\` reverses the change by removing the symlink
    and re-installing the deployed copy from the npm package.

    While the dev link is in place, \`bizar update\` will skip the
    plugin-copy step (and print a warning) so it doesn't clobber the
    link. Run \`bizar dev-unlink\` first, or pass --force to overwrite.

  Examples:
    bizar dev-link
    bizar dev-link /home/me/projects/bizar/plugins/bizar
    bizar dev-link --force
    bizar dev-unlink
  `);
}

function showDoctorHelp() {
  console.log(`
  bizar doctor — Check the BizarHarness install for health issues

  Usage:
    bizar doctor

  Description:
    Runs a battery of health checks against the local install:
      • opencode CLI reachable
      • ~/.config/opencode/opencode.json parses as JSON
      • the Bizar plugin is registered
      • plugin path resolves
      • @polderlabs/bizar-plugin is installed globally
      • core agent files are installed (odin, quick, thor, tyr)
      • rtk / semble / skills on PATH (lenient — at least one)
      • dashboard reachable (skipped if no port file)
      • provider.minimax block + MiniMax model flags are sane

    Prints ✓/✗ for each check and a final summary. Exits non-zero
    if any check fails. Use \`bizar doctor\` after a manual config
    edit or to diagnose "why is opencode misbehaving?" questions.

  Related:
    bizar update              Update + auto-run doctor on success
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

function showDashHelp() {
  console.log(`
  bizar dash — Manage the Bizar dashboard

  Usage:
    bizar dash <subcommand> [options]

  Subcommands:
    start [--bg] [--port N]   Start the dashboard (default port 4321)
    stop                       Stop the running dashboard
    status                     Show dashboard port and URL
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
  } else if (args[0] === 'dev-link') {
    if (isHelpRequest) showDevLinkHelp();
    else {
      const { createDevLink } = await import('./dev-link.mjs');
      const positional = args.slice(1).filter((a) => !a.startsWith('-'));
      const flags = args.slice(1).filter((a) => a.startsWith('-'));
      const sourceDir = positional[0] ?? null;
      const force = flags.includes('--force') || flags.includes('-f');
      const ok = createDevLink(sourceDir, { force });
      if (!ok) process.exit(1);
    }
  } else if (args[0] === 'dev-unlink') {
    if (isHelpRequest) showDevLinkHelp();
    else {
      const { removeDevLink } = await import('./dev-link.mjs');
      const force = args.includes('--force') || args.includes('-f');
      const ok = await removeDevLink({ force });
      if (!ok) process.exit(1);
    }
  } else if (args[0] === 'doctor') {
    if (isHelpRequest) showDoctorHelp();
    else {
      const { runDoctor } = await import('./doctor.mjs');
      const result = await runDoctor();
      if (result.failed > 0) process.exit(1);
    }
  } else if (args[0] === 'plan') {
    await runPlan(args.slice(1), {});
  } else if (args[0] === 'install') {
    if (isHelpRequest) showInstallHelp();
    else await runInstaller();
  } else if (args[0] === 'service') {
    if (isHelpRequest) showServiceHelp();
    else await runServiceCommand(args[1]);
  } else if (args[0] === 'bg') {
    // v3.11.1 — Background agent manager (list / view / kill / logs).
    const { runBg } = await import('./bg.mjs');
    await runBg(args[1], args.slice(2));
  } else if (args[0] === 'dash' || args[0] === 'dashboard') {
    // `bizar dashboard` is a deprecated alias for `bizar dash`
    if (args[0] === 'dashboard') {
      console.warn(chalk.yellow('  ⚠ `bizar dashboard` is deprecated, use `bizar dash` instead.'));
    }
    const dashArgs = args.slice(1); // everything after 'dash' or 'dashboard'
    if (dashArgs.length === 0 || isHelpRequest) {
      showDashHelp();
    } else {
      await runDash(dashArgs);
    }
  } else if (isHelpRequest) {
    showHelp();
  } else {
    // No args — show help (breaking: previously launched TUI)
    showHelp();
    process.exit(1);
  }
}

// ── Dashboard subcommand ───────────────────────────────────────────────────────

/**
 * Parse dash-specific options from an array of args.
 * Returns { opts, remaining } where opts have --bg / --port stripped.
 */
function parseDashOpts(dashArgs) {
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

/**
 * Try to load the dashboard CLI module.
 * Try 1: import via the package exports map (@polderlabs/bizar-dash/dash-cli)
 * Try 2: file path probing for older installs or dev trees
 */
async function loadDashCli() {
  // Try 1: import via exports map (requires Tyr's package.json changes)
  try {
    const mod = await import('@polderlabs/bizar-dash/dash-cli');
    return mod;
  } catch (_e) {
    // fall through to file probing
  }

  // Try 2: file path probing
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const candidates = [
    // npm global install
    join(homedir(), '.npm-global', 'lib', 'node_modules', '@polderlabs', 'bizar-dash', 'src', 'cli.mjs'),
    // nvm
    join(homedir(), '.nvm', 'versions', 'node'),
    // relative to current process
    join(process.execPath, '..', '..', 'lib', 'node_modules', '@polderlabs', 'bizar-dash', 'src', 'cli.mjs'),
    // local node_modules
    join(process.cwd(), 'node_modules', '@polderlabs', 'bizar-dash', 'src', 'cli.mjs'),
  ];

  const { pathToFileURL } = await import('node:url');
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

/**
 * Dispatch a dashboard subcommand by loading the dashboard module and
 * calling the appropriate exported function.
 */
async function runDash(dashArgs) {
  const { opts, remaining } = parseDashOpts(dashArgs);
  const sub = remaining[0];
  const subOpts = { ...opts, subArgs: remaining.slice(1) };

  const dashModule = await loadDashCli();
  if (!dashModule) {
    console.error(chalk.red('  ✗ Dashboard not installed.'));
    console.error(chalk.dim('  Run: npm install -g @polderlabs/bizar-dash'));
    console.error(chalk.dim('  Or: npx -y @polderlabs/bizar install'));
    process.exit(1);
  }

  switch (sub) {
    case 'start':
      await dashModule.start(subOpts);
      break;
    case 'stop':
      await dashModule.stop(subOpts);
      break;
    case 'status':
      await dashModule.status(subOpts);
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

// ── Main ──────────────────────────────────────────────────────────────────────

await main().catch((err) => {
  console.error(chalk.red(`bizar: ${err && err.message ? err.message : String(err)}`));
  process.exit(1);
});
