#!/usr/bin/env node
// PostToolUse — Bizar harness hook (Claude Code format).
//
// Runs AFTER a tool call against `Edit`, `Write`, or `MultiEdit`
// completes. Logs the edit/write to `~/.config/bizar/hook-logs/` so
// downstream observability tooling can aggregate latency + size.
//
// Claude Code stdin shape:
//   {
//     "session_id": "...",
//     "transcript_path": "...",
//     "cwd": "...",
//     "hook_event_name": "PostToolUse",
//     "tool_name": "Edit",
//     "tool_input": { "file_path": "..." },
//     "tool_response": { ... }
//   }
//
// Claude Code stdout shape:
//   { "hookSpecificOutput": {
//       "hookEventName": "PostToolUse",
//       "additionalContext": "note for the next turn"
//   }}
//
// Behaviour:
//   1. Append-only JSONL log under ~/.config/bizar/hook-logs/.
//   2. Remind to run /test after edits to src/ files.

'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { input = {}; }

  const toolName = String(input.tool_name || '');
  const toolInput =
    (input.tool_input && typeof input.tool_input === 'object') ? input.tool_input : {};
  const filePath = String(toolInput.file_path || '');
  const sessionId = String(input.session_id || '');

  // 1. Append-only JSONL log under ~/.config/bizar/hook-logs/.
  try {
    const logDir = path.join(os.homedir(), '.config', 'bizar', 'hook-logs');
    fs.mkdirSync(logDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `post-tool-use-${today}.jsonl`);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      tool: toolName,
      success: true, // PostToolUse only fires on success in Claude Code
      executionTimeMs: 0, // not exposed in Claude Code hook input
      sessionId: sessionId || null,
    });
    fs.appendFileSync(logFile, line + '\n');
  } catch { /* best-effort */ }

  const notes = [];

  // 2. Skip the slow-tool warning — Claude Code doesn't surface tool
  //    latency in hook input, so no signal to warn on.
  //
  // 3. Surface a reminder for Write/Edit/MultiEdit on src/ paths.
  if (
    /^(write|edit|multiedit)$/i.test(toolName) &&
    /\/(src|plugins|packages)\//.test(filePath.toLowerCase())
  ) {
    notes.push(
      "Bizar PostToolUse: if you're done editing, run `/test` to gate the change with tests before claiming complete.",
    );
  }

  if (notes.length === 0) {
    process.stdout.write('{}\n');
    return;
  }

  const out = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: notes.join(' '),
    },
  };
  process.stdout.write(JSON.stringify(out) + '\n');
});
