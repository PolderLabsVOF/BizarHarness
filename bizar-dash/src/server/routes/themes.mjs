/**
 * src/server/routes/themes.mjs
 *
 * /api/themes                           — list saved themes
 * /api/themes (POST)                    — add a named theme
 * /api/themes/:name (DELETE)            — remove
 *
 * Themes live on the state object (not disk) — the registry is
 * in-memory. The active theme is on settings.json; the named
 * themes here are the user's saved palette presets.
 */
import { Router } from 'express';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @returns {import('express').Router}
 */
export function createThemesRouter({ state }) {
  const router = Router();

  router.get('/themes', wrap(async (_req, res) => {
    res.json(state.getThemes());
  }));

  router.post('/themes', wrap(async (req, res) => {
    const { name, colors } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'bad_request', message: 'name is required' });
      return;
    }
    if (!colors || typeof colors !== 'object') {
      res.status(400).json({ error: 'bad_request', message: 'colors object is required' });
      return;
    }
    const out = state.addTheme(name.trim().slice(0, 60), colors);
    res.status(201).json(out);
  }));

  router.delete('/themes/:name', wrap(async (req, res) => {
    const out = state.removeTheme(decodeURIComponent(req.params.name));
    if (!out.removed) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  }));

  return router;
}