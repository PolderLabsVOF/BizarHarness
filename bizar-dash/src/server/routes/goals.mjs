/**
 * src/server/routes/goals.mjs
 *
 * Sprint S10/S12 — `/api/goals` CRUD over `.bizar/PROGRESS.md`.
 *
 * Goals are the long-horizon commitments the v8 dashboard surfaces.
 * Source-of-truth is `.bizar/PROGRESS.md` so CC's `/goal` and the
 * dashboard stay in sync — no parallel JSON.
 *
 * Endpoints:
 *   GET    /api/goals                       — parsed goal list
 *   GET    /api/goals/:id                   — single goal
 *   POST   /api/goals                       — create
 *   PATCH  /api/goals/:id                   — rename / due / owner
 *   PATCH  /api/goals/:id/status            — change status (S10 quick edit)
 *   POST   /api/goals/:id/key-results       — append KR
 *   PATCH  /api/goals/:id/key-results/:krId — toggle done / change metric
 *   DELETE /api/goals/:id/key-results/:krId — remove KR
 */

import { Router } from 'express';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, watch } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { wrap } from './_shared.mjs';
import { projectsStore } from '../projects-store.mjs';
import { tasksStore } from '../tasks-store.mjs';
import { parseProgress, serializeProgress } from '../progress-parser.mjs';
import { mintArtifact } from '../artifact-mint.mjs';

const VALID_STATUSES = new Set(['on-track', 'at-risk', 'off-track', 'done', 'blocked', 'active']);
const HOME = homedir();

/** S17 — watch PROGRESS.md so edits from CC's `/goal` slash command
 *  (which writes the file directly) push live updates to the
 *  dashboard. Debounced because editors frequently emit 2+ events
 *  for one logical write. */
let watcher = null;
let watcherDebounce = null;
let watchedPath = null;

function startProgressWatcher(broadcast) {
  if (watcher || typeof broadcast !== 'function') return;
  const target = progressPath();
  if (!existsSync(target)) return;
  watchedPath = target;
  try {
    watcher = watch(target, { persistent: false }, () => {
      if (watcherDebounce) clearTimeout(watcherDebounce);
      watcherDebounce = setTimeout(() => {
        broadcast({ type: 'goals:file-changed', path: target });
        // Also re-broadcast the full list so any view without a
        // local merge path catches up. Cheap: parse is < 1ms.
        try {
          const parsed = parseProgress(readRaw());
          for (const g of parsed.goals) {
            broadcast({ type: 'goals:change', goal: g });
          }
        } catch { /* ignore parse errors */ }
      }, 150);
    });
    watcher.on('error', () => { watcher = null; });
  } catch { /* ENOENT on some editors — fall through */ }
}

function stopProgressWatcher() {
  if (watcher) {
    try { watcher.close(); } catch { /* */ }
    watcher = null;
  }
  if (watcherDebounce) {
    clearTimeout(watcherDebounce);
    watcherDebounce = null;
  }
  watchedPath = null;
}

export { startProgressWatcher, stopProgressWatcher, progressPath, watchedPath };

function progressPath() {
  // PROGRESS.md lives in the project root (v6 contract). Falls back
  // to $HOME so a freshly-cloned dashboard with no active project
  // doesn't 500 — the response is just an empty goal list.
  //
  // v10-S3 — fix `active.cwd` → `active.path`. projectsStore stores
  // the project root under the `path` key (see projects-store.mjs:168
  // — `path: absPath`), so reading `.cwd` always returned undefined
  // and the dashboard silently fell back to $HOME/.bizar/PROGRESS.md.
  // That's the bug the v10-S3 cross-boundary E2E caught.
  const active = projectsStore.active();
  const root = active?.path ? resolve(active.path) : HOME;
  return join(root, '.bizar', 'PROGRESS.md');
}

function readRaw() {
  const p = progressPath();
  if (!existsSync(p)) return '';
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

function writeRaw(text) {
  const p = progressPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, p);
}

function emit(broadcast, goal) {
  if (typeof broadcast === 'function') {
    broadcast({ type: 'goals:change', goal });
  }
}

