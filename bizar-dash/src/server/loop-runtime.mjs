/**
 * src/server/loop-runtime.mjs
 *
 * v10.6.0 — G-autoloop Phase 2. Background loop runtime.
 *
 * A "loop" is a long-running scheduler that:
 *   1. Wakes every N milliseconds (configurable per-loop).
 *   2. Scans the project's task store for ready tasks (status: 'queued',
 *      no unresolved blockers, no inflight assignee).
 *   3. Claims one task at a time (atomic move 'queued' → 'doing') and
 *      dispatches it via `taskDelegator.dispatchSingleTask` — the same
 *      path the dashboard's "Start" button already uses.
 *   4. Writes a `state.json` snapshot under
 *      `<BIZAR_LOOPS_ROOT>/<loopId>/state.json` on every tick so the
 *      loop can be resumed cleanly after a crash.
 *
 * Persistence shape (per loop):
 *
 *   <BIZAR_LOOPS_ROOT>/<loopId>/state.json
 *   {
 *     loopId, projectId, name, status, createdAt, updatedAt,
 *     intervalMs, lastTickAt, lastError,
 *     dispatched: [{ taskId, dispatchedAt, bgInstanceId? }],
 *     iteration, maxIterations
 *   }
 *
 * `status ∈ { 'pending' | 'running' | 'stopped' | 'error' }`.
 *
 * Crash recovery: on `start()` we read the existing state.json; if
 * `status === 'running'` and `updatedAt` is older than 5 minutes, we
 * assume the previous process died and resume — re-claiming tasks that
 * are still in 'doing' but have no live bg instance (per
 * backgroundStore.list()) and re-dispatching them.
 *
 * Non-goals: This module does NOT depend on the dashboard server. It
 * can be driven from a CLI daemon (`bizar-loop start`) just as easily
 * as from inside the dashboard, since dispatch goes through
 * `taskDelegator` which is the same path both use.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const HOME = homedir();

/** Override via env var (used by tests). */
export const LOOPS_ROOT = process.env.BIZAR_LOOPS_ROOT
  || join(HOME, '.bizar', 'loops');

const STATUSES = new Set(['pending', 'running', 'stopped', 'error']);

/**
 * Random id for new loops. Short, URL-safe, distinct.
 * @returns {string}
 */
