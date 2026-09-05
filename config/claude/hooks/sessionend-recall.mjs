#!/usr/bin/env node
/**
 * sessionend-recall.mjs — Claude Code SessionEnd hook.
 *
 * Captures what actually happened in the session so the next session
 * (and the user, in `.bizar/sessions/`) can pick up where we left off.
 *
 * Reads `transcript_path` (JSONL), extracts:
 *   - a one-way request fingerprint (never raw prompt text)
 *   - files written/edited (from tool_use blocks)
 *   - bash commands run
 *   - error patterns (ENOENT / EACCES / permission / TypeError / unhandledrejection)
 *   - tool-call counts
 *   - wall-clock span
 *
 * Writes:
 *   1. .bizar/sessions/<date>-<id>.md  — markdown note with structured frontmatter
 *   2. .bizar/session-state.json       — ≤ 1KB handoff for the next SessionStart
 *
 * Claude Code SessionEnd input:
 *   { session_id, transcript_path, cwd, hook_event_name, reason }
 *
 * Claude Code SessionEnd output:
 *   {}  (silence is fine — the artifact is the file system)
 *
 * Always exits 0.
 */

'use strict';

import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { listOpenKanTasks } from '../../../cli/openkan-store.mjs';
import os from 'node:os';
import { createHash } from 'node:crypto';

const SESSIONS_DIR = '.bizar/sessions';
const SESSION_STATE = '.bizar/session-state.json';
const MAX_TRANSCRIPT_LINES = 200; // ~50KB cap
const MAX_FILES_TRACKED = 20;
const MAX_BLOCKERS = 5;
const ERROR_PATTERNS = [
  /Error: ENOENT/i,
  /Error: EACCES/i,
  /Error: EPERM/i,
  /permission denied/i,
  /command not found/i,
  /TypeError:/i,
  /ReferenceError:/i,
  /SyntaxError:/i,
  /unhandledrejection/i,
  /Cannot find module/i,
  /MODULE_NOT_FOUND/i,
  /fatal: /i,
];

// ── Transcript parsing ─────────────────────────────────────────────────────

function readTranscript(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  let text = '';
  try {
    text = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }
  const all = text.split('\n').filter(Boolean);
  const tail = all.slice(-MAX_TRANSCRIPT_LINES);

  const events = [];
  for (const line of tail) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object') events.push(obj);
    } catch {
      /* skip malformed lines */
    }
  }
  return events;
}

function scanForErrors(text) {
  if (!text || typeof text !== 'string') return [];
  const hits = [];
  for (const pat of ERROR_PATTERNS) {
    const m = text.match(pat);
    if (m) hits.push(m[0]);
    if (hits.length >= MAX_BLOCKERS) break;
  }
  return hits;
}

function extract(events) {
  const filesTouched = new Set();
  const bashCommands = [];
  const errors = [];
  const toolsUsed = {};
  const userPrompts = [];
  let firstTs = null;
  let lastTs = null;

  function bumpTool(name) {
    if (!name) return;
    toolsUsed[name] = (toolsUsed[name] || 0) + 1;
  }

  function recordError(text) {
    if (!text) return;
    for (const e of scanForErrors(text)) {
      if (!errors.includes(e)) errors.push(e);
      if (errors.length >= MAX_BLOCKERS) break;
    }
  }

  for (const ev of events) {
    const ts = ev.timestamp || ev.ts;
    if (typeof ts === 'string' || typeof ts === 'number') {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }

    const msg = ev.message || ev;
    const role = msg && msg.role;
    const content = msg && msg.content;

    if (role === 'user' && typeof content === 'string') {
      userPrompts.push(content);
    }

    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const type = block.type;
        if (type === 'tool_use' || type === 'toolCall') {
          const name = block.name || block.tool_name || 'unknown';
          bumpTool(name);
          const input = block.input || block.tool_input || {};
          if (input && typeof input === 'object') {
            const fp = input.file_path || input.path;
            if (fp && typeof fp === 'string') filesTouched.add(fp);
            const cmd = input.command;
            if (cmd && typeof cmd === 'string') {
              bashCommands.push(cmd);
            }
          }
        }
        if (type === 'tool_result' || type === 'toolResult') {
          const out = block.content || block.output;
          if (typeof out === 'string') recordError(out);
          else if (Array.isArray(out)) {
            for (const sub of out) {
              if (typeof sub === 'string') recordError(sub);
              else if (sub && typeof sub === 'object' && typeof sub.text === 'string') {
                recordError(sub.text);
              }
            }
          }
        }
        if (type === 'text' && typeof block.text === 'string') {
          recordError(block.text);
        }
      }
    }
  }

  const requestFingerprint = userPrompts.length > 0
    ? createHash('sha256').update(userPrompts.join('\n')).digest('hex').slice(0, 16)
    : null;

  return {
    requestFingerprint,
    filesTouched: [...filesTouched].slice(0, MAX_FILES_TRACKED),
    bashCommands: bashCommands.slice(-10),
    errors: errors.slice(0, MAX_BLOCKERS),
    toolsUsed,
    firstTs,
    lastTs,
  };
}

function detectActiveTask(cwd) {
  try {
    const active = listOpenKanTasks(cwd).filter((task) => ['in_progress', 'review'].includes(task.status));
    if (active.length === 1) return active[0].id;
    if (active.length > 1) return active.map((task) => task.id).join(',');
  } catch {
    // Session handoff is best-effort; a malformed .ok entry must not abort it.
  }
  return null;
}

