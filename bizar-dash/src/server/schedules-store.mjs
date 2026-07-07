/**
 * src/server/schedules-store.mjs
 *
 * v3.9.0 — Schedules registry.
 *
 * Each project has its own schedules.json at
 *   ~/.config/cline/projects/<id>/schedules.json
 *
 * A schedule is a recurring task: { name, type, schedule, action, enabled, ... }.
 * Supported types:
 *   - interval  ("30m", "2h", "1d")
 *   - cron      ("0 0 * * *")  — full cron via the `croner` package, with
 *                                optional IANA `timezone` (default "UTC")
 *   - once      (ISO timestamp)
 *
 * The dashboard reads / writes schedules here. The bizar service daemon
 * (cli/service.mjs) calls evaluateAndRun() on a tick to fire due actions.
 *
 * v3.9.0 changes vs v3.x:
 *   - Cron parsing is now delegated to `croner` (proper 5-field + 6-field
 *     + IANA TZ support). The old hand-rolled `nextCronMinute` walker is
 *     gone.
 *   - New Schedule fields: `timezone`, `budgetCheck`, `action.prompt`.
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
import { Cron } from 'croner';
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
    if (typeof schedule.schedule !== 'string' || !schedule.schedule.trim()) return null;
    try {
      const tz = schedule.timezone || 'UTC';
      // croner takes IANA tz names ("America/New_York", "Europe/Berlin",
      // "UTC", etc.) and falls back to the system zone on invalid input.
      const job = new Cron(schedule.schedule, { timezone: tz });
      const next = job.nextRun(new Date(fromMs));
      return next ? next.toISOString() : null;
    } catch {
      return null;
    }
  }
  return null;
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
      timezone: typeof input.timezone === 'string' && input.timezone.trim()
        ? input.timezone.trim()
        : 'UTC',
      action: input.action,
      budgetCheck: input.budgetCheck && typeof input.budgetCheck === 'object'
        ? {
            maxConcurrent: Number.isFinite(input.budgetCheck.maxConcurrent)
              ? input.budgetCheck.maxConcurrent
              : 6,
            skipIfBudgetLow: !!input.budgetCheck.skipIfBudgetLow,
          }
        : { maxConcurrent: 6, skipIfBudgetLow: false },
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now,
      lastRun: null,
      lastResult: null,
      lastError: null,
      nextRun: computeNextRun({
        type: input.type,
        schedule: input.schedule,
        timezone: input.timezone || 'UTC',
      }),
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
    // Sanitize nested budgetCheck so callers can't smuggle in extra keys
    // (matches the shape validation in `add`).
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'budgetCheck')) {
      const bc = patch.budgetCheck && typeof patch.budgetCheck === 'object'
        ? patch.budgetCheck
        : {};
      next.budgetCheck = {
        maxConcurrent: Number.isFinite(bc.maxConcurrent) ? bc.maxConcurrent : 6,
        skipIfBudgetLow: !!bc.skipIfBudgetLow,
      };
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'timezone')) {
      next.timezone = typeof patch.timezone === 'string' && patch.timezone.trim()
        ? patch.timezone.trim()
        : 'UTC';
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'action') && patch.action) {
      // Preserve the existing action shape; only the listed keys are merged.
      next.action = {
        type: patch.action.type || cur.action.type,
        target: patch.action.target ?? cur.action.target,
        prompt: patch.action.prompt ?? cur.action.prompt,
        method: patch.action.method ?? cur.action.method,
        body: patch.action.body ?? cur.action.body,
        title: patch.action.title ?? cur.action.title,
        name: patch.action.name ?? cur.action.name,
      };
    }
    if (patch.type || patch.schedule || patch.timezone) {
      next.nextRun = computeNextRun({
        type: next.type,
        schedule: next.schedule,
        timezone: next.timezone || 'UTC',
      });
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
    // `result` is one of: 'success' | 'error' | 'skipped'. Pass through
    // whatever the runner reports — null is also legal for backwards
    // compat with old callers, but the new runner always passes a value.
    sched.lastResult = result || null;
    sched.lastError = error || null;
    if (sched.type === 'once') {
      sched.enabled = false;
    } else {
      sched.nextRun = computeNextRun(sched, Date.now());
    }
    sched.history = sched.history || [];
    sched.history.push({ ts: now, result: result || 'unknown', error: error || null });
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
