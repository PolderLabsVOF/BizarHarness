#!/usr/bin/env node
// PreToolUse — Bizar harness hook (Claude Code format).
//
// Runs BEFORE any tool call against `Write`, `Edit`, or `MultiEdit`.
// (Bash is handled by `pretooluse-bash.mjs`, registered separately.)
//
// Claude Code stdin shape:
//   {
//     "session_id": "...",
//     "transcript_path": "...",
//     "cwd": "...",
//     "hook_event_name": "PreToolUse",
//     "tool_name": "Write",
//     "tool_input": { "file_path": "...", "content": "..." }
//   }
//
// Claude Code stdout shape (F-176):
//   { "hookSpecificOutput": {
//       "hookEventName": "PreToolUse",
//       "permissionDecision": "allow",
//       "permissionDecisionReason": "...",
//       "additionalContext": "[advisory] ..."
//   }}
//
// F-176 (full permissions + advisory hooks):
//   Hooks never return `deny` or `ask`. They inject guidance via
//   `additionalContext` and always return `"allow"`. The hook exists to
//   remind the agent when it is touching project-managed dependency
//   output (`node_modules/`) — writes there are usually package-manager
//   work, not source edits.
//
// F-200 history:
//   - Agents are free to read, edit, and stage any path that is not
//     under project-managed `node_modules/`.
//   - Hard secret guard against secrets reaching git lives in
//     `git-workflow-guard.mjs`.
//   - Doc-style allow-list (.env.example / .sample / .template /
//     lockfiles) bypasses the package-manager block.

'use strict';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { input = {}; }

  const toolName = String(input.tool_name || '');
  const toolInput =
    (input.tool_input && typeof input.tool_input === 'object') ? input.tool_input : {};

  let filePath = '';
  if (/^(Write|Edit|MultiEdit)$/.test(toolName)) {
    filePath = String(toolInput.file_path || '');
  } else {
    process.stdout.write('{}\n');
    return;
  }

  if (!filePath) {
    process.stdout.write('{}\n');
    return;
  }

  const lowerPath = filePath.toLowerCase();

  // Allow-list patterns: docs (.env.example / .sample / .template) and
  // package-manager output (lockfiles). These never trigger the advisory.
  const allowed = [
    /\/\.env\.(example|sample|template|dist)$/i,
    /\/(package-lock|yarn|pnpm-lock|bun)\.lock\w*$/i,
    /\.(lock|lockb)$/i,
  ];

  // Advisory list: project-managed dependency directories. Under F-176
  // these are still allowed but the agent sees a reminder that this is
  // package-manager output, not source.
  const advisory = [
    /\/node_modules\//,
  ];

  const isAllowed = allowed.some((re) => re.test(lowerPath));
  if (!isAllowed && advisory.some((re) => re.test(lowerPath))) {
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason:
          `Bizar PreToolUse advisory: '${filePath}' is inside a package-manager directory.`,
        additionalContext:
          `[advisory] Heads up: '${filePath}' is inside a package-manager output directory ` +
          `(e.g. node_modules/). Edits here are normally regenerable via the package manager; ` +
          `consider whether the change belongs in source instead.`,
      },
    };
    process.stdout.write(JSON.stringify(out) + '\n');
    return;
  }

  process.stdout.write('{}\n');
});
