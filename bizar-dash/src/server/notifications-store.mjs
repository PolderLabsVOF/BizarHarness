/**
 * src/server/notifications-store.mjs
 *
 * v3.3.0 — Per-user notification stream.
 *
 * Storage:
 *   ~/.config/bizar/notifications.jsonl   (append-only log)
 *
 * Each entry:
 *   { id, ts, severity, message, source, read, meta? }
 *
 * The store also keeps a Set of "read" ids in memory and writes them
 * to ~/.config/bizar/notifications.read.json so the read state
 * survives restarts.
 *
 * Reading is "append-only" but the read state is destructive. That's
 * the standard pattern for this kind of activity log.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  appendFileSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const HOME = homedir();
const BIZAR_HOME = join(HOME, '.config', 'bizar');
const LOG_FILE = join(BIZAR_HOME, 'notifications.jsonl');
const READ_FILE = join(BIZAR_HOME, 'notifications.read.json');

const VALID_SEVERITY = ['info', 'success', 'warning', 'error'];
const MAX_KEPT = 1000;

function atomicWriteText(filePath, text) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, filePath);
}

function atomicWriteJson(filePath, data) {
  atomicWriteText(filePath, JSON.stringify(data, null, 2) + '\n');
}

function genId() {
  return `n_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

function ensureLogFile() {
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

function loadReadSet() {
  try {
    if (!existsSync(READ_FILE)) return new Set();
    const raw = JSON.parse(readFileSync(READ_FILE, 'utf8'));
    if (Array.isArray(raw)) return new Set(raw);
    return new Set();
  } catch {
    return new Set();
  }
}

function saveReadSet(set) {
  try {
    mkdirSync(dirname(READ_FILE), { recursive: true });
    atomicWriteJson(READ_FILE, Array.from(set));
  } catch {
    /* best-effort */
  }
}

let _readSet = null;
function getReadSet() {
  if (_readSet === null) _readSet = loadReadSet();
  return _readSet;
}

export const notificationsStore = {
  LOG_FILE,
  READ_FILE,

  /**
   * Append a new notification. Returns the record. If `broadcast` is
   * provided the new event is also pushed to all WS clients.
   */
  add(input, { broadcast } = {}) {
    if (!input || typeof input !== 'object') {
      throw new Error('notification input required');
    }
    const severity = VALID_SEVERITY.includes(input.severity) ? input.severity : 'info';
    const record = {
      id: input.id || genId(),
      ts: input.ts || new Date().toISOString(),
      severity,
      message: (input.message || '').toString().slice(0, 1000),
      source: (input.source || 'system').toString().slice(0, 100),
      title: (input.title || '').toString().slice(0, 200),
      link: input.link || null,
      read: false,
      meta: input.meta && typeof input.meta === 'object' ? input.meta : null,
    };
    try {
      ensureLogFile();
      appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
      // Rotate when the log gets big.
      try {
        const st = statSync(LOG_FILE);
        if (st.size > 2 * 1024 * 1024) {
          const lines = readFileSync(LOG_FILE, 'utf8').split(/\r?\n/);
          const kept = lines.slice(-MAX_KEPT).join('\n') + '\n';
          atomicWriteText(LOG_FILE, kept);
        }
      } catch {
        /* best-effort */
      }
      if (typeof broadcast === 'function') {
        broadcast({ type: 'notification:new', notification: record });
      }
    } catch (err) {
      console.error('[notifications] append failed:', err.message);
    }
    return record;
  },

  /**
   * List notifications, newest first. Supports an optional `unread` flag
   * to filter to unread only, and an optional `limit`.
   */
  list({ unread = false, limit = 200 } = {}) {
    try {
      ensureLogFile();
      const text = readFileSync(LOG_FILE, 'utf8');
      if (!text.trim()) return [];
      const lines = text.split(/\r?\n/).filter(Boolean);
      const readSet = getReadSet();
      const out = [];
      for (let i = lines.length - 1; i >= 0 && out.length < Math.max(1, limit); i--) {
        const p = safeParse(lines[i]);
        if (!p) continue;
        const isRead = readSet.has(p.id);
        if (unread && isRead) continue;
        out.push({ ...p, read: isRead });
      }
      return out;
    } catch {
      return [];
    }
  },

  /** Stats: total, unread, latest ts, severity counts. */
  stats() {
    try {
      ensureLogFile();
      const text = readFileSync(LOG_FILE, 'utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      const readSet = getReadSet();
      const counts = { info: 0, success: 0, warning: 0, error: 0 };
      let unread = 0;
      let lastTs = null;
      for (const line of lines) {
        const p = safeParse(line);
        if (!p) continue;
        counts[p.severity] = (counts[p.severity] || 0) + 1;
        if (!readSet.has(p.id)) unread += 1;
        if (!lastTs || p.ts > lastTs) lastTs = p.ts;
      }
      return {
        total: lines.length,
        unread,
        lastTs,
        counts,
      };
    } catch {
      return { total: 0, unread: 0, lastTs: null, counts: {} };
    }
  },

  /** Mark a single id as read. */
  markRead(id) {
    if (!id) return false;
    const set = getReadSet();
    set.add(id);
    saveReadSet(set);
    return true;
  },

  /** Mark every notification as read. */
  markAllRead() {
    try {
      ensureLogFile();
      const text = readFileSync(LOG_FILE, 'utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      const set = getReadSet();
      for (const line of lines) {
        const p = safeParse(line);
        if (p && p.id) set.add(p.id);
      }
      saveReadSet(set);
      return set.size;
    } catch {
      return 0;
    }
  },

  /** Remove a notification from the log (e.g. user dismisses). */
  remove(id) {
    if (!id) return false;
    try {
      ensureLogFile();
      const text = readFileSync(LOG_FILE, 'utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      const kept = lines.filter((l) => {
        const p = safeParse(l);
        return p && p.id !== id;
      });
      if (kept.length === lines.length) return false;
      atomicWriteText(LOG_FILE, kept.join('\n') + (kept.length ? '\n' : ''));
      const set = getReadSet();
      set.delete(id);
      saveReadSet(set);
      return true;
    } catch {
      return false;
    }
  },
};
