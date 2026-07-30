/**
 * Thin, current Claude Code process wrappers.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';

export function resolveClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
}

export function spawnClaude(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, {
      stdio: opts.stdio || 'inherit',
      env: { ...process.env, CLAUDE_CONFIG_DIR: resolveClaudeDir() },
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

export function showClaudeCmdHelp() {
  console.log(`
  Claude Code process wrappers:
    bizar team <name> <mission>       Run the office-manager router
    bizar subagent <agent> <task>     Run a named agent in plan mode
    bizar run [--bg] <prompt>         Run Claude Code once
  `);
}

export async function runClaudeTeam(args = []) {
  const [name, mission, ...rest] = args;
  if (!name || !mission) {
    console.log('  Usage: bizar team <name> <mission>');
    return 2;
  }
  const router = join(resolveClaudeDir(), 'agents', 'office-manager.md');
  if (!existsSync(router)) {
    console.error(chalk.red(`  ✗ Missing ${router}; run bizar install`));
    return 1;
  }
  return spawnClaude(['-p', '--name', name, '--agent', 'office-manager', mission, ...rest]);
}

export async function runClaudeSubagent(args = []) {
  const [agent, task, ...rest] = args;
  if (!agent || !task) {
    console.log('  Usage: bizar subagent <agent> <task>');
    return 2;
  }
  const definition = join(resolveClaudeDir(), 'agents', `${agent}.md`);
  if (!existsSync(definition)) {
    console.error(chalk.red(`  ✗ Unknown installed agent: ${agent}`));
    return 1;
  }
  return spawnClaude(['-p', '--permission-mode', 'plan', '--agent', agent, task, ...rest]);
}

export async function runClaudeRun(args = []) {
  const background = args.includes('--bg');
  const prompt = args.filter((arg) => arg !== '--bg').join(' ');
  if (!prompt) {
    console.log('  Usage: bizar run [--bg] <prompt>');
    return 2;
  }
  return spawnClaude(background ? ['--bg', '-p', prompt] : ['-p', prompt]);
}

export async function run(name, args, isHelpRequest) {
  if (isHelpRequest) {
    showClaudeCmdHelp();
    return true;
  }
  let code;
  if (name === 'team') code = await runClaudeTeam(args);
  else if (name === 'subagent') code = await runClaudeSubagent(args);
  else if (name === 'run') code = await runClaudeRun(args);
  else return false;
  process.exitCode = code;
  return true;
}
