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
        'Bizar SessionStart (resume): defaults still apply — files-first (dashboard is optional, never block on it), non-trivial work follows research → plan → audit → impl → test (multi-round) → audit, always WebSearch for current info.',
        'Bizar SessionStart (resume): re-read `.bizar/PROJECT.md` and `PROGRESS.md` before continuing.',
        'Bizar SessionStart (resume): check `git log --oneline -10` to see what changed since the last run.',
        // Claude Code compacts context automatically between resumes;
        // compaction is opaque to the hook, so we warn unconditionally
        // to remind the agent to verify scope.
        'Bizar SessionStart (resume): WARNING — context may have been compacted since the last run; verify scope before continuing.',
      ]
    : [
        'Bizar SessionStart: defaults — files are source of truth (dashboard is optional helper, never block on it); non-trivial work follows research → plan → audit → impl → test (multi-round) → audit; always WebSearch for current info unless the answer is in code/memory.',
        'Bizar SessionStart: read `.bizar/PROJECT.md` (if present) before any routing decision.',
        'Bizar SessionStart: if memory vault exists, run `bizar memory search "<topic>"` first.',
        'Bizar SessionStart: Odin dispatches to subagents via `Agent` (sync) or via the `bizar-mcp` MCP server (async).',
      ];

  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: notes.join(' '),
    },
  };
  process.stdout.write(JSON.stringify(out) + '\n');
});
