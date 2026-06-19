#!/usr/bin/env node

import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runInstaller, runPostInstall } from './install.mjs';
import { runAudit } from './audit.mjs';
import { runInit } from './init.mjs';
import { runExport } from './export.mjs';
import runPlan from './plan.mjs';
import { runUpdate } from './update.mjs';

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
  Bizar — Norse Pantheon Agent System for opencode

  Usage:
    bizar                       Launch the TUI dashboard in the current terminal
    bizar --web                 Launch TUI + auto-open web dashboard (default)
    bizar --no-web              Launch TUI only (no browser)
    bizar --web-only            Launch web dashboard only (no TUI, in browser)
    bizar --bg, --detach        Launch web dashboard in background, return to shell
    install                     Run the interactive installer
    bizar install               Same as \`install\`
    bizar audit                 Run security audit on agent configuration
    bizar init                  Initialize .bizar/ in current project
    bizar export [target]       Export agents/rules to another harness
    bizar plan <subcommand>     Manage visual plans
    bizar test-gate             Detect & run the project's test suite
    bizar update                Update opencode, bizar, and/or bizar-plugin
    bizar dashboard [start|stop|status]  Launch or control the web dashboard
    bizar --help                Show this help

  Install:
    npm install -g @polderlabs/bizar          Install globally, then run 'install'
    npm install -g @polderlabs/bizar-plugin   Install the Bizar opencode plugin
    npx @polderlabs/bizar                     Run without installing (npx bizar → TUI)

  Notes:
    - The TUI is now the default command — press 1-8 for tabs, q to quit.
    - Use \`bizar --bg\` to launch the dashboard server detached and return to
      your shell. \`bizar dashboard stop\` will terminate it (reads PID file).
    - The \`dashboard.autoLaunchWeb\` setting controls whether the default
      \`bizar\` invocation opens the browser. Override with --no-web.
  `);
}

function showAuditHelp() {
  console.log(`
  bizar audit — Run security audit on agent configuration

  Usage:
    bizar audit

  Description:
    Scans opencode agent definitions for security issues:
    - Agents with read/edit/bash permission conflicts
    - Agents lacking mode or model definitions
    - Suspicious tool access patterns
  `);
}

function showInitHelp() {
  console.log(`
  bizar init — Initialize .bizar/ in current project

  Usage:
    bizar init

  Description:
    Creates a .bizar/ directory in the current project with:
    - PROJECT.md (living project description)
    - AGENTS_SELF_IMPROVEMENT.md (lesson log)
  `);
}

function showExportHelp() {
  console.log(`
  bizar export — Export agents/rules to another harness

  Usage:
    bizar export --target <harness>

  Targets:
    claude     Export to Claude Code format
    cursor     Export to Cursor format
    opencode   Export to OpenCode format (default)

  Description:
    Converts Bizar agent definitions and rules
    to the target harness's native format.
  `);
}

function showTestGateHelp() {
  console.log(`
  bizar test-gate — Detect & run the project's test suite

  Usage:
    bizar test-gate

  Description:
    Auto-detects the project's test framework (npm test, pytest,
    cargo test, go test) and runs it. Exits with non-zero on failure.
  `);
}

function showDashboardHelp() {
  console.log(`
  bizar dashboard — Launch or control the Bizar web dashboard

  Usage:
    bizar dashboard             Start the dashboard (default action = start)
    bizar dashboard start       Start the dashboard in the current process
    bizar dashboard stop        Kill the running dashboard (reads PID file)
    bizar dashboard status      Print port + URL of any running dashboard

  Description:
    Starts a local Express + WebSocket server on 127.0.0.1, opens the
    user's default browser to the dashboard URL, and broadcasts live
    file-change events from config/, agents/, commands-bizar/, .bizar/,
    and plans/. The server binds loopback only — never expose it.

  Background:
    Use \`bizar --bg\` (or \`bizar --detach\`) to start the dashboard in
    the background and return to your shell immediately. Use
    \`bizar dashboard stop\` to terminate it.
  `);
}

