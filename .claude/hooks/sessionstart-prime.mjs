#!/usr/bin/env node
// SessionStart — Bizar harness hook (Claude Code format).
//
// Claude Code has a single `SessionStart` event that fires for
// "startup", "clear", and "resume" — we branch on `source` to apply
// the appropriate priming for each branch.
//
// Claude Code stdin shape:
//   {
//     "session_id": "...",
//     "transcript_path": "...",
//     "cwd": "...",
//     "hook_event_name": "SessionStart",
//     "source": "startup" | "resume" | "clear"
//   }
//
// Claude Code stdout shape:
//   { "hookSpecificOutput": {
//       "hookEventName": "SessionStart",
//       "additionalContext": "note injected into the model's first turn"
//   }}

'use strict';

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { input = {}; }

  // "startup" | "resume" | "clear" — default to "startup".
  const source = String(input.source || 'startup');
  const sessionId = String(input.session_id || '');
  const isResume = source === 'resume';

  // Log session lifecycle to ~/.config/bizar/hook-logs/.
  try {
    const logDir = path.join(os.homedir(), '.config', 'bizar', 'hook-logs');
    fs.mkdirSync(logDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const logFile = isResume
      ? path.join(logDir, `task-resume-${today}.jsonl`)
      : path.join(logDir, `task-start-${today}.jsonl`);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sessionId: sessionId || null,
      source,
      initial: isResume ? '' : 'bizar:sessionstart:' + source,
    });
    fs.appendFileSync(logFile, line + '\n');
  } catch { /* best-effort */ }

  const notes = isResume
    ? [
        'Bizar SessionStart (resume): re-read `.bizar/PROJECT.md` and `PROGRESS.md` before continuing.',
        'Bizar SessionStart (resume): check `git log --oneline -10` to see what changed since the last run.',
        // Claude Code compacts context automatically between resumes;
        // compaction is opaque to the hook, so we warn unconditionally
        // to remind the agent to verify scope.
        'Bizar SessionStart (resume): WARNING — context may have been compacted since the last run; verify scope before continuing.',
      ]
    : [
        'Bizar SessionStart: read `.bizar/PROJECT.md` (if present) before any routing decision.',
        'Bizar SessionStart: if memory vault exists, run `bizar memory search "<topic>"` first.',
        'Bizar SessionStart: Odin dispatches to subagents via `Agent` (sync) or via the `bizar-mcp` MCP server (async).',
      ];

  // v6.6.0 — F-042 timeline prime. When BIZAR_TIMELINE_PRIME=1, ask
  // the dashboard for a short prose summary of the last 24h of activity
  // and inject it as a SessionStart note. Fire-and-forget: if the
  // dashboard is unreachable we just skip the note. 2s timeout.
  if (process.env.BIZAR_TIMELINE_PRIME === '1') {
    try {
      const base = process.env.BIZAR_DASHBOARD_URL || 'http://127.0.0.1:4321';
      const url = new URL('/api/timeline/agent-context?hours=24', base);
      const text = fetchAgentContext(url);
      if (text) {
        notes.push('Bizar SessionStart (timeline prime): recent activity — ' + text);
      }
    } catch { /* best-effort */ }
  }

  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: notes.join(' '),
    },
  };
  process.stdout.write(JSON.stringify(out) + '\n');
});

function fetchAgentContext(url) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        method: 'GET',
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        timeout: 2000,
        headers: { Accept: 'application/json' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed && typeof parsed.text === 'string' ? parsed.text : null);
          } catch { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(new Error('timeout')); resolve(null); });
    req.end();
  });
}
