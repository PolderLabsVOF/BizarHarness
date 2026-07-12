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
import { warn as loggerWarn } from './logger.mjs';

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
import { createClaudeSessionsRouter } from './routes/claude-sessions.mjs';
import { createClaudeSessionDetailRouter } from './routes/claude-session-detail.mjs';
import { createDialogsRouter } from './routes/dialogs.mjs';
import { createSkillsRouter } from './routes/skills.mjs';
import { createObsidianRouter } from './routes/obsidian.mjs';
import { createDiagnosticsRouter } from './routes/diagnostics.mjs';
import { createDoctorRouter } from './routes/doctor.mjs';
import { createPairRouter } from './routes/pair.mjs';
import { createThemesRouter } from './routes/themes.mjs';
import { createNotificationsRouter } from './routes/notifications.mjs';
import { createMinimaxRouter } from './routes/minimax.mjs';
import { createMiscRouter } from './routes/misc.mjs';
import { createEnvVarsRouter } from './routes/env-vars.mjs';
import { createUpdateRouter } from './routes/update.mjs';
import { createUsageRouter } from './routes/usage.mjs';
import { createHeadroomRouter } from './routes/headroom.mjs';
import { createEvalRouter } from './routes/eval.mjs';
import { createWorkspacesRouter } from './routes/workspaces.mjs';
import { createUsersRouter } from './routes/users.mjs';
import { createVoiceRouter } from './routes/voice.mjs';
// v6.4.0 — F-036 Goal Planner UI. POST /api/goal-planner/plan returns
// a GOAP-style A* plan for a plain-English goal.
import { createGoalPlannerRouter } from './routes/goal-planner.mjs';
// v6.6.0 — F-041 Goals & Tasks Board. Replaces the ephemeral
// planner with a persistent Goal store + REST surface (mounted at
// the same /api/goals path so legacy clients don't break). The
// `goal-planner` endpoint stays mounted for any client that still
// wants the raw planner without persistence.
import { createGoalsRouter } from './routes/goals.mjs';
import { attachUserContext } from './auth.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {object} deps.watcher
 * @param {string} deps.projectRoot
 * @param {string} deps.clineConfigDir
 * @param {string} deps.bizarRoot
 * @param {Function} [deps.broadcast]
 * @returns {import('express').Router}
 */