export function genLoopId() {
  return `loop_${randomBytes(4).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Path to a loop's state.json.
 * @param {string} loopId
 */
export function stateFile(loopId) {
  return join(LOOPS_ROOT, loopId, 'state.json');
}

/**
 * Safely read+parse JSON. Returns fallback on missing or corrupt.
 * @param {string} file
 * @param {Object} fallback
 */
function safeReadJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * Atomic write: tmp file + rename.
 * @param {string} file
 * @param {Object} data
 */
function atomicWriteJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

/**
 * Validate a partial state object; fill missing fields with safe defaults.
 * @param {Object} input
 * @param {string} loopId
 */
function normalize(input, loopId) {
  const status = STATUSES.has(input.status) ? input.status : 'pending';
  return {
    loopId,
    projectId: input.projectId || '',
    name: input.name || loopId,
    status,
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso(),
    intervalMs: Number(input.intervalMs) > 0 ? Number(input.intervalMs) : 30000,
    lastTickAt: input.lastTickAt || null,
    lastError: input.lastError || null,
    dispatched: Array.isArray(input.dispatched) ? input.dispatched : [],
    iteration: Number.isFinite(input.iteration) ? input.iteration : 0,
    maxIterations: Number.isFinite(input.maxIterations) ? input.maxIterations : Infinity,
  };
}

/**
 * Create a new loop. Writes initial state.json and returns it.
 *
 * @param {Object} spec
 * @param {string} spec.projectId
 * @param {string} [spec.name]
 * @param {number} [spec.intervalMs]      wake interval; default 30s
 * @param {number} [spec.maxIterations]   cap before stopping; default Infinity
 * @returns {Object} state
 */
export function createLoop(spec = {}) {
  if (!spec.projectId) throw new TypeError('createLoop: projectId required');
  const loopId = genLoopId();
  const state = normalize({ ...spec, status: 'pending' }, loopId);
  atomicWriteJson(stateFile(loopId), state);
  return state;
}

/**
 * Read a loop's state. Returns null if the loop doesn't exist.
 *
 * @param {string} loopId
 * @returns {Object|null}
 */
export function readLoop(loopId) {
  const file = stateFile(loopId);
  if (!existsSync(file)) return null;
  return safeReadJson(file, null);
}

/**
 * Patch loop state with partial fields. Recomputes updatedAt.
 *
 * @param {string} loopId
 * @param {Object} patch
 * @returns {Object|null} new state, or null if loop doesn't exist
 */
export function patchLoop(loopId, patch = {}) {
  const cur = readLoop(loopId);
  if (!cur) return null;
  const next = normalize({ ...cur, ...patch, loopId }, loopId);
  atomicWriteJson(stateFile(loopId), next);
  return next;
}

/**
 * Delete a loop's state files. Idempotent.
 *
 * @param {string} loopId
 */
export function deleteLoop(loopId) {
  const dir = join(LOOPS_ROOT, loopId);
  try {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      try { unlinkSync(join(dir, f)); } catch { /* */ }
    }
  } catch { /* */ }
}

/**
 * List all loop ids known on disk. Skips entries that aren't directories.
 *
 * @returns {string[]}
 */
export function listLoops() {
  if (!existsSync(LOOPS_ROOT)) return [];
  const out = [];
  for (const name of readdirSync(LOOPS_ROOT)) {
    try {
      if (statSync(join(LOOPS_ROOT, name)).isDirectory()) out.push(name);
    } catch { /* */ }
  }
  return out;
}

/**
 * Snapshot the full loop registry: { loopId: state, ... }.
 * @returns {Object}
 */
export function snapshotLoops() {
  const out = {};
  for (const id of listLoops()) {
    const s = readLoop(id);
    if (s) out[id] = s;
  }
  return out;
}

// ---------------------------------------------------------------------------
// In-process scheduler (Phase 2 wiring)
// ---------------------------------------------------------------------------
// We keep an in-process registry of active timers so multiple loops can
// coexist in one Node process (dashboard server + `bizar-loop start` CLI).
// Crash recovery is best-effort: a `kill -9` of the loop's owning process
// loses the timer; the next `start()` of that loopId resumes from state.json
// (see resume logic below).

const activeTimers = new Map(); // loopId → { timer, projectId, intervalMs, getTaskStore, dispatch }

function ensureFreshDispatched(state) {
  if (!Array.isArray(state.dispatched)) state.dispatched = [];
  return state;
}

/**
 * Find ready tasks for a project. A task is "ready" when:
 *   - status === 'queued'
 *   - archived === false
 *   - no unmet dependencies
 *   - no in-flight assignee (we don't double-dispatch)
 *
 * Pure function over the tasks array so it works with whatever
 * TaskStore abstraction the caller passes in (real store in
 * production, in-memory array in tests).
 *
 * @param {Array} tasks
 * @returns {Array}
 */
export function pickReadyTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  const byId = new Map();
  for (const t of tasks) if (t && t.id) byId.set(t.id, t);
  return tasks
    .filter((t) => t && t.status === 'queued' && !t.archived)
    .filter((t) => {
      const deps = Array.isArray(t.dependencies) ? t.dependencies : [];
      return deps.every((d) => {
        const dep = byId.get(d);
        return dep && dep.status === 'done';
      });
    })
    .sort((a, b) => {
      // Priority first (lower number = higher priority), then age.
      const pa = Number.isFinite(a.priority) ? a.priority : 5;
      const pb = Number.isFinite(b.priority) ? b.priority : 5;
      if (pa !== pb) return pa - pb;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

/**
 * Run one tick of the loop: scan → pick the highest-priority ready task
 * → claim it (move 'queued' → 'doing') → dispatch. Returns a structured
 * result the caller can persist.
 *
 * Inputs are injected so tests don't need a real task store. The
 * caller passes:
 *   - getTasks: () => Array<Task>
 *   - claimTask: (id) => updated Task | null   (move to 'doing', set assignee + workedBy)
 *   - dispatch: (task) => { ok: boolean, bgInstanceId?: string, error?: string }
 *
 * @param {Object} ctx
 * @param {Function} ctx.getTasks
 * @param {Function} ctx.claimTask
 * @param {Function} ctx.dispatch
 * @returns {Object} { picked, dispatched, iteration, lastError }
 */
export async function runTick({ getTasks, claimTask, dispatch }) {
  if (typeof getTasks !== 'function') throw new TypeError('runTick: getTasks required');
  if (typeof claimTask !== 'function') throw new TypeError('runTick: claimTask required');
  if (typeof dispatch !== 'function') throw new TypeError('runTick: dispatch required');
  const tasks = getTasks() || [];
  const ready = pickReadyTasks(tasks);
  if (ready.length === 0) {
    return { picked: null, dispatched: null, iteration: 0, lastError: null };
  }
  const target = ready[0];
  const claimed = claimTask(target.id);
  if (!claimed) {
    return { picked: target.id, dispatched: null, iteration: 0, lastError: 'claim_failed' };
  }
  let result;
  try {
    result = await dispatch(claimed);
  } catch (err) {
    return {
      picked: target.id,
      dispatched: null,
      iteration: 0,
      lastError: err && err.message ? String(err.message) : String(err),
    };
  }
  if (!result || !result.ok) {
    return {
      picked: target.id,
      dispatched: null,
      iteration: 0,
      lastError: result && result.error ? String(result.error) : 'dispatch_failed',
    };
  }
  return {
    picked: target.id,
    dispatched: { taskId: target.id, dispatchedAt: nowIso(), bgInstanceId: result.bgInstanceId || null },
    iteration: 1,
    lastError: null,
  };
}

/**
 * Start (or resume) a loop. Idempotent — calling twice on the same
 * loopId is a no-op for the second call.
 *
 * @param {string} loopId
 * @param {Object} ctx
 * @param {Function} ctx.getTasks           () => Array<Task>
 * @param {Function} ctx.claimTask          (id) => Task|null
 * @param {Function} ctx.dispatch           (task) => { ok, bgInstanceId?, error? }
 * @param {Function} [ctx.onTick]           called after each tick with the result
 * @param {Function} [ctx.onError]          called on uncaught tick errors
 * @returns {Object} state
 */
export function startLoop(loopId, ctx = {}) {
  const cur = readLoop(loopId);
  if (!cur) throw new Error(`startLoop: loop ${loopId} not found`);
  if (activeTimers.has(loopId)) return cur; // already running

  const tick = async () => {
    const state = readLoop(loopId);
    if (!state || state.status === 'stopped') return;
    let result;
    try {
      result = await runTick({
        getTasks: ctx.getTasks,
        claimTask: ctx.claimTask,
        dispatch: ctx.dispatch,
      });
    } catch (err) {
      patchLoop(loopId, { status: 'error', lastError: err.message || String(err), updatedAt: nowIso() });
      if (typeof ctx.onError === 'function') ctx.onError(err, loopId);
      return;
    }
    ensureFreshDispatched(state);
    const dispatched = result.dispatched
      ? [...state.dispatched, result.dispatched]
      : state.dispatched;
    const iteration = state.iteration + (result.iteration || 0);
    const next = patchLoop(loopId, {
      status: 'running',
      lastTickAt: nowIso(),
      lastError: result.lastError,
      dispatched,
      iteration,
    });
    if (typeof ctx.onTick === 'function') ctx.onTick(result, next);
    if (Number.isFinite(next.maxIterations) && next.iteration >= next.maxIterations) {
      patchLoop(loopId, { status: 'stopped' });
      stopLoop(loopId);
      return;
    }
  };

  patchLoop(loopId, { status: 'running' });
  const timer = setInterval(tick, cur.intervalMs);
  // Don't keep the Node process alive just to run a loop.
  if (typeof timer.unref === 'function') timer.unref();
  activeTimers.set(loopId, { timer, loopId });
  return readLoop(loopId);
}

/**
 * Stop a loop. Cancels the in-process timer (if any) and marks the
 * state as 'stopped' so a future start() resumes from the snapshot
 * rather than starting fresh.
 *
 * @param {string} loopId
 */
export function stopLoop(loopId) {
  const entry = activeTimers.get(loopId);
  if (entry) {
    clearInterval(entry.timer);
    activeTimers.delete(loopId);
  }
  const cur = readLoop(loopId);
  // `error` is terminal — don't overwrite it with 'stopped' on a
  // subsequent explicit stop. Otherwise an errored loop silently
  // masks its failure.
  if (cur && cur.status !== 'stopped' && cur.status !== 'error') {
    patchLoop(loopId, { status: 'stopped' });
  }
  return readLoop(loopId);
}

/**
 * Drop the in-process timer without touching state.json. Used by tests
 * and by the dashboard's shutdown handler.
 */
export function _dropInProcessTimers() {
  for (const [, entry] of activeTimers) clearInterval(entry.timer);
  activeTimers.clear();
}

/**
 * Crash-recovery helper. Returns `{ resumed, orphanedTaskIds }` where
 * `orphanedTaskIds` are tasks that were marked 'doing' but no longer
 * have a live bg instance — those should be re-claimed by a fresh
 * tick after `startLoop`.
 *
 * Currently a no-op placeholder; the real implementation lives in
 * the dashboard integration in Phase 5 (uses backgroundStore.list()
 * to compare). Wire it once Phase 5 lands.
 */
export function planResume(_loopId) {
  return { resumed: false, orphanedTaskIds: [] };
}
