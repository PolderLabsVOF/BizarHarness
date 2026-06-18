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
    bizar                       Run interactive installer
    bizar audit                 Run security audit on agent configuration
    bizar init                  Initialize .bizar/ in current project
    bizar export [target]       Export agents/rules to another harness (claude|cursor|opencode)
    bizar plan <subcommand>     Manage visual plans (new, open, list, delete, export, templates)
    bizar test-gate             Detect & run the project's test suite
    bizar update                Update opencode, bizar, and/or bizar-plugin
    bizar --help                Show this help

  Install:
    npm install -g @polderlabs/bizar          Install globally, then run 'bizar'
    npm install -g @polderlabs/bizar-plugin   Install the Bizar opencode plugin
    npx @polderlabs/bizar                     Run without installing
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
} else if (args.includes('--help') || args.includes('-h')) {
  showHelp();
} else {
  await runInstaller();
}