/**
 * S17 — auto-derive "at-risk" status from KR progress + due-date
 * proximity. Only escalates from "on-track" to "at-risk" — never
 * downgrades user-set "off-track"/"blocked"/"done". If a due date is
 * present and <14 days away, KRs less than 50% complete flip the
 * goal to at-risk; past-due with KRs outstanding flips it to off-track.
 * The derived status is *not* persisted — it's read-time only.
 */
function deriveRiskStatus(goal) {
  const status = String(goal.status || '').toLowerCase();
  if (status === 'done' || status === 'off-track' || status === 'blocked') return goal;
  const krs = Array.isArray(goal.keyResults) ? goal.keyResults : [];
  if (krs.length === 0) return goal;
  const done = krs.filter((k) => k.done).length;
  const progress = done / krs.length;
  const due = goal.due ? Date.parse(goal.due) : NaN;
  const now = Date.now();
  const dayMs = 86_400_000;
  if (!Number.isNaN(due)) {
    const overdueDays = (now - due) / dayMs;
    if (overdueDays > 0 && progress < 1) {
      return { ...goal, status: 'off-track', derivedRisk: 'overdue-incomplete' };
    }
    const daysUntilDue = (due - now) / dayMs;
    if (daysUntilDue <= 14 && progress < 0.5) {
      return { ...goal, status: 'at-risk', derivedRisk: 'due-soon-low-progress' };
    }
  }
  return goal;
}

/**
 * @param {{ broadcast?: Function }} deps
 */
