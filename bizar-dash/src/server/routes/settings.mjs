/**
 * src/server/routes/settings.mjs
 *
 * /api/settings                          — read settings.json
 * /api/settings (PUT)                    — write (merged with defaults)
 * /api/settings/reset (POST)             — reset to defaults
 */
import { Router } from 'express';
import { DEFAULT_SETTINGS, readSettings, writeSettings, wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createSettingsRouter({ state, broadcast }) {
  const router = Router();

  router.get('/settings', wrap(async (_req, res) => {
    res.json(readSettings());
  }));

  router.put('/settings', wrap(async (req, res) => {
    const updated = writeSettings(req.body || {});
    state.appendActivity({ kind: 'settings.update' });
    broadcast({ type: 'settings:change', settings: updated.data });
    res.json(updated);
  }));

  router.post('/settings/reset', wrap(async (_req, res) => {
    const updated = writeSettings(DEFAULT_SETTINGS);
    broadcast({ type: 'settings:change', settings: updated.data });
    res.json(updated);
  }));

  return router;
}