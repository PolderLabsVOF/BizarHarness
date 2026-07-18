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
//   1. Block writes to .env, .envrc, secrets/, credentials/, node_modules/.
//      .env.example/.sample/.template are explicitly allowed (docs, not
//      secrets). Lockfiles are allowed — they're package-manager output.
//   2. Always return a small context line for the next AI decision.
//      (console.log / debugger / .only() are enforced by `make clean-check`
//      at commit time — duplicate-warning here adds noise without safety.)

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

  // Extract the "file_path" mapped onto Claude Code's Write/Edit/MultiEdit
  // shapes. Content scanning was removed (debug artifacts are enforced at
  // commit time via `make clean-check`, not write time).
  let filePath = '';
  if (toolName === 'Write') {
    filePath = String(toolInput.file_path || '');
  } else if (toolName === 'Edit') {
    filePath = String(toolInput.file_path || '');
  } else if (toolName === 'MultiEdit') {
    filePath = String(toolInput.file_path || '');
  } else {
    process.stdout.write('{}\n');
    return;
  }

  const lowerPath = filePath.toLowerCase();

  // 1. Hard block — secrets + protected paths. .env.example/.sample/.template
  //    and all lockfiles are explicitly allowed (docs / package-manager output).
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

  const isAllowed = filePath && allowed.some((re) => re.test(lowerPath));
  let blockReason = '';
  if (filePath && !isAllowed && blocked.some((re) => re.test(lowerPath))) {
    blockReason = filePath;
  }

  if (blockReason) {
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Bizar PreToolUse: refusing to write to protected path '${blockReason}' (Bizar harness policy).`,
      },
    };
    process.stdout.write(JSON.stringify(out) + '\n');
    return;
  }

  // 2. Always add a small context line for the AI's next decision.
  //    Debug-artifact warnings (console.log / debugger / .only()) live in
  //    `make clean-check` — duplicating them here would add noise without
  //    adding safety (they're caught at commit time, not write time).
  const notes = [
    `Bizar PreToolUse: tool=${toolName || 'unknown'} path=${filePath || '(no path)'}`,
  ];

  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: notes.join(' '),
    },
  };
  process.stdout.write(JSON.stringify(out) + '\n');
});
