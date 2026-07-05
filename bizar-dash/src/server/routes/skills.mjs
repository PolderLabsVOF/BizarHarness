/**
 * src/server/routes/skills.mjs
 *
 * v4.0.0 — Serves locally-scanned SKILL.md files across all sources.
 *
 * Endpoints:
 *   GET  /skills                     — list all skills
 *   GET  /skills/search?q=           — fuzzy search (plain data, no ANSI)
 *   GET  /skills/:source/:name       — single skill detail
 *   POST /skills/refresh             — invalidate cache + rescan
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

  // GET /skills
  router.get('/skills', wrap(async (req, res) => {
    const all = await skillsStore.list();
    // Group counts by source
    const counts = { shipped: 0, user: 0, project: 0 };
    for (const s of all) counts[s.source] = (counts[s.source] || 0) + 1;
    res.json({ skills: all, count: all.length, counts });
  }));

  // GET /skills/search?q=
  router.get('/skills/search', wrap(async (req, res) => {
    const q = (req.query.q || '').toString();
    const results = await skillsStore.search(q);
    // Ensure plain strings — strip any accidental ANSI from CLI output
    const clean = results.map((s) => ({
      name:        s.name,
      description: s.description,
      source:      s.source,
      path:        s.path,
    }));
    res.json({ results: clean, query: q, count: clean.length });
  }));

  // GET /skills/:source/:name
  router.get('/skills/:source/:name', wrap(async (req, res) => {
    const skill = await skillsStore.get(req.params.source, req.params.name);
    if (!skill) {
      res.status(404).json({ error: 'not_found', message: 'skill not found' });
      return;
    }
    res.json(skill);
  }));

  // POST /skills/refresh
  router.post('/skills/refresh', wrap(async (req, res) => {
    const skills = skillsStore.refresh();
    broadcast({ type: 'skills:change' });
    res.json({ ok: true, count: skills.length });
  }));

  return router;
}
