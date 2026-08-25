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
// Behaviour:
//   Block writes to .env, .envrc, secrets/, credentials/, node_modules/.
//   .env.example/.sample/.template are explicitly allowed (docs, not
//   secrets). Lockfiles are allowed — they're package-manager output.
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

  const allowed = [
    /\/\.env\.(example|sample|template|dist)$/i,
    /\/(package-lock|yarn|pnpm-lock|bun)\.lock\w*$/i,
    /\.(lock|lockb)$/i,
  ];

  const blocked = [
    /\/\.envrc$/,
    /\/\.env(\.[a-z0-9_-]+)?$/i,
    /\/secrets?\//,
    /\/credentials?\//,
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