async function runDashboard(action) {
  const sub = action || 'start';
  const { launchDashboard, PORT_FILE, PID_FILE } = await import('./dashboard.mjs');
  const { existsSync, readFileSync, unlinkSync } = await import('node:fs');

  if (sub === 'status') {
    if (existsSync(PORT_FILE)) {
      const port = readFileSync(PORT_FILE, 'utf8').trim();
      console.log(`Bizar dashboard is running at http://localhost:${port}/`);
      if (existsSync(PID_FILE)) {
        console.log(`PID: ${readFileSync(PID_FILE, 'utf8').trim()}`);
      }
    } else {
      console.log('No Bizar dashboard is running. Use: bizar dashboard start');
    }
    return;
  }

  if (sub === 'stop') {
    if (!existsSync(PID_FILE)) {
      console.log('No Bizar dashboard is running.');
      return;
    }
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) {
      console.log(`Bad PID file: ${PID_FILE}`);
      return;
    }
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`Stopped Bizar dashboard (pid ${pid}).`);
    } catch (err) {
      console.log(`Could not stop dashboard (pid ${pid}): ${err.message}`);
    }
    try { unlinkSync(PORT_FILE); } catch { /* ignore */ }
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    return;
  }

  if (sub !== 'start') {
    showDashboardHelp();
    return;
  }

  // Start — keep the process alive so the server stays up
  await launchDashboard();
  console.log(chalk.dim('  Press Ctrl-C to stop the dashboard.'));
  // Wait forever; SIGINT will exit the process.
  await new Promise(() => {});
}

/**
 * Spawn `bizar dashboard start` detached and return. The detached process
 * writes its PID to ~/.config/bizar/dashboard.pid (via launchDashboard) so
 * `bizar dashboard stop` can find it later.
 */
async function runDashboardBackground() {
  const { spawn } = await import('node:child_process');
  const path = await import('node:path');
const { fileURLToPath } = await import('node:url');
  const os = await import('node:os');
  const fs = await import('node:fs');

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const binPath = path.join(__dirname, 'bin.mjs');

  const child = spawn(process.execPath, [binPath, 'dashboard', 'start'], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: process.env,
  });
  child.on('error', (err) => {
    console.error(`Failed to start background dashboard: ${err.message}`);
  });
  child.unref();

  // Give the server a moment to start and write the port file.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const portFile = path.join(os.homedir(), '.config', 'bizar', 'dashboard.port');
  if (fs.existsSync(portFile)) {
    const port = fs.readFileSync(portFile, 'utf8').trim();
    console.log(`Bizar dashboard started in background on http://localhost:${port}/`);
    console.log(`Use 'bizar dashboard status' to check, 'bizar dashboard stop' to stop.`);
  } else {
    console.log('Bizar dashboard starting in background (port file not yet written)...');
    console.log(`Use 'bizar dashboard status' to check, 'bizar dashboard stop' to stop.`);
  }
}

