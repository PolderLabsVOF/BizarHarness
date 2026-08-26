#!/usr/bin/env node
/**
 * Guard irreversible or externally visible Git/GitHub operations.
 *
 * F-200 tightening:
 *   This hook is the SINGLE hard guard against secrets reaching git
 *   history. Workspace restrictions are loosened elsewhere
 *   (`pretooluse-bash.mjs`, `pretooluse-editwrite.mjs`,
 *   `path-ownership-guard.mjs`); secrets never reach git through them
 *   because this hook denies:
 *     - `git add` of `.env*`, `secrets/**`, `*.pem`, `*.key` files
 *     - `git commit` whose staged diff contains secret markers
 *       (`API_KEY=`, `SECRET=`, `-----BEGIN * PRIVATE KEY-----`, etc.)
 *     - `git push` whose outbound diff contains secret markers
 *   Normal `git add .`, `git commit -m "feat: ..."`, and `git push` of
 *   project files are not blocked by this guard.
 *
 * Behaviour summary:
 *   - Safe local inspection (status, log, diff) is autonomous.
 *   - History rewriting (rebase, force-push) is denied.
 *   - `git add` of secret files is denied outright.
 *   - `git commit` and `git push` scan their respective diffs for
 *     secret markers and deny when found.
 *   - `git commit`, `git push`, PR mutations, releases, publishes, and
 *     deploys require a human confirmation in Claude Code.
 */

import { spawnSync } from 'node:child_process';
import { findGitCommand } from './git-command-parser.mjs';

const ALLOWED_COMMIT_TYPES = ['feat', 'fix', 'refactor', 'docs', 'style', 'test', 'build', 'chore'];
const GH_GLOBAL_OPTION = String.raw`(?:(?:-R|--repo|--hostname)\s+(?:"[^"]*"|'[^']*'|\S+)|--(?:help|version))`;

// Secret file globs that must NEVER be staged or pushed (F-200).
// Match either the bare filename or any path ending in it.
const SECRET_FILE_PATTERNS = [
  /(^|\/)\.env(\.[a-z0-9_-]+)?$/i,                    // .env, .env.local, .env.production (anywhere)
  /(^|\/)\.envrc$/i,                                    // .envrc (anywhere)
  /(^|\/)secrets\//i,                                    // secrets/foo.json
  /(^|\/)credentials\//i,                                // credentials/foo.json
  /(^|\/)[^/]*\.pem$/i,                                  // *.pem (anywhere)
  /(^|\/)[^/]*\.key$/i,                                  // *.key (catches ssh keys, RSA keys, etc.)
];

function isSecretPath(path) {
  const trimmed = String(path || '').replace(/^\.\//, '').replace(/^["']|["']$/g, '').trim();
  if (!trimmed) return false;
  // Allow explicit doc-style env templates even if they match the prefix.
  if (/\.env\.(example|sample|template|dist)$/i.test(trimmed)) return false;
  for (const pat of SECRET_FILE_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }
  return false;
}

function extractAddPaths(args) {
  // git add [options] [--] [pathspec…]. We only inspect paths after
  // stripping common flags. `-A` / `.` / `:!` intent-to-add not
  // supported here — for those, the staged-diff scan catches secret
  // content at commit time.
  const paths = [];
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    if (arg === '--') continue;
    if (arg === '.' || arg === '-A' || arg === '--all') {
      paths.push('.');
      continue;
    }
    paths.push(arg);
  }
  return paths;
}

// Marker patterns scanned from staged / outbound diffs. Designed to be
// conservative — false positives are preferable to letting any secret
// reach a push.
const SECRET_CONTENT_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /-----BEGIN [A-Z0-9 ]*SECRET-----/,
  /(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|access[_-]?key|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\-\/+=]{16,}/i,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/, // AWS access key IDs
  /ghp_[A-Za-z0-9]{36}/,         // GitHub personal access tokens
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /sk-[A-Za-z0-9]{20,}/,         // OpenAI / generic sk- keys
];

function diffContainsSecret(text) {
  if (!text) return false;
  for (const pat of SECRET_CONTENT_PATTERNS) {
    if (pat.test(text)) return true;
  }
  return false;
}

