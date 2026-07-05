/**
 * src/server/routes/tailscale.mjs
 *
 * v5.2 — Tailscale auth key integration endpoints.
 *
 * Endpoints:
 *   GET  /api/tailscale/status   — tailscale state (installed, authenticated, serve config)
 *   POST /api/tailscale/setup    — authenticate + set up tailscale serve
 *   POST /api/tailscale/unserve — remove tailscale serve
 */
import { Router } from 'express';
import { tailscaleStore } from '../tailscale-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} _deps
 * @returns {import('express').Router}
 */
export function createTailscaleRouter(_deps) {
  const router = Router();

  // GET /api/tailscale/status
  router.get('/status', wrap(async (_req, res) => {
    res.json(await tailscaleStore.status());
  }));

  // POST /api/tailscale/setup — authenticate + enable serve
  // Body: { authKey?: string, port?: number, https?: boolean, hostname?: string }
  router.post('/setup', wrap(async (req, res) => {
    const { authKey, port = 4321, https = true, hostname = '' } = req.body || {};
    // If authKey is provided, set it in env for tailscale-store to pick up
    if (authKey) {
      process.env.TAILSCALE_AUTHKEY = authKey;
    }
    // delegates to tailscaleStore.enable() which runs `tailscale serve ...`
    const result = await tailscaleStore.enable({ port, https, hostname });
    res.json(result);
  }));

  // POST /api/tailscale/unserve — remove tailscale serve
  router.post('/unserve', wrap(async (_req, res) => {
    res.json(await tailscaleStore.disable());
  }));

  return router;
}
