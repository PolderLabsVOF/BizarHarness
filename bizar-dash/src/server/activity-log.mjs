/**
 * src/server/activity-log.mjs
 *
 * v3.2.0 — Append-only activity log for the dashboard's Activity tab
 * and canvas-node detail panels.
 *
 * Storage:
 *   ~/.config/opencode/activity.jsonl    (one JSON object per line)
 *
 * Why JSONL:
 *   - Cheap append (write one line, no full-file rewrite).
 *   - Easy to tail / filter / reverse-scan without parsing the whole
 *     file.
 *   - Survives partial writes — corrupt trailing lines are skipped on
 *     read.
 *
 * Use cases:
 *   - The Activity tab reads the latest N entries for the global
 *     stream and filters by `nodeId` for per-node drilldowns.
 *   - Comment/task injection on canvas nodes writes here with
 *     `kind: 'node.comment'` and a `nodeId` so the detail panel can
 *     show a thread.
 *   - Task delegation broadcasts append with `kind: 'task.delegated'`
 *     and a `nodeId` of `task:<id>`.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const LOG_FILE = join(HOME, '.config', 'opencode', 'activity.jsonl');

// Hard cap on retained entries (the file is rotated/truncated by the
// caller; we just stop reading past this many in `recent()`).
const MAX_RETAINED = 5000;
const MAX_LINES_PER_READ = 5000;

function ensureFile() {
  mkdirSync(dirname(LOG_FILE), { recursive: true });
  if (!existsSync(LOG_FILE)) {
    writeFileSync(LOG_FILE, '', 'utf8');
  }
}

function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export const activityLog = {
  LOG_FILE,

  /**
   * Append an event. `event` is a plain object; we add `ts` if absent.
   */
  append(event) {
    try {
      ensureFile();
      const record = { ts: new Date().toISOString(), ...event };
      appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
      // Best-effort rotate when the file gets large.
      try {
        const st = statSync(LOG_FILE);
        if (st.size > 5 * 1024 * 1024) {
          // Truncate to last MAX_RETAINED lines.
          const lines = readFileSync(LOG_FILE, 'utf8').split(/\r?\n/);
          const kept = lines.slice(-MAX_RETAINED).join('\n') + '\n';
          writeFileSync(LOG_FILE, kept, 'utf8');
        }
      } catch {
        /* best-effort */
      }
      return record;
    } catch (err) {
      console.error('[activity-log] append failed:', err.message);
      return null;
    }
  },

  /**
   * Read up to `limit` most-recent entries, newest-first.
   */
  recent(limit = 100) {
    try {
      ensureFile();
      const text = readFileSync(LOG_FILE, 'utf8');
      if (!text.trim()) return [];
      const lines = text.split(/\r?\n/).filter(Boolean);
      const slice = lines.slice(-Math.min(MAX_LINES_PER_READ, Math.max(1, limit * 4)));
      const out = [];
      for (let i = slice.length - 1; i >= 0 && out.length < limit; i--) {
        const parsed = safeParse(slice[i]);
        if (parsed) out.push(parsed);
      }
      return out;
    } catch {
      return [];
    }
  },

  /**
   * Filter the recent log by nodeId. Newest-first.
   */
  forNode(nodeId, limit = 50) {
    if (!nodeId) return [];
    const all = this.recent(limit * 4);
    return all.filter((e) => e.nodeId === nodeId).slice(0, limit);
  },

  /**
   * Filter by kind. Newest-first.
   */
  byKind(kind, limit = 100) {
    const all = this.recent(limit * 4);
    return all.filter((e) => e.kind === kind).slice(0, limit);
  },

  /**
   * Stats: counts by kind, last ts, file size.
   */
  stats() {
    try {
      ensureFile();
      const st = statSync(LOG_FILE);
      const text = readFileSync(LOG_FILE, 'utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      const counts = {};
      let lastTs = null;
      for (const line of lines) {
        const p = safeParse(line);
        if (!p) continue;
        counts[p.kind || 'unknown'] = (counts[p.kind || 'unknown'] || 0) + 1;
        if (!lastTs || p.ts > lastTs) lastTs = p.ts;
      }
      return {
        file: LOG_FILE,
        size: st.size,
        lines: lines.length,
        lastTs,
        counts,
      };
    } catch {
      return { file: LOG_FILE, size: 0, lines: 0, lastTs: null, counts: {} };
    }
  },
};