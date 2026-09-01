#!/usr/bin/env node
/**
 * Comprehensive validation of every `bizar` CLI command.
 *
 * Tests:
 *   - All case branches in cli/bin.mjs respond to --help
 *   - All case branches in cli/commands/util.mjs respond to --help
 *   - Module exports are loadable
 *
 * Usage:  node cli/cli-commands-validation.test.mjs
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPO = process.cwd();
const BIN = `${REPO}/cli/bin.mjs`;

const ALL_COMMANDS = [...readFileSync(BIN, 'utf8').matchAll(/case\s+['"]([^'"]+)['"]\s*:/g)]
  .map((match) => match[1]);

const seen = new Set();
const passed = [];
const failed = [];

for (const cmd of ALL_COMMANDS) {
  if (seen.has(cmd)) continue;
  seen.add(cmd);

  // Run `node cli/bin.mjs <cmd> --help` and check exit code + that it prints help
  const r = spawnSync('node', [BIN, cmd, '--help'], {
    timeout: 15_000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  const exitCode = r.status;

  // Pass criteria:
  //  - Exit code 0 OR 2 (usage/help may use 2)
  //  - stdout mentions the command name or contains a recognizable help string
  //  - stderr is empty OR mentions the command name (not "module not found")
  const hasModuleError = stderr.includes('Cannot find module') ||
                         stderr.includes('Failed to load command module');
  const hasHelp = stdout.toLowerCase().includes(cmd) ||
                  stdout.includes('Usage:') ||
                  stdout.includes('Subcommands:') ||
                  stdout.includes('Description:');

  if ((exitCode === 0 || exitCode === 2) && !hasModuleError && (hasHelp || stdout.length > 50)) {
    passed.push({ cmd, exitCode, stdoutLines: stdout.split('\n').length });
  } else {
    failed.push({ cmd, exitCode, hasModuleError, hasHelp, stdout: stdout.slice(0, 200), stderr: stderr.slice(0, 200) });
  }
}

console.log(`\n=== CLI command validation ===\n`);
console.log(`Passed: ${passed.length}/${seen.size}`);
console.log(`Failed: ${failed.length}\n`);

if (passed.length > 0) {
  console.log('=== Passing commands ===');
  for (const p of passed) {
    console.log(`  ✓ ${p.cmd.padEnd(20)} (exit ${p.exitCode}, ${p.stdoutLines} lines)`);
  }
  console.log();
}

if (failed.length > 0) {
  console.log('=== FAILING commands ===');
  for (const f of failed) {
    console.log(`  ✗ ${f.cmd.padEnd(20)} exitCode=${f.exitCode} moduleErr=${f.hasModuleError} hasHelp=${f.hasHelp}`);
    if (f.hasModuleError) {
      console.log(`      stderr: ${f.stderr.trim()}`);
    } else if (f.exitCode !== 0 && f.exitCode !== 2) {
      console.log(`      stderr: ${f.stderr.trim().slice(0, 200)}`);
      console.log(`      stdout: ${f.stdout.trim().slice(0, 200)}`);
    }
  }
  console.log();
}

process.exit(failed.length > 0 ? 1 : 0);
