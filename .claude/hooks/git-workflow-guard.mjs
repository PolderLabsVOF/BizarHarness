#!/usr/bin/env node
/**
 * Guard irreversible or externally visible Git/GitHub operations.
 * Safe local inspection remains autonomous; history rewriting is denied;
 * commits, pushes, PR mutations, releases, publishes, and deploys require
 * a human confirmation in Claude Code.
 */

import { spawnSync } from 'node:child_process';

const ALLOWED_COMMIT_TYPES = ['feat', 'fix', 'refactor', 'docs', 'style', 'test', 'build', 'chore'];
const AI_ATTRIBUTION = /Claude-Session:|Co-Authored-By:\s*(?:Claude|Codex|ChatGPT|OpenAI|Gemini|Cursor|Copilot)|Generated with[^\n]*Claude Code|claude\.ai\/code\/session/i;

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

  if (/\bgit\s+(?:-\S+\s+)*push\b[\s\S]*(?:--force(?:-with-lease|-if-includes)?|-f)\b/i.test(command)) {
    output('deny', 'Force-pushing rewrites shared history. Create a follow-up commit or a new branch instead.');
    return;
  }
  if (/\bgit\s+(?:-\S+\s+)*rebase\b/i.test(command)) {
    output('deny', 'Rebasing rewrites history. Use a merge or follow-up commit unless the user explicitly changes project policy.');
    return;
  }
  if (AI_ATTRIBUTION.test(command) && /\b(?:git\s+commit|gh\s+pr)\b/i.test(command)) {
    output('deny', 'Remove AI-attribution trailers or generated-by links from the commit or pull-request text.');
    return;
  }

  if (/\bgit\s+(?:-\S+\s+)*commit\b/i.test(command)) {
    const message = commitMessage(command);
    const subject = message.split('\n').find((line) => line.trim())?.trim() ?? '';
    if (subject && !new RegExp(`^(?:${ALLOWED_COMMIT_TYPES.join('|')}):\\s+\\S`, 'i').test(subject)) {
      output('deny', `Use a conventional commit subject: ${ALLOWED_COMMIT_TYPES.join(', ')} followed by ": description".`);
      return;
    }
    output('ask', `Create this local commit${subject ? `: ${subject}` : ''}?`);
    return;
  }

  if (/\bgh\s+pr\s+(?:create|edit)\b/i.test(command)) {
    const hasBody = /(?:^|\s)(?:-b|--body)(?:=|\s)/.test(command);
    const hasImage = /!\[[^\]]*\]\([^)]*\)|<img\b/i.test(command);
    if (hasBody && !hasImage && hasDesignChanges(cwd)) {
      output('deny', 'This branch changes visual files. Add before/after evidence to the pull-request body before publishing it.');
      return;
    }
    output('ask', 'Publish or modify this pull request on GitHub?');
    return;
  }

  if (/\bgh\s+pr\s+(?:merge|close|reopen)\b/i.test(command)) {
    output('ask', 'Apply this pull-request state change on GitHub?');
    return;
  }
  if (/\bgit\s+(?:-\S+\s+)*push\b/i.test(command)) {
    output('ask', 'Push local commits to the remote repository?');
    return;
  }
  if (/\b(?:gh\s+release\s+(?:create|upload|delete)|npm\s+publish|bun\s+publish|pnpm\s+publish|(?:vercel|wrangler|flyctl)\s+(?:deploy|publish))\b/i.test(command)) {
    output('ask', 'This command publishes or deploys externally. Continue?');
  }
});
