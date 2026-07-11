#!/usr/bin/env node
// UserPromptSubmit — Bizar harness hook (Claude Code format).
//
// Runs when the user submits a prompt. Lightly tags the prompt for
// routing and emits a short routing hint for the model's next turn.
//
// Claude Code stdin shape:
//   {
//     "session_id": "...",
//     "transcript_path": "...",
//     "cwd": "...",
//     "hook_event_name": "UserPromptSubmit",
//     "user_prompt": "raw prompt text"
//   }
//
// Claude Code stdout shape:
//   { "hookSpecificOutput": {
//       "hookEventName": "UserPromptSubmit",
//       "additionalContext": "routing hint for the model"
//   }}
//
// Behaviour:
//   1. Append-only JSONL log of (timestamp, sessionId, promptLength).
//   2. Branch on leading slash-command: empty / /team / /plow-through /
//      /test / /validate / default-decompose.

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

  const prompt = String(input.user_prompt || '').trim();
  const sessionId = String(input.session_id || '');

  // 1. Always log (no PII redaction needed — the prompt is the user's).
  try {
    const logDir = path.join(os.homedir(), '.config', 'bizar', 'hook-logs');
    fs.mkdirSync(logDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `user-prompt-${today}.jsonl`);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sessionId: sessionId || null,
      promptLength: prompt.length,
    });
    fs.appendFileSync(logFile, line + '\n');
  } catch { /* best-effort */ }

  // 2. Branch on leading slash-command (anchored to start of trimmed text).
  let note;
  if (prompt.length === 0) {
    note = 'Bizar UserPromptSubmit: empty prompt — wait for actual user input.';
  } else if (prompt.startsWith('/team')) {
    note = 'Bizar UserPromptSubmit: /team — Odin will spawn a coordinated agent team. Confirm disjoint file scopes before dispatching.';
  } else if (prompt.startsWith('/plow-through')) {
    note = 'Bizar UserPromptSubmit: /plow-through — autonomous mode. Dispatch 2+ parallel agents when possible. Run /test before claiming done.';
  } else if (prompt.startsWith('/test')) {
    note = 'Bizar UserPromptSubmit: /test — auto-detects runner (jest/vitest/bun/pytest/cargo/go). Streams output to the user.';
  } else if (prompt.startsWith('/validate')) {
    note = 'Bizar UserPromptSubmit: /validate — runs 21-point health check on the Bizar install.';
  } else {
    note = 'Bizar UserPromptSubmit: if the request is complex, decompose into 2+ parallel subagent tasks (Odin) or spawn a /team.';
  }

  const out = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: note,
    },
  };
  process.stdout.write(JSON.stringify(out) + '\n');
});
