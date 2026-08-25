#!/usr/bin/env node
/**
 * Guard irreversible or externally visible Git/GitHub operations.
 * Safe local inspection remains autonomous; history rewriting is denied;
 * commits, pushes, PR mutations, releases, publishes, and deploys require
 * a human confirmation in Claude Code.
 */

import { spawnSync } from 'node:child_process';
import { findGitCommand } from './git-command-parser.mjs';

const ALLOWED_COMMIT_TYPES = ['feat', 'fix', 'refactor', 'docs', 'style', 'test', 'build', 'chore'];
const GH_GLOBAL_OPTION = String.raw`(?:(?:-R|--repo|--hostname)\s+(?:"[^"]*"|'[^']*'|\S+)|--(?:help|version))`;

function commandPattern(program, globalOption, subcommand) {
  return new RegExp(`\\b${program}(?:\\s+${globalOption})*\\s+${subcommand}\\b`, 'i');
}

function hasGhCommand(command, noun, actions) {
  return commandPattern('gh', GH_GLOBAL_OPTION, `${noun}\\s+(?:${actions})`).test(command);
}

function output(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }) + '\n');
}

function commitMessage(command) {
  const heredoc = command.match(/<<['"]?([A-Z_][A-Z0-9_]*)['"]?\s*\n([\s\S]*?)\n\1/i);
  if (heredoc) return heredoc[2].trim();
  const match = command.match(/(?:^|\s)(?:-m|--message)(?:=|\s+)(["'])([\s\S]*?)\1/);
  return match?.[2]?.trim() ?? '';
}

function hasDesignChanges(cwd) {
  const candidates = [
    ['diff', '--name-only', 'origin/HEAD...HEAD'],
    ['diff', '--name-only', '--cached'],
  ];
  for (const args of candidates) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5_000 });
    if (result.status !== 0) continue;
    if (result.stdout.split('\n').some((path) => /\.(astro|css|scss|sass|less|html|vue|svelte|tsx|jsx)$/.test(path))) {
      return true;
    }
  }
  return false;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { input = {}; }
  if (input.tool_name !== 'Bash') return;

  const commandValue = input.tool_input?.command;
  const command = Array.isArray(commandValue) ? commandValue.join(' ') : String(commandValue || '');
  const cwd = String(input.cwd || process.cwd());

  const push = findGitCommand(command, 'push');
  const rebase = findGitCommand(command, 'rebase');
  const commit = findGitCommand(command, 'commit');
  const hasGuardedActionToken = /\b(?:commit|push|rebase)\b/i.test(command);
  const hasExecutableIndirection = /(?:\$\(|`|\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)|\beval\b|\b(?:ba|z|k|c|fi)?sh\s+-c\b)/i.test(command);
  if (!push && !rebase && !commit && hasGuardedActionToken && hasExecutableIndirection) {
    output('deny', 'Dynamic shell indirection around commit, push, or rebase cannot be safely classified. Use a literal Git command so Bizar can apply the required approval policy.');
    return;
  }
  if (push && push.args.some((arg) => arg === '-f' || /^--force(?:-with-lease|-if-includes)?(?:=|$)/.test(arg))) {
    output('deny', 'Force-pushing rewrites shared history. Create a follow-up commit or a new branch instead.');
    return;
  }
  if (rebase) {
    output('deny', 'Rebasing rewrites history. Use a merge or follow-up commit unless the user explicitly changes project policy.');
    return;
  }
  if (commit) {
    const message = commitMessage(command);
    const subject = message.split('\n').find((line) => line.trim())?.trim() ?? '';
    // F-145 loosening: subject-shape check is a soft warning attached to
    // the same hook response as the `ask` decision (the dispatcher
    // expects one JSON line per leaf).
    const conventional = subject && !new RegExp(`^(?:${ALLOWED_COMMIT_TYPES.join('|')})(\\([^)]+\\))?:\\s+\\S`, 'i').test(subject);
    const payload = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `Create this local commit${subject ? `: ${subject}` : ''}?`,
      },
    };
    if (conventional) {
      payload.hookSpecificOutput.additionalContext = `Conventional commit hint: prefer "type: subject" (types: ${ALLOWED_COMMIT_TYPES.join(', ')}).`;
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }

  if (hasGhCommand(command, 'pr', 'create|edit')) {
    const hasBody = /(?:^|\s)(?:-b|--body)(?:=|\s)/.test(command);
    const hasImage = /!\[[^\]]*\]\([^)]*\)|<img\b/i.test(command);
    if (hasBody && !hasImage && hasDesignChanges(cwd)) {
      output('deny', 'This branch changes visual files. Add before/after evidence to the pull-request body before publishing it.');
      return;
    }
    output('ask', 'Publish or modify this pull request on GitHub?');
    return;
  }

  if (hasGhCommand(command, 'pr', 'merge|close|reopen|ready|review|comment')) {
    output('ask', 'Apply this pull-request state change on GitHub?');
    return;
  }
  if (push) {
    output('ask', 'Push local commits to the remote repository?');
    return;
  }
  const releaseMutation = hasGhCommand(command, 'release', 'create|edit|delete|upload');
  const packagePublish = /\b(?:npm|bun|pnpm)\b[\s\S]*\bpublish\b/i.test(command);
  const deployment = /\b(?:(?:npx|bunx|pnpm\s+exec)\s+)?(?:vercel|wrangler|flyctl)\b[\s\S]*(?:\bdeploy\b|\bpublish\b|--prod\b)/i.test(command);
  if (releaseMutation || packagePublish || deployment) {
    output('ask', 'This command publishes or deploys externally. Continue?');
  }
});
