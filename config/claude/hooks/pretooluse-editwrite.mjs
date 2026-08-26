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
// Claude Code stdout shape:
//   { "hookSpecificOutput": {
//       "hookEventName": "PreToolUse",
//       "permissionDecision": "deny",
//       "permissionDecisionReason": "..."
//   }}
//   ── or ──
//   { "hookSpecificOutput": {
//       "hookEventName": "PreToolUse",
//       "additionalContext": "note for the model"
//   }}
//
// Behaviour (F-200 loosening):
//   Agents are free to read, edit, and stage any path that is not under
//   project-managed `node_modules/`. The single hard guard against secrets
//   reaching git history lives in `git-workflow-guard.mjs` (deny on
//   `git add` of secret globs, `git commit` and `git push` whose diffs
//   contain secret markers) and the `permissions.deny` block of
//   `config/claude/settings.json`. Hooks here only block edits to
//   package-manager output (`node_modules/`) and confirm doc-style
//   allow-list patterns (.env.example / .sample / .template / lockfiles).
//
//   F-145: removed the always-on `additionalContext` line. Every Write/
//   Edit was emitting a tool/path note into the model's context — pure
//   noise. The model already knows what tool and path it called.

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
  // package-manager output (lockfiles). These are never blocked.
  const allowed = [
    /\/\.env\.(example|sample|template|dist)$/i,
    /\/(package-lock|yarn|pnpm-lock|bun)\.lock\w*$/i,
    /\.(lock|lockb)$/i,
  ];

  // Block-list: only project-managed dependency directories. The user
  // explicitly wants agents to edit `/tmp`, scratch dirs, `secrets/`,
  // `.env`, `.envrc`, and `credentials/` locally — secret protection
  // moved to `git-workflow-guard.mjs` (push-time guard).
  const blocked = [
    /\/node_modules\//,
  ];

  const isAllowed = allowed.some((re) => re.test(lowerPath));
  if (!isAllowed && blocked.some((re) => re.test(lowerPath))) {
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Bizar PreToolUse: refusing to write to protected path '${filePath}' (Bizar harness policy).`,
      },
    };
    process.stdout.write(JSON.stringify(out) + '\n');
    return;
  }

  process.stdout.write('{}\n');
});