export function createGoalsRouter({ broadcast, projectRoot } = {}) {
  const router = Router();

  router.get('/goals', wrap(async (_req, res) => {
    const parsed = parseProgress(readRaw());
    const enriched = parsed.goals.map(deriveRiskStatus);
    res.json({ goals: enriched, count: enriched.length });
  }));

  router.get('/goals/:id', wrap(async (req, res) => {
    const parsed = parseProgress(readRaw());
    const goal = parsed.goals.find((g) => g.id === req.params.id);
    if (!goal) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(goal);
  }));

  router.patch('/goals/:id/status', wrap(async (req, res) => {
    const status = String((req.body && req.body.status) || '').toLowerCase();
    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({
        error: 'bad_request',
        message: `invalid status (use: ${[...VALID_STATUSES].join(', ')})`,
      });
      return;
    }
    const parsed = parseProgress(readRaw());
    const goal = parsed.goals.find((g) => g.id === req.params.id);
    if (!goal) { res.status(404).json({ error: 'not_found' }); return; }
    const previousStatus = goal.status;
    goal.status = status;
    writeRaw(serializeProgress(parsed));
    emit(broadcast, goal);
    // v10.0.6 — auto-mint a 'goal-finished' artifact on the done transition.
    if (status === 'done' && previousStatus !== 'done' && projectRoot) {
      const krSummary = (goal.keyResults || [])
        .map((kr) => `- [${kr.done ? 'x' : ' '}] ${kr.title}`)
        .join('\n');
      mintArtifact({
        kind: 'goal-finished',
        entityId: goal.id,
        title: `Goal finished: ${goal.title}`,
        description: `Status moved from \`${previousStatus}\` to \`done\`.\n\n${krSummary}`,
        frontmatter: { goalId: goal.id, previousStatus, owner: goal.owner ?? null },
        projectRoot,
        broadcast,
      });
    }
    res.json(goal);
  }));

  // S12 — create goal.
  router.post('/goals', wrap(async (req, res) => {
    const body = req.body || {};
    const title = String(body.title || '').trim();
    if (!title) {
      res.status(400).json({ error: 'bad_request', message: 'title is required' });
      return;
    }
    const parsed = parseProgress(readRaw());
    const id = body.id && /^[A-Za-z0-9_-]{1,64}$/.test(String(body.id))
      ? String(body.id)
      : `G-${Date.now().toString(36)}`;
    if (parsed.goals.some((g) => g.id === id)) {
      res.status(409).json({ error: 'conflict', message: `goal id ${id} already exists` });
      return;
    }
    const goal = {
      id,
      title,
      status: VALID_STATUSES.has(String(body.status || '').toLowerCase())
        ? String(body.status).toLowerCase()
        : 'active',
      description: body.description ? String(body.description) : '',
      progress: 0,
      keyResults: [],
      owner: body.owner ? String(body.owner) : undefined,
      due: body.due ? String(body.due) : undefined,
      section: 'in-progress',
    };
    parsed.goals.push(goal);
    writeRaw(serializeProgress(parsed));
    emit(broadcast, goal);
    res.status(201).json(goal);
  }));

  // S12 — patch goal metadata.
  router.patch('/goals/:id', wrap(async (req, res) => {
    const parsed = parseProgress(readRaw());
    const goal = parsed.goals.find((g) => g.id === req.params.id);
    if (!goal) { res.status(404).json({ error: 'not_found' }); return; }
    const body = req.body || {};
    if (typeof body.title === 'string' && body.title.trim()) goal.title = body.title.trim();
    if (typeof body.description === 'string') goal.description = body.description;
    if (typeof body.owner === 'string') goal.owner = body.owner.trim() || undefined;
    if (typeof body.due === 'string') goal.due = body.due.trim() || undefined;
    if (typeof body.status === 'string' && VALID_STATUSES.has(body.status.toLowerCase())) {
      goal.status = body.status.toLowerCase();
    }
    writeRaw(serializeProgress(parsed));
    emit(broadcast, goal);
    res.json(goal);
  }));

  // S12 — append KR.
  router.post('/goals/:id/key-results', wrap(async (req, res) => {
    const parsed = parseProgress(readRaw());
    const goal = parsed.goals.find((g) => g.id === req.params.id);
    if (!goal) { res.status(404).json({ error: 'not_found' }); return; }
    const title = String((req.body && req.body.title) || '').trim();
    if (!title) { res.status(400).json({ error: 'bad_request', message: 'title is required' }); return; }
    const kr = {
      id: `kr-${goal.id}-${goal.keyResults.length + 1}`,
      title,
      done: false,
      assignee: req.body.assignee ? String(req.body.assignee) : undefined,
    };
    goal.keyResults.push(kr);
    writeRaw(serializeProgress(parsed));
    emit(broadcast, goal);
    res.status(201).json(kr);
  }));

  // S12 — toggle / rename KR.
  router.patch('/goals/:id/key-results/:krId', wrap(async (req, res) => {
    const parsed = parseProgress(readRaw());
    const goal = parsed.goals.find((g) => g.id === req.params.id);
    if (!goal) { res.status(404).json({ error: 'not_found' }); return; }
    const kr = goal.keyResults.find((k) => k.id === req.params.krId);
    if (!kr) { res.status(404).json({ error: 'not_found' }); return; }
    const body = req.body || {};
    if (typeof body.done === 'boolean') kr.done = body.done;
    if (typeof body.title === 'string' && body.title.trim()) kr.title = body.title.trim();
    if (typeof body.assignee === 'string') kr.assignee = body.assignee.trim() || undefined;
    // Recompute progress.
    const done = goal.keyResults.filter((k) => k.done).length;
    goal.progress = goal.keyResults.length > 0 ? done / goal.keyResults.length : 0;
    writeRaw(serializeProgress(parsed));
    emit(broadcast, goal);
    res.json(kr);
  }));

  // S12 — remove KR.
  router.delete('/goals/:id/key-results/:krId', wrap(async (req, res) => {
    const parsed = parseProgress(readRaw());
    const goal = parsed.goals.find((g) => g.id === req.params.id);
    if (!goal) { res.status(404).json({ error: 'not_found' }); return; }
    const before = goal.keyResults.length;
    goal.keyResults = goal.keyResults.filter((k) => k.id !== req.params.krId);
    if (goal.keyResults.length === before) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const done = goal.keyResults.filter((k) => k.done).length;
    goal.progress = goal.keyResults.length > 0 ? done / goal.keyResults.length : 0;
    writeRaw(serializeProgress(parsed));
    emit(broadcast, goal);
    res.status(204).end();
  }));

  // S18 — decompose a goal into tasks (one per key-result).
  // Each task carries metadata.goalId / metadata.krId so progress can
  // flow back the other way (task done -> KR done -> goal progress%).
  router.post('/goals/:id/decompose', wrap(async (req, res) => {
    const parsed = parseProgress(readRaw());
    const goal = parsed.goals.find((g) => g.id === req.params.id);
    if (!goal) { res.status(404).json({ error: 'not_found' }); return; }
    if (!Array.isArray(goal.keyResults) || goal.keyResults.length === 0) {
      res.status(400).json({ error: 'bad_request', message: 'goal has no key results to decompose' });
      return;
    }
    const active = projectsStore.active();
    const projectId = active?.id || 'default';
    const created = [];
    for (const kr of goal.keyResults) {
      if (kr.taskId) continue; // already decomposed
      const task = await tasksStore.create(projectId, {
        title: kr.title,
        description: `Auto-created from goal "${goal.title}"`,
        priority: 'normal',
        assignee: kr.assignee || null,
        dueDate: goal.due || null,
        metadata: { goalId: goal.id, goalTitle: goal.title, krId: kr.id, krTitle: kr.title },
      });
      kr.taskId = task.id;
      created.push({ kr: kr.id, task: task.id });
    }
    writeRaw(serializeProgress(parsed));
    emit(broadcast, goal);
    res.status(201).json({ goalId: goal.id, created });
  }));

  // S18 — reverse-sync: task status changes propagate to the linked KR
  // and recompute the goal's progress%. Called by the tasks router when
  // a task with metadata.goalId moves to 'done'.
  router.post('/goals/:id/sync-from-tasks', wrap(async (req, res) => {
    const parsed = parseProgress(readRaw());
    const goal = parsed.goals.find((g) => g.id === req.params.id);
    if (!goal) { res.status(404).json({ error: 'not_found' }); return; }
    const active = projectsStore.active();
    const projectId = active?.id || 'default';
    let changed = false;
    for (const kr of goal.keyResults) {
      if (!kr.taskId) continue;
      const task = await tasksStore.getById(projectId, kr.taskId);
      if (!task) continue;
      const isDone = task.status === 'done';
      if (Boolean(kr.done) !== isDone) {
        kr.done = isDone;
        changed = true;
      }
    }
    const done = goal.keyResults.filter((k) => k.done).length;
    const newProgress = goal.keyResults.length > 0 ? done / goal.keyResults.length : 0;
    if (newProgress !== goal.progress) {
      goal.progress = newProgress;
      changed = true;
    }
    if (changed) {
      writeRaw(serializeProgress(parsed));
      emit(broadcast, goal);
    }
    res.json({ goal, changed });
  }));
  // PROGRESS.md, including its key-results. Returns 204.
  router.delete('/goals/:id', wrap(async (req, res) => {
    const parsed = parseProgress(readRaw());
    const idx = parsed.goals.findIndex((g) => g.id === req.params.id);
    if (idx === -1) { res.status(404).json({ error: 'not_found' }); return; }
    const [removed] = parsed.goals.splice(idx, 1);
    writeRaw(serializeProgress(parsed));
    if (typeof broadcast === 'function') {
      broadcast({ type: 'goals:removed', id: removed.id });
      // Also notify any listener that the goal list changed; the
      // client removes the card locally + re-fetches on next mount.
      broadcast({ type: 'goals:change', goal: { id: removed.id, removed: true } });
    }
    res.status(204).end();
  }));

  // Start the PROGRESS.md watcher so edits from CC's `/goal` slash
  // command (which writes the file directly) push live updates. Cheap
  // no-op when PROGRESS.md doesn't exist yet.
  startProgressWatcher(broadcast);

  return router;
}

/**
 * S18 — recompute KR done flags + goal progress% from a task status
 * change. Called by the tasks router when a goal-linked task moves.
 * Returns true if anything was persisted, false if no change.
 */
export function syncGoalFromTask(
  goalId, krId, taskDone, broadcast
) {
  const parsed = parseProgress(readRaw());
  const goal = parsed.goals.find((g) => g.id === goalId);
  if (!goal) return false;
  const kr = Array.isArray(goal.keyResults)
    ? goal.keyResults.find((k) => k.id === krId)
    : null;
  if (kr && Boolean(kr.done) !== taskDone) kr.done = taskDone;
  const doneCount = goal.keyResults.filter((k) => k.done).length;
  const newProgress = goal.keyResults.length > 0 ? doneCount / goal.keyResults.length : 0;
  if (
    newProgress !== goal.progress ||
    (kr && kr.done !== taskDone)
  ) {
    goal.progress = newProgress;
    writeRaw(serializeProgress(parsed));
    emit(broadcast, goal);
    return true;
  }
  return false;
}

export const _internals = { progressPath, readRaw, writeRaw, VALID_STATUSES, syncGoalFromTask };