/**
 * src/server/routes-v2/health.mjs
 *
 * v0.7.0-alpha.1 — Public health endpoint (no auth required).
 */

import express from 'express';

export function createV2HealthRouter({ version, startedAt }) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
      version,
    });
  });

  return router;
}