function showUpdateHelp() {
  console.log(`
  bizar update — Update opencode, bizar, and/or bizar-plugin

  Usage:
    bizar update                Interactive: ask which components to update
    bizar update --all          Update everything non-interactively
    bizar update opencode       Update only opencode
    bizar update bizar          Update only the bizar CLI package
    bizar update plugin         Update only the @polderlabs/bizar-plugin package

  Description:
    By default, prompts for each component (opencode, @polderlabs/bizar,
    @polderlabs/bizar-plugin) before running its update. With --all, runs
    every update without prompting. With explicit subcommands, runs only
    the named update.

    "opencode" here means the underlying opencode CLI on $PATH — the
    update uses the opencode installer's own update command.
    "@polderlabs/bizar" and "@polderlabs/bizar-plugin" are updated via
    'npm install -g <pkg>@latest'.
  `);
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

function parseFlag(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

/**
 * Read the current dashboard.autoLaunchWeb setting without forcing the
 * full dashboard state to load. Returns true unless explicitly disabled.
 */
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

/**
 * Run the TUI: start the server on a free port, optionally open the browser,
 * then hand off to the blessed TUI. Blocks until the user quits.
 */
async function runTui({ launchWeb } = {}) {
  const { launchTui } = await import('./dashboard-tui.mjs');
  const { createServer } = await import('./dashboard/server.mjs');
  const { launchBrowser } = await import('./dashboard/browser.mjs');
  const { DEFAULT_PORT } = await import('./dashboard.mjs');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');

  // 1. Pick a free port using the same logic as launchDashboard.
  const port = await findFreePort(DEFAULT_PORT);

  // 2. Start the server (does not auto-open browser; we'll do that here).
  const { server, close: closeServer } = createServer({
    port,
    projectRoot: process.cwd(),
    opencodeConfigDir: join(homedir(), '.config', 'opencode'),
    bizarRoot: new URL('..', import.meta.url).pathname,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  // 3. Write the PID + port files so `bizar dashboard stop` works while the
  //    TUI is also running. Same paths as launchDashboard().
  const path = await import('node:path');
  const fs = await import('node:fs');
  const bizarHome = path.join(homedir(), '.config', 'bizar');
  fs.mkdirSync(bizarHome, { recursive: true });
  fs.writeFileSync(path.join(bizarHome, 'dashboard.port'), String(port), 'utf8');
  fs.writeFileSync(path.join(bizarHome, 'dashboard.pid'), String(process.pid), 'utf8');

  // 4. Optionally open the browser. The TUI itself runs in this terminal,
  //    so we don't need to wait — open in background, then launch TUI.
  if (launchWeb) {
    const url = `http://localhost:${port}/`;
    // Fire and forget — blessed.screen will replace stdio immediately.
    launchBrowser(url).catch(() => {});
    console.log(`Web dashboard: ${url}`);
  }

  try {
    await launchTui({ port });
  } finally {
    try {
      closeServer();
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(path.join(bizarHome, 'dashboard.port'));
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(path.join(bizarHome, 'dashboard.pid'));
    } catch {
      /* ignore */
    }
  }
}

async function findFreePort(preferred) {
  const net = await import('node:net');
  for (let p = preferred; p < preferred + 100; p++) {
    if (await isPortFree(net, p)) return p;
  }
  throw new Error(
    `No free port found in range ${preferred}..${preferred + 99}`,
  );
}

async function isPortFree(net, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    server.once('error', () => finish(false));
    server.once('listening', () => server.close(() => finish(true)));
    const timer = setTimeout(() => finish(false), 1000);
    server.listen(port, '127.0.0.1', () => clearTimeout(timer));
  });
}

// Detect which name we were invoked as (helps when the same script is
// exposed under multiple bin names — e.g. 'bizar' and 'install').
const invokedAs = (() => {
  const exe = process.argv[1] || '';
  if (exe.endsWith('/install') || exe.endsWith('\\install') || exe === 'install') return 'install';
  return 'bizar';
})();

if (args.includes('--postinstall')) {
  await runPostInstall();
} else if (args[0] === 'audit') {
  if (args.includes('--help') || args.includes('-h')) showAuditHelp();
  else await runAudit();
} else if (args[0] === 'init') {
  if (args.includes('--help') || args.includes('-h')) showInitHelp();
  else await runInit(process.cwd());
} else if (args[0] === 'export') {
  if (args.includes('--help') || args.includes('-h')) showExportHelp();
  else {
    const target = parseFlag('--target');
    await runExport(target);
  }
} else if (args[0] === 'test-gate') {
  if (args.includes('--help') || args.includes('-h')) showTestGateHelp();
  else await runTestGate();
} else if (args[0] === 'update') {
  if (args.includes('--help') || args.includes('-h')) {
    showUpdateHelp();
  } else {
    await runUpdate(args.slice(1));
  }
} else if (args[0] === 'plan') {
  const planArgs = args.slice(1);
  await runPlan(planArgs, {});
} else if (args[0] === 'install') {
  // Explicit `bizar install` subcommand — runs the interactive installer
  await runInstaller();
} else if (args[0] === 'dashboard') {
  if (args.includes('--help') || args.includes('-h')) showDashboardHelp();
  else await runDashboard(args[1]);
} else if (args.includes('--bg') || args.includes('--detach')) {
  // Background mode: spawn detached web dashboard, return immediately.
  await runDashboardBackground();
} else if (args.includes('--web-only')) {
  // Web dashboard only — no TUI, foreground.
  await runDashboard('start');
} else if (args.includes('--help') || args.includes('-h')) {
  showHelp();
} else {
  // Default behavior depends on how the script was invoked:
  //   - `bizar` (no args)  → launch the TUI dashboard
  //   - `install` (no args) → run the interactive installer
  //
  // Flags that affect the default:
  //   --no-web    → TUI only, skip browser
  //   --web       → TUI + browser (overrides dashboard.autoLaunchWeb=false)
  if (invokedAs === 'install') {
    await runInstaller();
  } else {
    const skipWeb = args.includes('--no-web');
    const forceWeb = args.includes('--web');
    const settingAuto = await readAutoLaunchWeb();
    const launchWeb = !skipWeb && (forceWeb || settingAuto);
    await runTui({ launchWeb });
  }
}