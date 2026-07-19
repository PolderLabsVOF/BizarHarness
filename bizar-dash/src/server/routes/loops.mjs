/**
 * src/server/routes/loops.mjs
 *
 * G-autoloop Phase 5 — HTTP surface for the loop runtime.
 *
 * Endpoints (mounted under `/api/loops`):
 *   GET    /api/loops                  — snapshot of all known loops
 *   GET    /api/loops/:id              — single loop state
 *   POST   /api/loops                  — create a new pending loop
 *   PATCH  /api/loops/:id              — patch fields (intervalMs, maxIterations, etc.)
 *   POST   /api/loops/:id/start        — flip status to 'running' (idempotent)
 *   POST   /api/loops/:id/stop         — flip status to 'stopped' (idempotent)
 *   DELETE /api/loops/:id              — delete the state file
 *
 * The actual scheduling (in-process setInterval) happens in
 * `loop-runtime.mjs`. This router owns only the HTTP wiring — keeps
 * the runtime pure + testable.
 *
 * Phase 5 deliberately stops short of dispatching real tasks here.
 * That's wired in a follow-up so we can ship the loop infrastructure
 * (CRUD + scheduler) and let a dedicated route pair it with the real
 * `taskDelegator` + project-store integration.
 */

import { Router } from 'express';
import {
  createLoop,
  readLoop,
  patchLoop,
  deleteLoop,
  listLoops,
  snapshotLoops,
  startLoop,
  stopLoop,
} from '../loop-runtime.mjs';
import { wrap } from './_shared.mjs';

const VALID_PATCH_FIELDS = new Set([
  'name',
  'intervalMs',
  'maxIterations',
  'projectId',
]);

/**
 * @param {Object} deps
 * @param {Function} [deps.broadcast]
 */
export function createLoopsRouter({ broadcast = () => {} } = {}) {
  const router = Router();

  router.get('/loops', wrap(async (req, res) => {
    const snap = snapshotLoops();
    res.json({ loops: Object.values(snap), count: Object.keys(snap).length });
  }));

  router.get('/loops/:id', wrap(async (req, res) => {
    const s = readLoop(req.params.id);
    if (!s) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(s);
  }));

  router.post('/loops', wrap(async (req, res) => {
    const body = req.body || {};
    if (!body.projectId) {
      res.status(400).json({ error: 'bad_request', message: 'projectId required' });
      return;
    }
    const s = createLoop({
      projectId: body.projectId,
      name: body.name,
      intervalMs: body.intervalMs,
      maxIterations: body.maxIterations,
    });
    broadcast({ type: 'loops:change', loop: s });
    res.status(201).json(s);
  }));

  router.patch('/loops/:id', wrap(async (req, res) => {
    const patch = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (VALID_PATCH_FIELDS.has(k)) patch[k] = v;
    }
    const next = patchLoop(req.params.id, patch);
    if (!next) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'loops:change', loop: next });
    res.json(next);
  }));

  // Start a loop. The runtime owns the timer; this just flips state.
  // We re-use `startLoop` from the runtime so the in-process scheduler
  // is the single source of truth. If the caller passed a `dry` flag,
  // we only flip the state without engaging the timer — useful for
  // the dashboard's "arm only" toggle.
  router.post('/loops/:id/start', wrap(async (req, res) => {
    const dry = req.body && req.body.dry === true;
    let next;
    try {
      next = dry ? patchLoop(req.params.id, { status: 'running' }) : startLoop(req.params.id, {});
    } catch (err) {
      res.status(404).json({ error: 'not_found', message: err.message });
      return;
    }
    if (!next) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'loops:change', loop: next });
    res.json(next);
  }));

  router.post('/loops/:id/stop', wrap(async (req, res) => {
    const next = stopLoop(req.params.id);
    if (!next) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'loops:change', loop: next });
    res.json(next);
  }));

  router.delete('/loops/:id', wrap(async (req, res) => {
    // Stop the in-process timer first so it doesn't keep firing on a
    // deleted state.json.
    stopLoop(req.params.id);
    deleteLoop(req.params.id);
    broadcast({ type: 'loops:deleted', loopId: req.params.id });
    res.status(204).end();
  }));

  return router;
}