function inferNextStep(summary, activeTask) {
  if (summary.errors.length > 0) return `Resolve ${summary.errors[0]} from the prior session.`;
  if (!activeTask) return 'Pick and claim the next ready OpenKan task with `bizar task list`.';
  return `Continue with OpenKan task ${activeTask}.`;
}

// ── File writers ───────────────────────────────────────────────────────────

function writeSessionNote(cwd, sessionId, reason, summary) {
  const today = new Date().toISOString().slice(0, 10);
  const projectName = cwd.split('/').pop() || 'unknown';
  const dir = join(cwd, SESSIONS_DIR);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    return null;
  }
  const fileName = `${today}-${sessionId.slice(0, 8)}.md`;
  const notePath = join(dir, fileName);

  const activeTask = detectActiveTask(cwd);
  const frontmatter = [
    '---',
    `title: Session ${today} ${sessionId.slice(0, 8)}`,
    `createdAt: ${new Date().toISOString()}`,
    `sessionId: ${sessionId}`,
    `reason: ${reason}`,
    `cwd: ${cwd}`,
    activeTask ? `activeTask: ${activeTask}` : 'activeTask: null',
    `requestFingerprint: ${summary.requestFingerprint || 'null'}`,
    `toolsUsed: ${JSON.stringify(summary.toolsUsed)}`,
    summary.filesTouched.length > 0
      ? `filesTouched: [${summary.filesTouched.map((f) => `"${f.replace(/"/g, '\\"')}"`).join(', ')}]`
      : 'filesTouched: []',
    summary.errors.length > 0
      ? `blockers: [${summary.errors.map((e) => `"${e.replace(/"/g, '\\"')}"`).join(', ')}]`
      : 'blockers: []',
    `tags: [session, auto-generated]`,
    '---',
  ].join('\n');

  const body = [
    '',
    `# Session ${today} (${sessionId.slice(0, 8)})`,
    '',
    `Session ended with reason: \`${reason}\`.`,
    '',
    `Working directory: \`${cwd}\``,
    '',
    '## Files touched',
    '',
    summary.filesTouched.length > 0
      ? summary.filesTouched.map((f) => `- \`${f}\``).join('\n')
      : '_No file writes captured._',
    '',
    '## Tools used',
    '',
    Object.entries(summary.toolsUsed)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `- \`${t}\` × ${n}`)
      .join('\n') || '_none_',
    '',
    '## Errors / blockers',
    '',
    summary.errors.length > 0
      ? summary.errors.map((e) => `- \`${e}\``).join('\n')
      : '_None captured._',
    '',
  ].join('\n');

  try {
    writeFileSync(notePath, frontmatter + body + '\n', { encoding: 'utf8', mode: 0o600 });
    return notePath;
  } catch {
    return null;
  }
}

function writeSessionState(cwd, sessionId, reason, summary, nextStep) {
  const path = join(cwd, SESSION_STATE);
  try {
    mkdirSync(join(cwd, '.bizar'), { recursive: true, mode: 0o700 });
  } catch {
    /* best-effort */
  }
  const state = {
    lastSessionId: sessionId,
    lastSessionEnd: new Date().toISOString(),
    reason,
    activeTask: detectActiveTask(cwd),
    nextStep,
    requestFingerprint: summary.requestFingerprint,
    filesTouched: summary.filesTouched,
    blockers: summary.errors,
    toolsUsed: summary.toolsUsed,
  };
  try {
    writeFileSync(path, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function logLifecycle(sessionId, reason, cwd) {
  try {
    const configured = String(process.env.BIZAR_HOME || '').trim();
    const base = configured
      ? (configured.startsWith('/') ? configured : join(cwd || process.cwd(), configured))
      : join(process.env.XDG_CONFIG_HOME || join(os.homedir(), '.config'), 'bizar');
    const dir = join(base, 'hook-logs');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const today = new Date().toISOString().slice(0, 10);
    const logFile = join(dir, `session-end-${today}.jsonl`);
    appendFileSync(
      logFile,
      JSON.stringify({
        ts: new Date().toISOString(),
        sessionId,
        reason,
        cwd,
      }) + '\n',
      { mode: 0o600 },
    );
  } catch {
    /* best-effort */
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

let errors = [];

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    input = {};
  }

  const sessionId = String(input.session_id || 'unknown');
  const reason = String(input.reason || 'unknown');
  const cwd = String(input.cwd || process.cwd());
  const transcript = input.transcript_path;

  logLifecycle(sessionId, reason, cwd);

  const events = readTranscript(transcript);
  const summary = extract(events);
  errors = summary.errors;

  const nextStep = inferNextStep(summary, detectActiveTask(cwd));
  const notePath = writeSessionNote(cwd, sessionId, reason, summary);
  const stateOk = writeSessionState(cwd, sessionId, reason, summary, nextStep);

  // Silent success — the artifact is the file system.
  process.stdout.write(
    JSON.stringify({
      continue: true,
      noteWritten: notePath || null,
      stateWritten: stateOk,
      toolsUsed: summary.toolsUsed,
      filesTouched: summary.filesTouched.length,
      blockers: summary.errors.length,
    }) + '\n',
  );
});
