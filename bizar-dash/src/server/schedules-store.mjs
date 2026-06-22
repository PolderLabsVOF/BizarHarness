/**
 * src/server/schedules-store.mjs
 *
 * v3.0.0 — Schedules registry.
 *
 * Each project has its own schedules.json at
 *   ~/.config/opencode/projects/<id>/schedules.json
 *
 * A schedule is a recurring task: { name, type, schedule, action, enabled, ... }.
 * Supported types:
 *   - interval  ("30m", "2h", "1d")
 *   - cron      ("0 0 * * *")  — best-effort: we evaluate on each tick
 *                                to detect the next minute boundary
 *   - once      (ISO timestamp)
 *
 * The dashboard reads / writes schedules here. The bizar service daemon
 * (cli/service.mjs) calls evaluateAndRun() on a tick to fire due actions.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { projectsStore } from './projects-store.mjs';

function safeReadJSON(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function genId() {
  return 'sched_' + randomBytes(5).toString('hex').slice(0, 10);
}

/** Parse "30m" / "2h" / "1d" / "45s" → milliseconds. */
export function parseInterval(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d+)\s*(s|sec|second|m|min|minute|h|hr|hour|d|day)$/i.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('s')) return n * 1000;
  if (unit.startsWith('m')) return n * 60 * 1000;
  if (unit.startsWith('h')) return n * 60 * 60 * 1000;
  if (unit.startsWith('d')) return n * 24 * 60 * 60 * 1000;
  return null;
}

/** Compute the next firing time for a schedule. Returns ISO string or null. */
export function computeNextRun(schedule, fromMs = Date.now()) {
  const type = schedule.type;
  if (type === 'interval') {
    const ms = parseInterval(schedule.schedule);
    if (!ms) return null;
    const last = schedule.lastRun ? new Date(schedule.lastRun).getTime() : fromMs;
    return new Date(last + ms).toISOString();
  }
  if (type === 'once') {
    if (schedule.lastRun) return null; // already fired
    const when = new Date(schedule.schedule).getTime();
    if (Number.isNaN(when)) return null;
    return new Date(Math.max(when, fromMs)).toISOString();
  }
  if (type === 'cron') {
    // Minimal cron — we only support "* * * * *" patterns for v3.
    // Compute the next minute that matches.
    return nextCronMinute(schedule.schedule, fromMs);
  }
  return null;
}

/** Very minimal cron: supports star, integers, and slash-N. Returns next match. */
function nextCronMinute(expr, fromMs) {
  if (typeof expr !== 'string') return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;
  // For v3 we only support minute precision and very simple patterns.
  // Iterate minute-by-minute up to 7 days to find the next match.
  const start = new Date(fromMs);
  start.setSeconds(0, 0);
  const end = start.getTime() + 7 * 24 * 60 * 60 * 1000;
  for (let t = start.getTime(); t <= end; t += 60 * 1000) {
    const d = new Date(t);
    if (!matchField(m, d.getMinutes())) continue;
    if (!matchField(h, d.getHours())) continue;
    if (!matchField(dom, d.getDate())) continue;
    if (!matchField(mon, d.getMonth() + 1)) continue;
    if (!matchField(dow, d.getDay())) continue;
    return new Date(t).toISOString();
  }
  return null;
}

function matchField(field, value) {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const n = parseInt(field.slice(2), 10);
    return n > 0 && value % n === 0;
  }
  if (field.includes(',')) {
    return field.split(',').some((p) => matchField(p.trim(), value));
  }
  if (field.includes('-')) {
    const [a, b] = field.split('-').map((p) => parseInt(p, 10));
    return value >= a && value <= b;
  }
  return parseInt(field, 10) === value;
}

function loadSchedules(projectId) {
  const dir = projectsStore.ensureProjectDir(projectId);
  const file = join(dir, 'schedules.json');
  const data = safeReadJSON(file, null);
  if (!data || !Array.isArray(data.schedules)) {
    return { version: 1, schedules: [] };
  }
  return data;
}

function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

function saveSchedules(projectId, data) {
  const dir = projectsStore.ensureProjectDir(projectId);
  atomicWriteJson(join(dir, 'schedules.json'), data);
}

export const schedulesStore = {
  list(projectId) {
    return loadSchedules(projectId).schedules;
  },

  get(projectId, id) {
    return this.list(projectId).find((s) => s.id === id) || null;
  },

  add(projectId, input) {
    if (!input || typeof input !== 'object') {
      throw new Error('schedule payload required');
    }
    if (!input.name) throw new Error('name is required');
    if (!['interval', 'cron', 'once'].includes(input.type)) {
      throw new Error('type must be interval | cron | once');
    }
    if (!input.schedule) throw new Error('schedule is required');
    if (!input.action || typeof input.action !== 'object') {
      throw new Error('action is required');
    }
    const data = loadSchedules(projectId);
    const now = new Date().toISOString();
    const sched = {
      id: genId(),
      name: input.name,
      type: input.type,
      schedule: input.schedule,
      action: input.action,
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now,
      lastRun: null,
      lastResult: null,
      nextRun: computeNextRun({ type: input.type, schedule: input.schedule }),
      history: [],
    };
    data.schedules.push(sched);
    saveSchedules(projectId, data);
    return sched;
  },

  update(projectId, id, patch) {
    const data = loadSchedules(projectId);
    const idx = data.schedules.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    const cur = data.schedules[idx];
    const next = {
      ...cur,
      ...patch,
      id: cur.id,
      updatedAt: new Date().toISOString(),
    };
    if (patch.type || patch.schedule) {
      next.nextRun = computeNextRun({ type: next.type, schedule: next.schedule });
    }
    data.schedules[idx] = next;
    saveSchedules(projectId, data);
    return next;
  },

  remove(projectId, id) {
    const data = loadSchedules(projectId);
    const before = data.schedules.length;
    data.schedules = data.schedules.filter((s) => s.id !== id);
    if (data.schedules.length === before) return false;
    saveSchedules(projectId, data);
    return true;
  },

  /** Record the result of a run. */
  recordRun(projectId, id, { result, error }) {
    const data = loadSchedules(projectId);
    const sched = data.schedules.find((s) => s.id === id);
    if (!sched) return null;
    const now = new Date().toISOString();
    sched.lastRun = now;
    sched.lastResult = result;
    if (sched.type === 'once') {
      sched.enabled = false;
    } else {
      sched.nextRun = computeNextRun(sched, Date.now());
    }
    sched.history = sched.history || [];
    sched.history.push({ ts: now, result, error: error || null });
    if (sched.history.length > 50) sched.history = sched.history.slice(-50);
    saveSchedules(projectId, data);
    return sched;
  },

  /** Return all schedules for the project that are currently due. */
  due(projectId, now = Date.now()) {
    return this.list(projectId).filter((s) => {
      if (!s.enabled) return false;
      if (!s.nextRun) return false;
      return new Date(s.nextRun).getTime() <= now;
    });
  },
};
