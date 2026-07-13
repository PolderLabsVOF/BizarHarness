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
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { wrap } from './_shared.mjs';
import { projectsStore } from '../projects-store.mjs';
import { parseProgress, serializeProgress } from '../progress-parser.mjs';

const VALID_STATUSES = new Set(['on-track', 'at-risk', 'off-track', 'done', 'blocked', 'active']);
const HOME = homedir();

function progressPath() {
  // PROGRESS.md lives in the project root (v6 contract). Falls back
  // to $HOME so a freshly-cloned dashboard with no active project
  // doesn't 500 — the response is just an empty goal list.
  const active = projectsStore.active();
  const root = active?.cwd ? resolve(active.cwd) : HOME;
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

function broadcast(broadcast, goal) {
  if (typeof broadcast === 'function') {
    broadcast({ type: 'goals:change', goal });
  }
}

/**
 * @param {{ broadcast?: Function }} deps
 */
export function createGoalsRouter({ broadcast } = {}) {
  const router = Router();

  router.get('/goals', wrap(async (_req, res) => {
    const parsed = parseProgress(readRaw());
    res.json({ goals: parsed.goals, count: parsed.goals.length });
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
    goal.status = status;
    writeRaw(serializeProgress(parsed));
    broadcast(broadcast, goal);
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
    broadcast(broadcast, goal);
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
    broadcast(broadcast, goal);
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
    broadcast(broadcast, goal);
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
    broadcast(broadcast, goal);
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
    broadcast(broadcast, goal);
    res.status(204).end();
  }));

  return router;
}

export const _internals = { progressPath, readRaw, writeRaw, VALID_STATUSES };