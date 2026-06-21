/**
 * src/server/routes/plans.mjs
 *
 * /api/plans                              — list
 * /api/plans/:slug                        — read
 * /api/plans (POST)                       — create
 * /api/plans/:slug (PUT)                  — update meta
 * /api/plans/:slug (DELETE)               — remove
 * /api/plans/:slug/canvas (GET)           — read canvas
 * /api/plans/:slug/canvas (PUT)           — save canvas
 * /api/plans/:slug/elements (POST)        — add element
 * /api/plans/:slug/elements/:id (PUT)     — update element
 * /api/plans/:slug/elements/:id (DELETE)  — remove element
 * /api/plans/:slug/position (PUT)         — bulk position update
 * /api/plans/:slug/connections (POST)     — add connection
 * /api/plans/:slug/connections/:id (DELETE) — remove connection
 * /api/plans/:slug/elements/:id/comments (POST) — comment on element
 * /api/plans/:slug/elements/:id/comments/:cid (DELETE) — remove element comment
 * /api/plans/:slug/comments (POST)        — canvas-level comment
 * /api/plans/:slug/comments/:cid (DELETE) — remove canvas-level comment
 * /api/plans/:slug/questions/:qid/respond (POST) — agent answers a question element
 */
import { Router } from 'express';
import { plansStore } from '../plans-store.mjs';
import { notificationsStore } from '../notifications-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @param {string} deps.projectRoot
 * @returns {import('express').Router}
 */
export function createPlansRouter({ state, broadcast, projectRoot }) {
  const router = Router();

  router.get('/plans', wrap(async (_req, res) => {
    res.json({ plans: plansStore.list(projectRoot) });
  }));

  router.get('/plans/:slug', wrap(async (req, res) => {
    const plan = plansStore.get(req.params.slug, projectRoot);
    if (!plan) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(plan);
  }));

  // v3.1.0 — Full plan CRUD + canvas editing.
  router.post('/plans', wrap(async (req, res) => {
    const slug = (req.body?.slug || '').trim();
    try {
      const plan = plansStore.create(slug, req.body || {}, projectRoot);
      broadcast({ type: 'plan:change', slug });
      res.status(201).json(plan);
    } catch (err) {
      res.status(err.status || 500).json({ error: 'create_failed', message: err.message });
    }
  }));

  router.put('/plans/:slug', wrap(async (req, res) => {
    const plan = plansStore.updateMeta(req.params.slug, req.body || {}, projectRoot);
    if (!plan) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.json(plan);
  }));

  router.delete('/plans/:slug', wrap(async (req, res) => {
    const ok = plansStore.delete(req.params.slug, projectRoot);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug, deleted: true });
    res.status(204).end();
  }));

  // ── /api/plans/:slug/canvas ──────────────────────────────────────────
  router.get('/plans/:slug/canvas', wrap(async (req, res) => {
    const canvas = plansStore.getCanvas(req.params.slug, projectRoot);
    if (!canvas) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ canvas });
  }));

  router.put('/plans/:slug/canvas', wrap(async (req, res) => {
    const plan = plansStore.saveCanvas(req.params.slug, req.body?.canvas, projectRoot);
    if (!plan) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.json(plan);
  }));

  // ── /api/plans/:slug/elements ────────────────────────────────────────
  router.post('/plans/:slug/elements', wrap(async (req, res) => {
    const out = plansStore.addElement(req.params.slug, req.body || {}, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(201).json(out);
  }));

  router.put('/plans/:slug/elements/:id', wrap(async (req, res) => {
    const out = plansStore.updateElement(req.params.slug, req.params.id, req.body || {}, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.json(out);
  }));

  router.delete('/plans/:slug/elements/:id', wrap(async (req, res) => {
    const out = plansStore.deleteElement(req.params.slug, req.params.id, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(204).end();
  }));

  // ── /api/plans/:slug/position — bulk update positions (drag end) ─────
  router.put('/plans/:slug/position', wrap(async (req, res) => {
    const out = plansStore.updatePositions(req.params.slug, req.body?.positions, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.json(out);
  }));

  // ── /api/plans/:slug/connections ─────────────────────────────────────
  router.post('/plans/:slug/connections', wrap(async (req, res) => {
    const out = plansStore.addConnection(req.params.slug, req.body || {}, projectRoot);
    if (!out) {
      res.status(400).json({ error: 'bad_request', message: 'from and to are required' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(201).json(out);
  }));

  router.delete('/plans/:slug/connections/:id', wrap(async (req, res) => {
    const out = plansStore.deleteConnection(req.params.slug, req.params.id, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(204).end();
  }));

  // ── /api/plans/:slug/elements/:id/comments ───────────────────────────
  router.post('/plans/:slug/elements/:id/comments', wrap(async (req, res) => {
    const out = plansStore.addComment(req.params.slug, req.params.id, req.body || {}, projectRoot);
    if (!out) {
      res.status(400).json({ error: 'bad_request', message: 'comment text is required' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(201).json(out);
  }));

  router.delete('/plans/:slug/elements/:id/comments/:cid', wrap(async (req, res) => {
    const out = plansStore.deleteComment(req.params.slug, req.params.cid, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(204).end();
  }));

  // Canvas-level comments (no elementId) — POST /plans/:slug/comments
  router.post('/plans/:slug/comments', wrap(async (req, res) => {
    const out = plansStore.addComment(req.params.slug, null, req.body || {}, projectRoot);
    if (!out) {
      res.status(400).json({ error: 'bad_request', message: 'comment text is required' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(201).json(out);
  }));

  router.delete('/plans/:slug/comments/:cid', wrap(async (req, res) => {
    const out = plansStore.deleteComment(req.params.slug, req.params.cid, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.status(204).end();
  }));

  // ── /api/plans/:slug/questions/:qid/respond (v3.3.0) ──────────────
  // Agent-side integration for the question element: an agent posts
  // a question via the plan's canvas; the user clicks a choice in
  // the dashboard, this endpoint records the choice, marks the
  // question resolved, and broadcasts the answer so the agent
  // (when its plugin is updated) can pick it up.
  router.post('/plans/:slug/questions/:qid/respond', wrap(async (req, res) => {
    const { choiceId, text } = req.body || {};
    const out = plansStore.respondToQuestion(
      req.params.slug,
      req.params.qid,
      { choiceId, text },
      projectRoot,
    );
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    // Also drop a notification so the agent can re-poll.
    try {
      notificationsStore.add({
        severity: 'info',
        source: 'plan',
        title: `Plan: ${req.params.slug}`,
        message: `Question answered: choice=${choiceId || 'freeform'}`,
        link: `/plans/${req.params.slug}`,
        meta: { slug: req.params.slug, qid: req.params.qid, choiceId, text },
      }, { broadcast });
    } catch { /* best-effort */ }
    broadcast({ type: 'plan:change', slug: req.params.slug });
    res.json(out);
  }));

  return router;
}