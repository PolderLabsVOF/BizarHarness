/**
 * src/server/api.mjs
 *
 * v3.6.0 — Thin composer for the dashboard REST surface.
 *
 * The previous api.mjs was a 2,395-line monolith; this file now just
 * composes the per-domain routers in routes/*. Each router is created
 * via a factory that receives shared dependencies (state, broadcast,
 * projectRoot, watcher), so they can be developed and tested in
 * isolation.
 *
 * Router order matters for Express — paths registered earlier win
 * the match. Within each router file the ordering constraints are
 * preserved (e.g. /tasks/bulk before /tasks/:id) and the composition
 * below mirrors the original monolith's top-level ordering so that
 * route precedence is unchanged.
 *
 * v3.24.0 — Exception: the memory router is lazy-imported with
 * `await import('./routes/memory.mjs')` below instead of statically
 * listed in the import block. This lets dashboards boot before the
 * memory routes land during a parallel implementation rollout.
 */
import express from 'express';
import { pairStore } from './pair-store.mjs';

import { createAuthRouter } from './routes/auth.mjs';
import { createOverviewRouter } from './routes/overview.mjs';
import { createProjectsRouter } from './routes/projects.mjs';
import { createFsRouter } from './routes/fs.mjs';
import { createTasksRouter } from './routes/tasks.mjs';
import { createArtifactsRouter } from './routes/artifacts.mjs';
import { createSchedulesRouter } from './routes/schedules.mjs';
import { createModsRouter } from './routes/mods.mjs';
import { createAgentsRouter } from './routes/agents.mjs';
import { createBackgroundRouter } from './routes/background.mjs';
import { createActivityRouter } from './routes/activity.mjs';
import { createHistoryRouter } from './routes/history.mjs';
import { createConfigRouter } from './routes/config.mjs';
import { createProvidersRouter } from './routes/providers.mjs';
import { createSettingsRouter } from './routes/settings.mjs';
import { createChatRouter } from './routes/chat.mjs';
import { createOpencodeSessionsRouter } from './routes/opencode-sessions.mjs';
import { createDialogsRouter } from './routes/dialogs.mjs';
import { createSkillsRouter } from './routes/skills.mjs';
import { createObsidianRouter } from './routes/obsidian.mjs';
import { createDiagnosticsRouter } from './routes/diagnostics.mjs';
import { createPairRouter } from './routes/pair.mjs';
import { createThemesRouter } from './routes/themes.mjs';
import { createNotificationsRouter } from './routes/notifications.mjs';
import { createMiscRouter } from './routes/misc.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {object} deps.watcher
 * @param {string} deps.projectRoot
 * @param {string} deps.opencodeConfigDir
 * @param {string} deps.bizarRoot
 * @param {Function} [deps.broadcast]
 * @returns {import('express').Router}
 */
export function createApiRouter({
  state,
  watcher,
  projectRoot,
  opencodeConfigDir,
  bizarRoot,
  broadcast = () => {},
}) {
  const router = express.Router();

  // v3.5.2 — Pair-token enrichment middleware. Does NOT block requests; the
  // dashboard itself is unauthenticated. This just tags requests with
  // req.pairToken / req.pairEntry so future handlers can recognize paired
  // companion clients and (later) scope them to a single project.
  router.use(pairStore.middleware);

  // Compose each domain router in the order the original monolith
  // declared them. Order is mostly cosmetic — Express path patterns
  // don't overlap across domains — but it keeps the route table
  // grep-able by anyone familiar with the original file.
  router.use(createOverviewRouter({ state }));
  router.use(createProjectsRouter({ state, broadcast, projectRoot }));
  // v3.6.0 — Mounted right after projects so the file-browser endpoint
  // is logically grouped with the project-management surface. Reads
  // settings via the shared helper; needs no broadcast/projectRoot.
  router.use(createFsRouter({ state }));
  router.use(createTasksRouter({ state, broadcast, projectRoot }));
  // v3.20.14 — pass projectRoot to the artifacts router so /api/artifacts
  // returns the worktree artifacts (not just the global fallback).
  // Previously this router was mounted without projectRoot, which meant
  // artifactsStore.list(undefined) only checked ~/.config/opencode/artifacts
  // (always empty for projects that have an artifacts/ folder) and the
  // UI showed "0 artifacts" even though the snapshot had the full list.
  router.use(createArtifactsRouter({ state, broadcast, projectRoot }));
  router.use(createSchedulesRouter({ broadcast }));
  router.use(createModsRouter());
  router.use(createAgentsRouter({ state, broadcast }));
  router.use(createBackgroundRouter({ broadcast }));
  router.use(createActivityRouter({ state }));
  router.use(createHistoryRouter({ projectRoot }));
  router.use(createConfigRouter({ state, watcher }));
  router.use(createProvidersRouter());
  router.use(createSettingsRouter({ state, broadcast }));
  router.use(createChatRouter({ state, broadcast }));
  router.use(createOpencodeSessionsRouter());
  router.use(createDialogsRouter({ broadcast }));
  router.use(createSkillsRouter({ broadcast }));
router.use(createObsidianRouter({ projectRoot }));
  // v3.24.0 — Bizar Memory Service (Phase 1). Lazy-imported so that if Thor's
  // memory routes haven't landed yet, the dashboard still boots.
  const { createMemoryRouter } = await import('./routes/memory.mjs');
  router.use(createMemoryRouter({ projectRoot }));
  router.use(createDiagnosticsRouter());
  router.use(createPairRouter({ state, broadcast }));
  router.use(createThemesRouter({ state }));
  router.use(createNotificationsRouter({ broadcast }));
  router.use(createArtifactsRouter({ state, broadcast, projectRoot }));
  router.use(createMiscRouter({ state, broadcast }));

  // /api/auth/* must be reachable WITHOUT the bearer token so a fresh
  // client can probe whether auth is on. server.mjs adds requireAuth()
  // as middleware ABOVE this router, so this is the one path the
  // middleware's skipPaths lets through.
  router.use(createAuthRouter());

  // 404 catch-all for unknown /api paths. Returns the same shape the
  // /api router has always returned so the frontend's error handler
  // doesn't need to know which router rejected the request.
  router.use((req, res) => {
    res.status(404).json({
      error: 'not_found',
      message: `no route for ${req.method} ${req.originalUrl}`,
    });
  });

  return router;
}