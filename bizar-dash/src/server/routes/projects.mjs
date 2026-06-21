/**
 * src/server/routes/projects.mjs
 *
 * /api/projects                           — list
 * /api/projects  (POST)                   — add by path
 * /api/projects/:id/activate (POST)       — set active
 * /api/projects/:id (DELETE)              — remove
 * /api/projects/refresh (POST)            — re-scan projects.json
 * /api/projects/auto-detect (POST)        — auto-add the server's cwd
 * /api/projects/active/tasks              — tasks for the active project
 * /api/projects/active/schedules          — schedules for the active project
 * /api/projects/active/mods               — mods for the active project
 * /api/projects/active/state              — state.json for the active project
 */
import { Router } from 'express';
import { join } from 'node:path';
import { projectsStore } from '../projects-store.mjs';
import { tasksStore } from '../tasks-store.mjs';
import { schedulesStore } from '../schedules-store.mjs';
import { readActiveProjectId, safeReadJSON, wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @param {string} deps.projectRoot
 * @returns {import('express').Router}
 */
export function createProjectsRouter({ state, broadcast, projectRoot }) {
  const router = Router();

  router.get('/projects', wrap(async (_req, res) => {
    res.json(projectsStore.list());
  }));

  router.post('/projects', wrap(async (req, res) => {
    const path = (req.body?.path || '').trim();
    const name = req.body?.name || null;
    if (!path) {
      res.status(400).json({ error: 'bad_request', message: 'path is required' });
      return;
    }
    const project = projectsStore.add(path, name);
    state.appendActivity({ kind: 'project.add', id: project.id, path: project.path });
    res.status(201).json(project);
  }));

  router.post('/projects/:id/activate', wrap(async (req, res) => {
    const activated = projectsStore.activate(req.params.id);
    if (!activated) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    state.appendActivity({ kind: 'project.activate', id: activated.id });
    broadcast({ type: 'project:change', project: activated });
    res.json(activated);
  }));

  router.delete('/projects/:id', wrap(async (req, res) => {
    projectsStore.remove(req.params.id);
    broadcast({ type: 'project:change' });
    res.status(204).end();
  }));

  router.post('/projects/refresh', wrap(async (_req, res) => {
    res.json(projectsStore.list());
  }));

  // v3.0.4 — Manual auto-detect trigger for the "Use current directory"
  // button on the Overview. Auto-detects the server's `projectRoot` and
  // returns the (possibly updated) registry. Idempotent.
  router.post('/projects/auto-detect', wrap(async (_req, res) => {
    const detected = projectsStore.autoDetect({ cwd: projectRoot });
    if (detected) {
      state.appendActivity({ kind: 'project.auto-detect', id: detected.id, path: detected.path });
      broadcast({ type: 'project:change', project: detected });
    }
    res.json(projectsStore.list());
  }));

  // ── /api/projects/active/<entity> ──────────────────────────────────────
  router.get('/projects/active/tasks', wrap(async (_req, res) => {
    const active = projectsStore.active();
    if (!active) {
      res.json({ tasks: [], projectId: null });
      return;
    }
    res.json({ tasks: tasksStore.loadTasks(active.id), projectId: active.id });
  }));

  router.get('/projects/active/schedules', wrap(async (_req, res) => {
    const active = projectsStore.active();
    if (!active) {
      res.json({ schedules: [], projectId: null });
      return;
    }
    res.json({ schedules: schedulesStore.list(active.id), projectId: active.id });
  }));

  router.get('/projects/active/mods', wrap(async (_req, res) => {
    const active = projectsStore.active();
    if (!active) {
      res.json({ mods: [], projectId: null });
      return;
    }
    res.json({ mods: [], projectId: active.id });
  }));

  router.get('/projects/active/state', wrap(async (_req, res) => {
    const active = projectsStore.active();
    if (!active) {
      res.json({ state: {}, projectId: null });
      return;
    }
    const stateFile = join(projectsStore.projectDir(active.id), 'state.json');
    res.json({ state: safeReadJSON(stateFile, {}) || {}, projectId: active.id });
  }));

  return router;
}