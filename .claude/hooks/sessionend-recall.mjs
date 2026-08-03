#!/usr/bin/env node
/**
 * sessionend-recall.mjs — Claude Code SessionEnd hook.
 *
 * Captures what actually happened in the session so the next session
 * (and the user, in `.bizar/sessions/`) can pick up where we left off.
 *
 * Reads `transcript_path` (JSONL), extracts:
 *   - last user prompt (what was being worked on)
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

import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const SESSIONS_DIR = '.bizar/sessions';
const SESSION_STATE = '.bizar/session-state.json';
const HOOK_LOG_DIR = '.config/bizar/hook-logs';
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

const FILLER_PROMPTS = /^\s*(continue|go on|keep going|yes|ok|okay|sure|do it|proceed|yeah|yep)\s*[.!]?\s*$/i;

function isFiller(s) {
  return typeof s === 'string' && FILLER_PROMPTS.test(s);
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

  // Pick the most substantive user prompt: longest non-filler, else last.
  let best = '';
  for (const p of userPrompts) {
    if (isFiller(p)) continue;
    if (p.length > best.length) best = p;
  }
  if (!best && userPrompts.length > 0) best = userPrompts[userPrompts.length - 1];

  return {
    lastUserPrompt: clip(best, 240),
    filesTouched: [...filesTouched].slice(0, MAX_FILES_TRACKED),
    bashCommands: bashCommands.slice(-10),
    errors: errors.slice(0, MAX_BLOCKERS),
    toolsUsed,
    firstTs,
    lastTs,
  };
}

function clip(s, n) {
  if (!s) return '';
  const oneLine = String(s).replace(/\s+/g, ' ').trim();
  return oneLine.length <= n ? oneLine : oneLine.slice(0, n - 1) + '…';
}

function detectActiveFeature(cwd) {
  const path = join(cwd, 'feature_list.json');
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const active = (data.features || []).filter((f) => f && f.state === 'active');
    if (active.length === 1) return active[0].id;
    if (active.length > 1) return active.map((a) => a.id).join(',');
    return null;
  } catch {
    return null;
  }
}

function inferNextStep(summary, activeFeature) {
  if (summary.errors.length > 0) return `Resolve ${summary.errors[0]} from the prior session.`;
  if (!activeFeature && !summary.lastUserPrompt) {
    return 'Pick next feature from feature_list.json not_started.';
  }
  if (summary.lastUserPrompt) return `Resume: ${clip(summary.lastUserPrompt, 100)}`;
  return `Continue with ${activeFeature}.`;
}

// ── File writers ───────────────────────────────────────────────────────────

function writeSessionNote(cwd, sessionId, reason, summary) {
  const today = new Date().toISOString().slice(0, 10);
  const projectName = cwd.split('/').pop() || 'unknown';
  const dir = join(cwd, SESSIONS_DIR);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  const fileName = `${today}-${sessionId.slice(0, 8)}.md`;
  const notePath = join(dir, fileName);

  const activeFeature = detectActiveFeature(cwd);
  const frontmatter = [
    '---',
    `title: Session ${today} ${sessionId.slice(0, 8)}`,
    `createdAt: ${new Date().toISOString()}`,
    `sessionId: ${sessionId}`,
    `reason: ${reason}`,
    `cwd: ${cwd}`,
    activeFeature ? `activeFeature: ${activeFeature}` : 'activeFeature: null',
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
    '## Last user prompt',
    '',
    summary.lastUserPrompt
      ? `> ${summary.lastUserPrompt.replace(/\n/g, ' ')}`
      : '_No user prompts captured in transcript._',
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
    writeFileSync(notePath, frontmatter + body + '\n', 'utf8');
    return notePath;
  } catch {
    return null;
  }
}

function writeSessionState(cwd, sessionId, reason, summary, nextStep) {
  const path = join(cwd, SESSION_STATE);
  try {
    mkdirSync(join(cwd, '.bizar'), { recursive: true });
  } catch {
    /* best-effort */
  }
  const state = {
    lastSessionId: sessionId,
    lastSessionEnd: new Date().toISOString(),
    reason,
    activeFeature: detectActiveFeature(cwd),
    nextStep,
    filesTouched: summary.filesTouched,
    blockers: summary.errors,
    toolsUsed: summary.toolsUsed,
  };
  try {
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function logLifecycle(sessionId, reason, cwd) {
  try {
    const dir = join(cwd || process.cwd(), HOOK_LOG_DIR);
    mkdirSync(dir, { recursive: true });
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

  const nextStep = inferNextStep(summary, detectActiveFeature(cwd));
  const notePath = writeSessionNote(cwd, sessionId, reason, summary);
  const stateOk = writeSessionState(cwd, sessionId, reason, summary, nextStep);

  // Clear /quick sentinel so the next session is back to orchestrator routing.
  try {
    const quickSentinel = join(cwd, '.bizar', '.quick-once');
    if (existsSync(quickSentinel)) {
      try { unlinkSync(quickSentinel); } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }

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