// Test-fixture bypass: a staged diff that ONLY changes files inside a
// __tests__/ directory (or a *_test.mjs / *.test.mjs / *.test.ts file) is
// allowed to contain synthetic secret markers. The hook's own tests rely on
// `ghp_…`, `AKIA…`, and `-----BEGIN … PRIVATE KEY-----` fixtures to verify
// that the guard denies real secrets. Production code paths never stage
// test fixtures.
function isOnlyTestFixtures(stagedText) {
  if (!stagedText) return false;
  const files = new Set();
  for (const line of stagedText.split('\n')) {
    const m = line.match(/^diff --git a\/(.+?)\s+b\//);
    if (m) files.add(m[1]);
  }
  if (files.size === 0) return false;
  for (const f of files) {
    if (/(?:^|\/)__tests__\//.test(f)) continue;
    if (/\.(test|spec)\.[mc]?[jt]sx?$/i.test(f)) continue;
    return false;
  }
  return true;
}

function getStagedDiff(cwd) {
  return spawnSync('git', ['diff', '--cached', '--unified=0'], {
    cwd,
    encoding: 'utf8',
    timeout: 5_000,
  });
}

function getOutboundDiff(cwd) {
  // Outbound = commits not yet on origin/HEAD. Candidates:
  //   1. @{u}..HEAD — upstream tracking branch (most precise)
  //   2. origin/HEAD..HEAD — fallback if @{u} is not set
  const candidates = [
    ['diff', '--unified=0', '@{u}', 'HEAD'],
    ['diff', '--unified=0', 'origin/HEAD', 'HEAD'],
  ];
  for (const args of candidates) {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 5_000,
    });
    if (result.status === 0) {
      return result;
    }
  }
  return { status: 1, stdout: '', stderr: '' };
}

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
  const add = findGitCommand(command, 'add');
  const hasGuardedActionToken = /\b(?:commit|push|rebase|add)\b/i.test(command);
  const hasExecutableIndirection = /(?:\$\(|`|\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)|\beval\b|\b(?:ba|z|k|c|fi)?sh\s+-c\b)/i.test(command);
  if (!push && !rebase && !commit && !add && hasGuardedActionToken && hasExecutableIndirection) {
    output('deny', 'Dynamic shell indirection around commit, push, rebase, or add cannot be safely classified. Use a literal Git command so Bizar can apply the required approval policy.');
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

  // F-200: deny `git add <secret>` (literal pathspecs only — shell
  // globbing happens in the agent's shell so dotfiles and `*.key` come
  // through expanded). If the path contains shell-glob chars we cannot
  // prove a secret is staged, so we let the staged-diff scan at commit
  // time catch it.
  if (add) {
    const args = add.args || [];
    const lookForSecrets = !args.some((arg) => arg === '.' || arg === '-A' || arg === '--all');
    if (lookForSecrets) {
      for (const path of extractAddPaths(args)) {
        if (/[*?[\]]/.test(path)) continue;
        if (isSecretPath(path)) {
          output('deny', `Refusing to stage secret file '${path}'. Keep .env / secrets / *.pem / *.key local — commit only the project code that consumes them.`);
          return;
        }
      }
    }
  }

  if (commit) {
    // F-200: scan staged diff for secret markers before asking.
    const staged = getStagedDiff(cwd);
    if (
      staged.status === 0 &&
      diffContainsSecret(staged.stdout) &&
      !isOnlyTestFixtures(staged.stdout)
    ) {
      output('deny', 'Staged changes contain what looks like a secret (API key, private key, AWS/GitHub/Slack/OpenAI token, etc.). Unstage it, move it to a gitignored local file, then recommit.');
      return;
    }
    const message = commitMessage(command);
    const subject = message.split('\n').find((line) => line.trim())?.trim() ?? '';
    // F-145: subject-shape check is a soft warning attached to the same
    // hook response as the `ask` decision.
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
    // F-200: scan outbound diff for secret markers before asking.
    const outbound = getOutboundDiff(cwd);
    if (outbound.status === 0 && diffContainsSecret(outbound.stdout)) {
      output('deny', 'Outgoing commits contain what looks like a secret. Rewrite history to drop it (interactive rebase, then force-push) before pushing again.');
      return;
    }
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
