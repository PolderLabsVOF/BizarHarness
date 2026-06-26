/**
 * src/server/routes/artifacts.mjs
 *
 * /api/artifacts                              — list
 * /api/artifacts/:slug                        — read
 * /api/artifacts (POST)                       — create
 * /api/artifacts/:slug (PUT)                  — update meta
 * /api/artifacts/:slug (DELETE)               — remove
 * /api/artifacts/:slug/canvas (GET)           — read canvas
 * /api/artifacts/:slug/canvas (PUT)           — save canvas
 * /api/artifacts/:slug/elements (POST)        — add element
 * /api/artifacts/:slug/elements/:id (PUT)     — update element
 * /api/artifacts/:slug/elements/:id (DELETE)  — remove element
 * /api/artifacts/:slug/position (PUT)         — bulk position update
 * /api/artifacts/:slug/connections (POST)     — add connection
 * /api/artifacts/:slug/connections/:id (DELETE) — remove connection
 * /api/artifacts/:slug/elements/:id/comments (POST) — comment on element
 * /api/artifacts/:slug/elements/:id/comments/:cid (DELETE) — remove element comment
 * /api/artifacts/:slug/comments (POST)        — canvas-level comment
 * /api/artifacts/:slug/comments/:cid (DELETE) — remove canvas-level comment
 * /api/artifacts/:slug/questions/:qid/respond (POST) — agent answers a question element
 */
import { Router } from 'express';
import { artifactsStore } from '../artifacts-store.mjs';
import { notificationsStore } from '../notifications-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @param {string} deps.projectRoot
 * @returns {import('express').Router}
 */
export function createArtifactsRouter({ state, broadcast, projectRoot }) {
  const router = Router();

  router.get('/artifacts', wrap(async (_req, res) => {
    res.json({ artifacts: artifactsStore.list(projectRoot) });
  }));

  router.get('/artifacts/:slug', wrap(async (req, res) => {
    const artifact = artifactsStore.get(req.params.slug, projectRoot);
    if (!artifact) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(artifact);
  }));

  // v3.1.0 — Full artifact CRUD + canvas editing.
  router.post('/artifacts', wrap(async (req, res) => {
    const slug = (req.body?.slug || '').trim();
    try {
      const artifact = artifactsStore.create(slug, req.body || {}, projectRoot);
      broadcast({ type: 'artifact:change', slug });
      res.status(201).json(artifact);
    } catch (err) {
      res.status(err.status || 500).json({ error: 'create_failed', message: err.message });
    }
  }));

  router.put('/artifacts/:slug', wrap(async (req, res) => {
    const artifact = artifactsStore.updateMeta(req.params.slug, req.body || {}, projectRoot);
    if (!artifact) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.json(artifact);
  }));

  router.delete('/artifacts/:slug', wrap(async (req, res) => {
    const ok = artifactsStore.delete(req.params.slug, projectRoot);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug, deleted: true });
    res.status(204).end();
  }));

  // ── /api/artifacts/:slug/canvas ──────────────────────────────────────────
  router.get('/artifacts/:slug/canvas', wrap(async (req, res) => {
    const canvas = artifactsStore.getCanvas(req.params.slug, projectRoot);
    if (!canvas) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ canvas });
  }));

  router.put('/artifacts/:slug/canvas', wrap(async (req, res) => {
    const artifact = artifactsStore.saveCanvas(req.params.slug, req.body?.canvas, projectRoot);
    if (!artifact) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.json(artifact);
  }));

  // ── /api/artifacts/:slug/elements ────────────────────────────────────────
  router.post('/artifacts/:slug/elements', wrap(async (req, res) => {
    const out = artifactsStore.addElement(req.params.slug, req.body || {}, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.status(201).json(out);
  }));

  router.put('/artifacts/:slug/elements/:id', wrap(async (req, res) => {
    const out = artifactsStore.updateElement(req.params.slug, req.params.id, req.body || {}, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.json(out);
  }));

  router.delete('/artifacts/:slug/elements/:id', wrap(async (req, res) => {
    const out = artifactsStore.deleteElement(req.params.slug, req.params.id, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.status(204).end();
  }));

  // ── /api/artifacts/:slug/position — bulk update positions (drag end) ─────
  router.put('/artifacts/:slug/position', wrap(async (req, res) => {
    const out = artifactsStore.updatePositions(req.params.slug, req.body?.positions, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.json(out);
  }));

  // ── /api/artifacts/:slug/connections ─────────────────────────────────────
  router.post('/artifacts/:slug/connections', wrap(async (req, res) => {
    const out = artifactsStore.addConnection(req.params.slug, req.body || {}, projectRoot);
    if (!out) {
      res.status(400).json({ error: 'bad_request', message: 'from and to are required' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.status(201).json(out);
  }));

  router.delete('/artifacts/:slug/connections/:id', wrap(async (req, res) => {
    const out = artifactsStore.deleteConnection(req.params.slug, req.params.id, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.status(204).end();
  }));

  // ── /api/artifacts/:slug/elements/:id/comments ───────────────────────────
  router.post('/artifacts/:slug/elements/:id/comments', wrap(async (req, res) => {
    const out = artifactsStore.addComment(req.params.slug, req.params.id, req.body || {}, projectRoot);
    if (!out) {
      res.status(400).json({ error: 'bad_request', message: 'comment text is required' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.status(201).json(out);
  }));

  router.delete('/artifacts/:slug/elements/:id/comments/:cid', wrap(async (req, res) => {
    const out = artifactsStore.deleteComment(req.params.slug, req.params.cid, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.status(204).end();
  }));

  // Canvas-level comments (no elementId) — POST /artifacts/:slug/comments
  router.post('/artifacts/:slug/comments', wrap(async (req, res) => {
    const out = artifactsStore.addComment(req.params.slug, null, req.body || {}, projectRoot);
    if (!out) {
      res.status(400).json({ error: 'bad_request', message: 'comment text is required' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.status(201).json(out);
  }));

  router.delete('/artifacts/:slug/comments/:cid', wrap(async (req, res) => {
    const out = artifactsStore.deleteComment(req.params.slug, req.params.cid, projectRoot);
    if (!out) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.status(204).end();
  }));

  // ── /api/artifacts/:slug/questions/:qid/respond (v3.3.0) ──────────────
  // Agent-side integration for the question element: an agent posts
  // a question via the artifact's canvas; the user clicks a choice in
  // the dashboard, this endpoint records the choice, marks the
  // question resolved, and broadcasts the answer so the agent
  // (when its plugin is updated) can pick it up.
  router.post('/artifacts/:slug/questions/:qid/respond', wrap(async (req, res) => {
    const { choiceId, text } = req.body || {};
    const out = artifactsStore.respondToQuestion(
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
        source: 'artifact',
        title: `Artifact: ${req.params.slug}`,
        message: `Question answered: choice=${choiceId || 'freeform'}`,
        link: `/artifacts/${req.params.slug}`,
        meta: { slug: req.params.slug, qid: req.params.qid, choiceId, text },
      }, { broadcast });
    } catch { /* best-effort */ }
    broadcast({ type: 'artifact:change', slug: req.params.slug });
    res.json(out);
  }));

  return router;
}