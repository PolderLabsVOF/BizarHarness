/**
 * src/server/timeline-sources/hooks.js
 *
 * F-042 — Hook-log reader. Tails every JSONL in
 * `~/.config/bizar/hook-logs/` and normalizes each line into a
 * TimelineEvent via `timelineStore._testFromHookLog`. Returns the
 * events in time order.
 *
 * Used by the dashboard's `/api/timeline` route when callers want a
 * query that crosses the live ring buffer (e.g. when the dashboard
 * just restarted and the ring hasn't been backfilled yet).
 *
 * This module never imports `timeline-store.mjs` at the top level —
 * it would create a circular import (timeline-store itself imports
 * nothing from timeline-sources, but the cycle is brittle). Instead
 * we keep a tiny local normalizer that mirrors the store's schema
 * for the same hook line shapes.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const HOME = homedir();
export const HOOK_LOG_DIR = join(HOME, '.config', 'bizar', 'hook-logs');

function genId() {
  return 'evt_hook_' + randomBytes(4).toString('hex').slice(0, 8);
}

/**
 * Read every JSONL in HOOK_LOG_DIR and return normalized events.
 * Filters by `since`/`until` when provided (inclusive ISO-string compare).
 *
 * @param {{ since?: string, until?: string }} [opts]
 * @returns {Array<object>}
 */
export function tailHookLogs(opts = {}) {
  if (!existsSync(HOOK_LOG_DIR)) return [];
  let files;
  try {
    files = readdirSync(HOOK_LOG_DIR).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    const fp = join(HOOK_LOG_DIR, f);
    let st;
    try { st = statSync(fp); } catch { continue; }
    if (st.size === 0) continue;
    let text;
    try { text = readFileSync(fp, 'utf8'); } catch { continue; }
    for (const raw of text.split('\n')) {
      if (!raw) continue;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { continue; }
      const ev = normalizeHookLine(parsed);
      if (!ev) continue;
      if (opts.since && (ev.ts || '') < opts.since) continue;
      if (opts.until && (ev.ts || '') > opts.until) continue;
      out.push(ev);
    }
  }
  out.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  return out;
}

/**
 * Normalize one hook-log JSONL line into the TimelineEvent shape.
 * Mirrors the schema produced by `timelineStore._testFromHookLog`.
 */
function normalizeHookLine(line) {
  if (!line || typeof line !== 'object') return null;
  const ts = line.ts || new Date().toISOString();
  const sessionId = line.sessionId || null;
  if (line.source === 'startup' || (typeof line.initial === 'string' && line.initial.startsWith('bizar:sessionstart'))) {
    return {
      id: genId(),
      ts,
      type: 'hook',
      subType: 'session-start',
      projectId: null,
      projectPath: null,
      actor: { kind: 'user', name: null, sessionId },
      summary: `Session started (${line.source || 'startup'})`,
      detail: line.initial || null,
      refs: { sessionId },
      metadata: { source: line.source || 'startup' },
      source: 'hook-log',
      sourceId: `hook-start:${sessionId}:${ts}`,
    };
  }
  if (line.reason) {
    return {
      id: genId(),
      ts,
      type: 'hook',
      subType: 'session-end',
      projectId: null,
      projectPath: null,
      actor: { kind: 'user', name: null, sessionId },
      summary: `Session ended (${line.reason})`,
      detail: line.cwd || null,
      refs: { sessionId },
      metadata: { reason: line.reason, cwd: line.cwd || null },
      source: 'hook-log',
      sourceId: `hook-end:${sessionId}:${ts}`,
    };
  }
  if (line.agentName) {
    return {
      id: genId(),
      ts,
      type: 'hook',
      subType: 'agent-tool-detected',
      projectId: null,
      projectPath: null,
      actor: { kind: 'agent', name: line.agentName, sessionId },
      summary: `Agent tool detected: ${line.agentName}`,
      detail: line.promptPreview || null,
      refs: { sessionId, agentName: line.agentName },
      metadata: { promptPreview: line.promptPreview || null },
      source: 'hook-log',
      sourceId: `hook-agenttool:${sessionId || 'nosession'}:${ts}:${line.agentName}`,
    };
  }
  return null;
}
