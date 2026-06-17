#!/usr/bin/env node

import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runInstaller, runPostInstall } from './install.mjs';
import { runAudit } from './audit.mjs';
import { runInit } from './init.mjs';
import { runExport } from './export.mjs';
import runPlan from './plan.mjs';

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
  BizarHarness — Norse Pantheon Agent System for opencode

  Usage:
    bizarharness                  Run interactive installer
    bizarharness audit           Run security audit on agent configuration
    bizarharness init            Initialize .bizar/ in current project
    bizarharness export [target]  Export agents/rules to another harness (claude|cursor|opencode)
    bizarharness plan <subcommand> Manage visual plans (new, open, list, delete, export)
    bizarharness test-gate       Detect & run the project's test suite
    bizarharness --help          Show this help

  Install:
    npm install -g bizarharness   Install globally, then run 'bizarharness'
    npx bizarharness              Run without installing
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
} else if (args.includes('--help') || args.includes('-h')) {
  showHelp();
} else if (args[0] === 'audit') {
  await runAudit();
} else if (args[0] === 'init') {
  await runInit(process.cwd());
} else if (args[0] === 'export') {
  const target = parseFlag('--target');
  await runExport(target);
} else if (args[0] === 'test-gate') {
  await runTestGate();
} else if (args[0] === 'plan') {
  const planArgs = args.slice(1); // ['new', 'my-feature'] or ['list'], etc.
  await runPlan(planArgs, {});
} else {
  await runInstaller();
}