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
    bizar                       Launch the web dashboard (in your browser)
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
    npx @polderlabs/bizar                     Run without installing (npx bizar → dashboard)
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
} else if (args.includes('--help') || args.includes('-h')) {
  showHelp();
} else {
  // Default behavior depends on how the script was invoked:
  //   - `bizar` (no args)  → launch the dashboard
  //   - `install` (no args) → run the interactive installer
  if (invokedAs === 'install') {
    await runInstaller();
  } else {
    await runDashboard('start');
  }
}
