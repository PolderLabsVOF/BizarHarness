/**
 * src/server/routes/misc.mjs
 *
 * Routes that don't fit cleanly into a single domain file. Kept
 * here so we don't inflate the api.mjs composer with one-off
 * routers.
 *
 *   /api/search                            — fuzzy search across projects/tasks/plans/agents
 *   /api/tailscale/status                  — tailscale state
 *   /api/tailscale/enable (POST)           — enable tailscale serve
 *   /api/tailscale/disable (POST)          — disable
 *   /api/updates/status                    — current version
 *   /api/updates/check                     — latest + hasUpdates flag
 *   /api/updates/apply (POST)              — start update (broadcasts progress)
 */
import { Router } from 'express';
import { searchStore } from '../search-store.mjs';
import { tailscaleStore } from '../tailscale-store.mjs';
import { updateStore } from '../update-store.mjs';
import { projectsStore } from '../projects-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createMiscRouter({ state, broadcast }) {
  const router = Router();

  // ── /api/search ────────────────────────────────────────────────────────
  router.get('/search', wrap(async (req, res) => {
    const q = (req.query.q || '').toString();
    const scope = (req.query.scope || 'all').toString();
    const active = projectsStore.active();
    res.json(searchStore.search(q, { activeProjectId: active?.id, scope }));
  }));

  // ── /api/tailscale ─────────────────────────────────────────────────────
  router.get('/tailscale/status', wrap(async (_req, res) => {
    res.json(await tailscaleStore.status());
  }));

  router.post('/tailscale/enable', wrap(async (req, res) => {
    res.json(await tailscaleStore.enable(req.body || {}));
  }));

  router.post('/tailscale/disable', wrap(async (_req, res) => {
    res.json(await tailscaleStore.disable());
  }));

  // ── /api/updates (v3.3.3) ──────────────────────────────────────────
  router.get('/updates/status', wrap(async (_req, res) => {
    res.json({ current: updateStore.current() });
  }));

  router.get('/updates/check', wrap(async (_req, res) => {
    try {
      const current = updateStore.current();
      const latest = await updateStore.latest();
      res.json({
        current,
        latest,
        hasUpdates: updateStore.hasUpdates(current, latest),
      });
    } catch (err) {
      res.status(500).json({ error: 'check_failed', message: err.message });
    }
  }));

  router.post('/updates/apply', async (req, res) => {
    const packages = req.body?.packages || ['bizar', 'bizar-dash', 'bizar-plugin'];
    // Start the update in the background — return immediately so the client
    // can receive progress events over the WebSocket channel.
    updateStore.applyWithProgress({
      packages,
      broadcast,
    }).catch((err) => console.error('[updates] error:', err));
    res.json({ started: true, packages });
  });

  return router;
}