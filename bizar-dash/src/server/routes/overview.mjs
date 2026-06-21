/**
 * src/server/routes/overview.mjs
 *
 * /api/snapshot                          — full snapshot (everything the Overview card needs)
 * /api/overview                          — overview-only
 * /api/health                            — { ok: true, ts }
 * /api/restart (POST)                    — self-respawn
 */
import { Router } from 'express';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { projectsStore } from '../projects-store.mjs';
import { tasksStore } from '../tasks-store.mjs';
import { agentsStore } from '../agents-store.mjs';
import { schedulesStore } from '../schedules-store.mjs';
import { providersStore, mcpsStore } from '../providers-store.mjs';
import { modsLoader } from '../mods-loader.mjs';
import {
  OPENCODE_JSON,
  readSettings,
  safeReadJSON,
  wrap,
} from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @returns {import('express').Router}
 */
export function createOverviewRouter({ state }) {
  const router = Router();

  router.get('/snapshot', wrap(async (_req, res) => {
    res.json(buildSnapshot());
  }));

  router.get('/overview', wrap(async (_req, res) => {
    res.json(state.getOverview());
  }));

  router.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // v3.5.3 — Self-respawn: starts a new dashboard process in the
  // background and exits this one. The BIZAR_AUTO_RESPAWN=1 env var
  // marks it as an automated restart (vs a user-initiated one).
  router.post('/restart', (req, res) => {
    res.json({ restarting: true });
    setTimeout(() => {
      const child = spawn(
        process.execPath,
        [process.argv[1], ...process.argv.slice(2)],
        {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, BIZAR_AUTO_RESPAWN: '1' },
        },
      );
      child.unref();
      process.exit(0);
    }, 500);
  });

  function buildSnapshot() {
    const cfg = safeReadJSON(OPENCODE_JSON, null);
    const active = projectsStore.active();
    return {
      overview: state.getOverview(),
      agents: agentsStore.list(),
      plans: state.getPlans(),
      projects: projectsStore.list().projects,
      activeProject: active,
      config: {
        path: OPENCODE_JSON,
        data: cfg,
        raw: cfg === null ? '' : JSON.stringify(cfg, null, 2),
        exists: existsSync(OPENCODE_JSON),
      },
      settings: readSettings(),
      tasks: active ? tasksStore.loadTasks(active.id) : [],
      mods: modsLoader.list(),
      schedules: active ? schedulesStore.list(active.id) : [],
      providers: providersStore.list(),
      mcps: mcpsStore.list(),
    };
  }

  return router;
}