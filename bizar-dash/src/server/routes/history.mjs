/**
 * src/server/routes/history.mjs
 *
 * /api/history                           — cross-project timeline
 *
 * Aggregates activity log events with per-project task / plan counts.
 * Supports ?since=<iso> date filtering. Used by the History view.
 */
import { Router } from 'express';
import { tasksStore } from '../tasks-store.mjs';
import { plansStore } from '../plans-store.mjs';
import { projectsStore } from '../projects-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {string} deps.projectRoot
 * @returns {import('express').Router}
 */
export function createHistoryRouter({ projectRoot }) {
  const router = Router();

  router.get('/history', wrap(async (req, res) => {
    const { activityLog } = await import('../activity-log.mjs');
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit || '500', 10) || 500));
    const sinceStr = req.query.since ? String(req.query.since) : null;
    const since = sinceStr ? new Date(sinceStr).getTime() : null;
    const events = activityLog.recent(limit)
      .filter((e) => {
        if (!since) return true;
        const t = new Date(e.ts).getTime();
        return Number.isFinite(t) && t >= since;
      })
      .reverse(); // oldest-first for timeline display

    // Per-project rollups
    const projectTasks = {};
    const projectPlans = {};
    // projectsStore.list() returns { projects, active }, not a bare
    // array. Pull .projects off before iterating. (Bug carried over
    // from the original api.mjs — fixed here while splitting.)
    const projects = projectsStore.list().projects || [];
    for (const p of projects) {
      try {
        const tasks = tasksStore.loadTasks(p.id);
        projectTasks[p.id] = {
          total: tasks.length,
          done: tasks.filter((t) => t.status === 'done').length,
          doing: tasks.filter((t) => t.status === 'doing').length,
          blocked: tasks.filter((t) => t.status === 'blocked').length,
          queued: tasks.filter((t) => t.status === 'queued').length,
        };
      } catch {
        projectTasks[p.id] = { total: 0, done: 0, doing: 0, blocked: 0, queued: 0 };
      }
    }
    try {
      const plans = plansStore.list(projectRoot);
      for (const plan of plans) {
        const pid = plan.projectId || 'global';
        projectPlans[pid] = (projectPlans[pid] || 0) + 1;
      }
    } catch { /* best-effort */ }

    res.json({
      events,
      projects: projects.map((p) => ({
        ...p,
        tasks: projectTasks[p.id] || { total: 0, done: 0, doing: 0, blocked: 0, queued: 0 },
        plans: projectPlans[p.id] || 0,
      })),
      stats: activityLog.stats(),
      generatedAt: new Date().toISOString(),
    });
  }));

  return router;
}