/**
 * src/server/routes/skills.mjs
 *
 * /api/skills                           — list (?category=foo to filter)
 * /api/skills/search                    — fuzzy search by name/description
 * /api/skills/install (POST)            — install by name or source URL
 * /api/skills/:id/disable (POST)        — disable
 * /api/skills/:id/enable (POST)         — enable
 */
import { Router } from 'express';
import { skillsStore } from '../skills-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createSkillsRouter({ broadcast }) {
  const router = Router();

  // v3.3.0 — `?category=foo` filters the list server-side. The
  // frontend uses this to power the collapsible categories view
  // (the old "all in one list" mode is now the default "Show all"
  // toggle in the UI).
  router.get('/skills', wrap(async (req, res) => {
    const skills = await skillsStore.list();
    let out = skills;
    if (req.query.category) {
      const wanted = String(req.query.category).toLowerCase();
      if (wanted !== 'all') {
        out = skills.filter((s) => (s.category || '').toLowerCase() === wanted);
      }
    }
    res.json({ skills: out, categories: skillsStore.CATEGORIES, total: skills.length });
  }));

  router.get('/skills/search', wrap(async (req, res) => {
    const q = (req.query.q || '').toString();
    const results = await skillsStore.search(q);
    res.json({ results, query: q, categories: skillsStore.CATEGORIES });
  }));

  router.post('/skills/install', wrap(async (req, res) => {
    const { name, source } = req.body || {};
    if (!name && !source) {
      res.status(400).json({ error: 'bad_request', message: 'name or source is required' });
      return;
    }
    try {
      const result = await skillsStore.install(name, source);
      broadcast({ type: 'skills:change' });
      res.status(202).json(result);
    } catch (err) {
      res.status(500).json({ error: 'install_failed', message: err.message });
    }
  }));

  router.post('/skills/:id/disable', wrap(async (req, res) => {
    const out = skillsStore.disable(req.params.id);
    broadcast({ type: 'skills:change' });
    res.json(out);
  }));

  router.post('/skills/:id/enable', wrap(async (req, res) => {
    const out = skillsStore.enable(req.params.id);
    broadcast({ type: 'skills:change' });
    res.json(out);
  }));

  return router;
}