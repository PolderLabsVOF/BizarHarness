/**
 * src/server/routes/artifacts.mjs
 *
 * /api/artifacts                          — list all
 * /api/artifacts/:id                      — metadata
 * /api/artifacts/:id/content              — body (text/html by default)
 * /api/artifacts/:id (DELETE)             — remove
 *
 * NOTE — /api/tasks/:id/artifacts lives in tasks.mjs because the path
 * parameter is the task id, not the artifact id.
 *
 * Express-ordering note: /artifacts (the literal list endpoint) MUST
 * be defined before /artifacts/:id. Express only treats paths as
 * patterns when the segment starts with `:` or `*`, but the list
 * endpoint being literal means it would win the match anyway. We
 * declare it first just to make the ordering intent obvious.
 */
import { Router } from 'express';
import { artifactsStore } from '../artifacts-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createArtifactsRouter({ broadcast }) {
  const router = Router();

  router.get('/artifacts', wrap(async (_req, res) => {
    const items = artifactsStore.list();
    res.json({ artifacts: items });
  }));

  router.get('/artifacts/:id', wrap(async (req, res) => {
    const meta = artifactsStore.get(req.params.id);
    if (!meta) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(meta);
  }));

  router.get('/artifacts/:id/content', wrap(async (req, res) => {
    const result = artifactsStore.read(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    // We respect the stored contentType. Default to text/html so
    // opening the URL in a browser just works.
    res.type(result.meta.contentType || 'text/html').send(result.content);
  }));

  router.delete('/artifacts/:id', wrap(async (req, res) => {
    const ok = artifactsStore.delete(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'artifact:delete', id: req.params.id });
    res.status(204).end();
  }));

  return router;
}