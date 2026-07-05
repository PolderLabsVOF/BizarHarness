/**
 * src/server/routes/schedules.mjs
 *
 * /api/schedules                          — list
 * /api/schedules (POST)                   — add
 * /api/schedules/:id (PUT)                — full update
 * /api/schedules/:id (PATCH)              — partial update (toggle fields)
 * /api/schedules/:id/run (POST)           — run once now
 * /api/schedules/:id/trigger (POST)       — alias for /run (mobile uses this)
 * /api/schedules/:id (DELETE)             — remove
 *
 * PATCH exists because the desktop UI's "toggle enabled" and the mobile
 * UI's edit flow both want to send partial payloads without losing the
 * rest of the schedule.
 */
import { Router } from 'express';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schedulesStore } from '../schedules-store.mjs';
import { schedulesRunner } from '../schedules-runner.mjs';
import { readActiveProjectId, wrap } from './_shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', '..', '..', 'templates', 'schedules');

/**
 * Load all schedule templates from templates/schedules/.
 * Each template gets `source: 'template'` and `templateFile` added.
 * Missing directory returns an empty array.
 */
function loadTemplates() {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const content = JSON.parse(readFileSync(join(TEMPLATES_DIR, f), 'utf8'));
      return { ...content, source: 'template', templateFile: f };
    });
}

/**
 * @param {object} deps
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createSchedulesRouter({ broadcast }) {
  const router = Router();

  router.get('/schedules', wrap(async (req, res) => {
    const projectId = req.query.projectId || readActiveProjectId();
    res.json(schedulesStore.list(projectId || 'default'));
  }));

  router.post('/schedules', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId() || 'default';
    const sched = schedulesStore.add(projectId, req.body || {});
    broadcast({ type: 'schedules:change' });
    res.status(201).json(sched);
  }));

  router.put('/schedules/:id', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId() || 'default';
    const sched = schedulesStore.update(projectId, req.params.id, req.body || {});
    if (!sched) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'schedules:change' });
    res.json(sched);
  }));

  // v3.9.0 — Partial update. The mobile UI PATCHes a single field at a
  // time (toggle enabled, rename, etc.) so a PUT that required the full
  // shape was impractical. PATCH is semantically correct here.
  router.patch('/schedules/:id', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId() || 'default';
    const sched = schedulesStore.update(projectId, req.params.id, req.body || {});
    if (!sched) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'schedules:change' });
    res.json(sched);
  }));

  router.post('/schedules/:id/run', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId() || 'default';
    const sched = schedulesStore.get(projectId, req.params.id);
    if (!sched) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const result = await schedulesRunner.runOne(projectId, sched);
    broadcast({ type: 'schedules:change' });
    res.json(result);
  }));

  // v3.9.0 — Mobile uses /trigger; keep it as an alias of /run so
  // desktop and mobile share the same handler.
  router.post('/schedules/:id/trigger', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId() || 'default';
    const sched = schedulesStore.get(projectId, req.params.id);
    if (!sched) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const result = await schedulesRunner.runOne(projectId, sched);
    broadcast({ type: 'schedules:change' });
    res.json(result);
  }));

  router.delete('/schedules/:id', wrap(async (req, res) => {
    const projectId = req.query.projectId || readActiveProjectId() || 'default';
    const ok = schedulesStore.remove(projectId, req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'schedules:change' });
    res.status(204).end();
  }));

  // GET /api/schedules/templates → { templates: [...] }
  router.get('/schedules/templates', wrap(async (_req, res) => {
    res.json({ templates: loadTemplates() });
  }));

  // POST /api/schedules/from-template → creates a schedule from a template
  router.post('/schedules/from-template', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId() || 'default';
    const { templateId, name: customName } = req.body || {};
    if (!templateId) {
      res.status(400).json({ error: 'templateId is required' });
      return;
    }
    const templates = loadTemplates();
    const template = templates.find((t) => t.id === templateId);
    if (!template) {
      res.status(404).json({ error: 'template not found' });
      return;
    }
    // Build a schedule payload from the template, allowing name override
    const schedulePayload = {
      name: customName || template.name,
      type: template.type,
      schedule: template.schedule,
      timezone: template.timezone || 'UTC',
      action: template.action,
      budgetCheck: template.budgetCheck,
      enabled: true,
    };
    const sched = schedulesStore.add(projectId, schedulePayload);
    broadcast({ type: 'schedules:change' });
    res.status(201).json(sched);
  }));

  return router;
}