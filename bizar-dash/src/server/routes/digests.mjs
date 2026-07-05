/**
 * src/server/routes/digests.mjs
 *
 * /api/digests                          — list digests
 * /api/digests/generate (POST)          — generate a digest
 * /api/digests/:path (GET)              — get a specific digest
 * /api/digests/:path (DELETE)           — delete a digest
 *
 * The `:path` parameter is URL-encoded so it survives Express routing.
 */
import { Router } from 'express';
import {
  generateAndSave,
  listDigests,
  getDigest,
  deleteDigest,
} from '../digest-store.mjs';
import { readActiveProjectId, wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} [deps.projectRoot]
 * @returns {import('express').Router}
 */
export function createDigestsRouter({ projectRoot } = {}) {
  const router = Router();

  // GET /api/digests — list all digests
  router.get('/digests', wrap(async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 20;
    const digests = await listDigests({ limit });
    res.json({ digests });
  }));

  // GET /api/digests/:path — get a single digest by path
  // The path is double-encoded: first by the client, then by Express.
  router.get('/digests/*', wrap(async (req, res) => {
    // Reconstruct the path from the wildcard
    const rawPath = req.params[0];
    if (!rawPath) {
      // This catches /api/digests with no trailing path (should be handled
      // by the /digests route above, but Express may match this first if the
      // wildcard is greedy — we handle the list case explicitly).
      const digests = await listDigests({ limit: 20 });
      res.json({ digests });
      return;
    }
    const filePath = decodeURIComponent(rawPath);
    const digest = await getDigest(filePath);
    if (!digest) {
      res.status(404).json({ error: 'not_found', message: 'Digest not found' });
      return;
    }
    res.json(digest);
  }));

  // POST /api/digests/generate — generate a new digest
  router.post('/digests/generate', wrap(async (req, res) => {
    const { weekStart, weekEnd, dryRun } = req.body || {};
    const root = req.body?.projectRoot || projectRoot || process.cwd();
    const result = await generateAndSave({ weekStart, weekEnd, projectRoot: root, dryRun });
    res.status(dryRun ? 200 : 201).json(result);
  }));

  // DELETE /api/digests/* — delete a digest by path
  router.delete('/digests/*', wrap(async (req, res) => {
    const rawPath = req.params[0];
    if (!rawPath) {
      res.status(400).json({ error: 'bad_request', message: 'Digest path required' });
      return;
    }
    const filePath = decodeURIComponent(rawPath);
    const result = await deleteDigest(filePath);
    if (!result.ok) {
      res.status(404).json({ error: 'not_found', message: result.error || 'Digest not found' });
      return;
    }
    res.status(204).end();
  }));

  return router;
}