export async function createApiRouter({
  state,
  watcher,
  projectRoot,
  clineConfigDir,
  bizarRoot,
  broadcast = () => {},
}) {
  const router = express.Router();

  // v3.5.2 — Pair-token enrichment middleware. Does NOT block requests; the
  // dashboard itself is unauthenticated. This just tags requests with
  // req.pairToken / req.pairEntry so future handlers can recognize paired
  // companion clients and (later) scope them to a single project.
  router.use(pairStore.middleware);

  // v5.0.0 — User context middleware. Attaches req.userId and req.workspaceId
  // from the bearer token. Runs after requireAuth (applied in server.mjs),
  // so the user is already authenticated at this point.
  router.use(attachUserContext());

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
  // artifactsStore.list(undefined) only checked ~/.config/cline/artifacts
  // (always empty for projects that have an artifacts/ folder) and the
  // UI showed "0 artifacts" even though the snapshot had the full list.
  router.use(createArtifactsRouter({ state, broadcast, projectRoot }));
  router.use(createSchedulesRouter({ broadcast }));
  router.use(createModsRouter());

  // F-040 — Lazy-init the claude-session-watcher on the FIRST call to
  // any /api/agents/* route. We can't start it at module load because
  // api.mjs is composed before the WS broadcast is fully wired; the
  // route middleware chain gets the live `broadcast` reference, so
  // wiring the watcher here is the natural seam.
  await ensureClaudeSessionWatcher({ broadcast });

  router.use(createAgentsRouter({ state, broadcast }));
  router.use(createBackgroundRouter({ broadcast }));
  router.use(createActivityRouter({ state }));
  router.use(createHistoryRouter({ projectRoot }));
  router.use(createConfigRouter({ state, watcher }));
  router.use(createProvidersRouter());
  router.use(createEnvVarsRouter());
  // v4.6.0 — Update endpoints (status / check / apply). Wired with the
  // shared broadcast so apply can stream progress via WS.
  router.use(createUpdateRouter({ broadcast }));
  router.use(createSettingsRouter({ state, broadcast }));
  router.use(createChatRouter({ state, broadcast }));
  router.use(createClaudeSessionsRouter());
  router.use(createClaudeSessionDetailRouter());
  router.use(createDialogsRouter({ broadcast }));
  router.use(createSkillsRouter({ broadcast }));
  router.use(await createObsidianRouter({ projectRoot }));
  // v3.24.0 — Bizar Memory Service (Phase 1). Lazy-imported so that if Thor's
  // memory routes haven't landed yet, the dashboard still boots.
  const { createMemoryRouter } = await import('./routes/memory.mjs');
  router.use(createMemoryRouter({ projectRoot }));
  // v4.6.0 — LightRAG settings endpoints (defaults + status). Lazy-imported
  // so a sibling that owns this file can ship independently.
  const { createLightragRouter } = await import('./routes/lightrag.mjs');
  router.use(createLightragRouter({ projectRoot }));
  // v5.0.0 — Voice notes (record, transcribe, list, delete, stream audio).
  router.use(createVoiceRouter({}));
  router.use(createDiagnosticsRouter());
  // v6.4.0 — F-033 ReasoningBank distillation (ADR-174). Mounted
  // here so the distillation log lives next to the rest of the
  // self-learning surface. Lazy-imported for the same reason as
  // memory.mjs above.
  const { createDistillRouter } = await import('./routes/distill.mjs');
  router.use(createDistillRouter({ projectRoot }));
  // v6.0.0 — Doctor page API. Mounted right after diagnostics so the
  // /doctor/* paths live next to the legacy /diagnostics/* surface
  // they conceptually extend. Each route inside is at its bare path
  // (e.g. '/health'), which becomes '/api/doctor/health' at the top
  // level once /api is prepended by server.mjs.
  router.use('/doctor', createDoctorRouter());
  router.use(createPairRouter({ state, broadcast }));
  // v6.4.0 — F-036 Goal Planner UI. Plain-English goal → A* plan.
  router.use(createGoalPlannerRouter({ broadcast }));
  // v6.6.0 — F-041 Goals & Tasks Board. Persistent Goal store +
  // progress rollup + GOAP refine. Mounted right after the legacy
  // planner so the planner's POST /goal-planner/plan stays reachable.
  router.use(createGoalsRouter({ broadcast, projectRoot }));
  router.use(createThemesRouter({ state }));
  router.use(createNotificationsRouter({ broadcast }));
  router.use(createArtifactsRouter({ state, broadcast, projectRoot }));
  router.use(createMinimaxRouter({ state, broadcast }));
  router.use(createUsageRouter());
  // v5.0.0 — Headroom context compression endpoints.
  // Mounted at /api/headroom/* so the mount-prefix stripping works correctly.
  // Each route handler inside the router is at its bare path (e.g. '/status'),
  // which becomes '/api/headroom/status' at the top level.
  router.use('/headroom', createHeadroomRouter());
  // v5.0.0 — Eval framework endpoints.
  router.use(createEvalRouter({ state, broadcast }));
  // v5.0.0 — Workspace and user management endpoints.
  router.use(createWorkspacesRouter());
  router.use(createUsersRouter());
  // v4.8.0 — Weekly digest endpoints. Lazy-imported so digest-store
  // module-level imports (tasks, schedules, etc.) don't block boot.
  const { createDigestsRouter } = await import('./routes/digests.mjs');
  router.use(createDigestsRouter({ projectRoot }));
  // v4.8.0 — Backup/restore endpoints. Lazy-imported so backup-store
  // module-level fs operations don't block boot.
  const { createBackupRouter } = await import('./routes/backup.mjs');
  router.use(createBackupRouter({ projectRoot }));
  // v5.0.0 — Web Clipper (clipboard) routes. Saves page/selection content.
  const { createClipboardRouter } = await import('./routes/clipboard.mjs');
  router.use(await createClipboardRouter({ projectRoot }));
  // v5.0.0 — Screenshot OCR routes. Accepts images, extracts text.
  const { createOcrRouter } = await import('./routes/ocr.mjs');
  router.use(await createOcrRouter({ projectRoot }));
  // v5.2 — Tailscale auth key integration. Registered before misc.mjs so
  // /tailscale/* routes here take precedence over any overlapping misc routes.
  const { createTailscaleRouter } = await import('./routes/tailscale.mjs');
  router.use(createTailscaleRouter({}));
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

// ────────────────────────────────────────────────────────────────────────
// F-040 — Live Agent Dashboard integration.
// ────────────────────────────────────────────────────────────────────────

let _watcherBooted = false;

/**
 * Lazy-start the claude-session-watcher. Idempotent — calling it twice
 * is a no-op. We forward watcher events through the supplied
 * `broadcast` (so the WS bus picks them up) AND update the agent-store
 * so the Agents view reflects live state without polling.
 *
 * @param {{ broadcast: (evt: object) => void }} deps
 */
async function ensureClaudeSessionWatcher({ broadcast }) {
  if (_watcherBooted) return;
  _watcherBooted = true;
  try {
    const { claudeSessionWatcher } = await import('./claude-session-watcher.mjs');
    const { agentsStore } = await import('./agents-store.mjs');

    claudeSessionWatcher.start({
      onEvent(evt) {
        try { broadcast(evt); } catch { /* ignore */ }
        // Side-effect: update agent-store on tool_use / session-end.
        if (evt.type === 'claude:tool-use' && evt.agentName) {
          try {
            agentsStore.updateStatus(
              evt.agentName,
              'working',
              `agent:${evt.sessionId}:${evt.toolUseId}`,
            );
            // Pause approval-needs — broadcast a pending-approval event.
            broadcast({
              type: 'claude:approval-needed',
              sessionId: evt.sessionId,
              toolUseId: evt.toolUseId,
              name: evt.name,
              preview: typeof evt.args?.prompt === 'string'
                ? evt.args.prompt.slice(0, 200)
                : (typeof evt.args === 'string' ? evt.args.slice(0, 200) : ''),
              ts: evt.ts || Date.now(),
            });
          } catch { /* best-effort */ }
        } else if (evt.type === 'claude:session-ended') {
          // Clear every agent last seen working in this session.
          try {
            for (const a of agentsStore.list()) {
              const tid = a.currentTaskId || '';
              if (tid.includes(evt.sessionId) || a.status === 'working') {
                agentsStore.recordTaskResult(
                  a.name,
                  tid || `session:${evt.sessionId}`,
                  evt.reason === 'completed',
                );
              }
            }
          } catch { /* best-effort */ }
        }
      },
    });
  } catch (err) {
    // Don't crash boot if the watcher fails to start.
    _watcherBooted = false;
    try {
      loggerWarn('[api] claude-session-watcher failed to start', { err: err?.message || String(err) });
    } catch { /* ignore */ }
  }
}