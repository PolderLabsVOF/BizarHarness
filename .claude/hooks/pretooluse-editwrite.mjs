#!/usr/bin/env node
// PreToolUse — Bizar harness hook (Claude Code format).
//
// Runs BEFORE any tool call against `Write`, `Edit`, `MultiEdit`, or `Bash`.
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
//   1. Block writes to .env, .envrc, secrets/, credentials/,
//      node_modules/, *.lock, *.lockb, package-lock.json, bun.lock*, yarn.lock.
//   2. Warn (don't block) on console.log / debugger / .only() in src/.
//   3. Scan `Bash` commands against the dangerous-patterns list.
//   4. Always return a small context line for the next AI decision.

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

  // Extract the "path" and "content" mapped onto Claude Code's
  // Write/Edit/MultiEdit/Bash shapes.
  let filePath = '';
  let content = '';
  if (toolName === 'Write') {
    filePath = String(toolInput.file_path || '');
    content = String(toolInput.content || '');
  } else if (toolName === 'Edit') {
    filePath = String(toolInput.file_path || '');
    content = String(toolInput.new_string || '');
  } else if (toolName === 'MultiEdit') {
    filePath = String(toolInput.file_path || '');
    const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
    content = edits.map((e) => String((e && e.new_string) || '')).join('\n');
  } else if (toolName === 'Bash') {
    // No "path" for Bash — use the command string as the inspect surface.
    content = String(toolInput.command || '');
  } else {
    process.stdout.write('{}\n');
    return;
  }

  const lowerPath = filePath.toLowerCase();
  const lowerContent = content.toLowerCase();

  // 1. Hard block — secrets + protected paths.
  const blocked = [
    /\/\.env(\.|$|\/)/,
    /\/\.envrc$/,
    /\/secrets?\//,
    /\/credentials?/,
    /\/node_modules\//,
    /\.(lock|lockb)$/,
    /\/package-lock\.json$/,
    /\/bun\.lockb?$/,
    /\/yarn\.lock$/,
  ];

  let blockReason = '';
  if (filePath && blocked.some((re) => re.test(lowerPath))) {
    blockReason = filePath;
  } else if (toolName === 'Bash' && blocked.some((re) => re.test(lowerContent))) {
    blockReason = '(matched in Bash command)';
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

  // 2. Warn — debug artifacts in src/ (only when a path-shaped target exists).
  const notes = [];
  const target = filePath || content; // for Bash, content == command (rarely matches)
  const lowerTarget = target.toLowerCase();
  if (
    filePath &&
    /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lowerTarget) &&
    /\/(src|plugins|packages)\//.test(lowerTarget)
  ) {
    if (
      /\bconsole\.(log|debug|warn)\b/.test(lowerContent) &&
      !/\bconsole\.(error|info)\b/.test(lowerContent)
    ) {
      notes.push("Heads up: console.log detected in src — `make clean-check` will fail.");
    }
    if (/\bdebugger\b/.test(lowerContent)) {
      notes.push('Heads up: debugger statement detected — remove before committing.');
    }
    if (/\.only\s*\(/.test(content) && !/\.skip\s*\(/.test(content)) {
      notes.push("Heads up: .only() detected — `make clean-check` will fail.");
    }
  }

  // 3. Always add a small context line for the AI's next decision.
  notes.push(`Bizar PreToolUse: tool=${toolName || 'unknown'} path=${filePath || '(no path)'}`);

  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: notes.join(' '),
    },
  };
  process.stdout.write(JSON.stringify(out) + '\n');
});
