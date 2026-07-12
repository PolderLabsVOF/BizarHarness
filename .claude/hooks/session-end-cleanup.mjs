#!/usr/bin/env node
// SessionEnd — Bizar harness hook (Claude Code format).
//
// F-040: minimal end-of-session marker. The dashboard's
// claude-session-watcher handles per-agent state cleanup when it sees
// the `result: success` / `result: error_during_execution` JSONL line,
// so this hook only needs to record a session-end breadcrumb for
// forensic / cross-session correlation.
//
// Claude Code stdin shape:
//   {
//     "session_id": "...",
//     "transcript_path": "...",
//     "cwd": "...",
//     "hook_event_name": "SessionEnd",
//     "reason": "exit" | "clear" | "..."
//   }
//
// Behaviour:
//   1. Append a JSONL line to
//      ~/.config/bizar/hook-logs/session-end-YYYY-MM-DD.jsonl.
//   2. Exit 0 — never block the runtime.

'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const HOOK_LOG_DIR = path.join(HOME, '.config', 'bizar', 'hook-logs');

function logSessionEnd(sessionId, reason) {
  try {
    fs.mkdirSync(HOOK_LOG_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(HOOK_LOG_DIR, `session-end-${today}.jsonl`);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sessionId: sessionId || null,
      reason: reason || 'unknown',
      source: 'hook',
    });
    fs.appendFileSync(file, line + '\n');
  } catch {
    /* best-effort */
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { input = {}; }

  const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
  const reason = typeof input.reason === 'string' ? input.reason : 'unknown';

  logSessionEnd(sessionId, reason);

  process.exit(0);
});