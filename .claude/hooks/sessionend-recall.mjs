#!/usr/bin/env node
/**
 * sessionend-recall.mjs — Claude Code SessionEnd hook.
 *
 * Records session summaries to the memory vault and writes a
 * `sessions/<date>-<session-id>.md` note via the in-process vault.
 *
 * Claude Code SessionEnd input schema:
 *   { session_id, cwd, hook_event_name: "SessionEnd", reason?: string }
 *
 * Claude Code SessionEnd output schema:
 *   { continue?: boolean, stopReason?: string }
 */

'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch { input = {}; }
  const sessionId = input.session_id || 'unknown';
  const cwd = input.cwd || process.cwd();
  const reason = input.reason || 'unknown';

  // Log session end.
  try {
    const logDir = path.join(os.homedir(), '.config', 'bizar', 'hook-logs');
    fs.mkdirSync(logDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `session-end-${today}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify({
      ts: new Date().toISOString(),
      sessionId,
      reason,
      cwd,
    }) + '\n');
  } catch { /* best-effort */ }

  // Write a session note to the memory vault.
  const vaultRoot = process.env.BIZAR_MEMORY_VAULT || path.join(os.homedir(), '.bizar_memory');
  const projectName = path.basename(cwd) || 'unknown';
  const date = new Date().toISOString().slice(0, 10);
  const notePath = path.join(vaultRoot, 'projects', projectName, 'sessions', `${date}-${sessionId.slice(0, 8)}.md`);

  try {
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    const noteBody = [
      '---',
      `title: Session ${sessionId.slice(0, 8)}`,
      `createdAt: ${new Date().toISOString()}`,
      `sessionId: ${sessionId}`,
      `cwd: ${cwd}`,
      `reason: ${reason}`,
      'tags: [session, auto-generated]',
      '---',
      '',
      `# Session ${sessionId.slice(0, 8)} (${date})`,
      '',
      `Session ended with reason: \`${reason}\`.`,
      '',
      `Working directory: \`${cwd}\``,
      '',
    ].join('\n');
    fs.writeFileSync(notePath, noteBody, 'utf8');
  } catch { /* best-effort */ }

  process.stdout.write(JSON.stringify({}) + '\n');
});