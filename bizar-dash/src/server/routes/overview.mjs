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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { projectsStore } from '../projects-store.mjs';
import { tasksStore } from '../tasks-store.mjs';
import { agentsStore } from '../agents-store.mjs';
import { schedulesStore } from '../schedules-store.mjs';
import { providersStore, mcpsStore } from '../providers-store.mjs';
import { modsLoader } from '../mods-loader.mjs';
import { error as logError } from '../logger.mjs';
import { parseProgress } from '../progress-parser.mjs';
import { peekCachedAgents } from './agents-cc.mjs';
import {
  CLINE_JSON,
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
      child.on('error', (err) => {
        logError('restart spawn failed', { module: 'overview', err: err.message });
      });
      child.unref();
      process.exit(0);
    }, 500);
  });

  function buildSnapshot() {
    const cfg = safeReadJSON(CLINE_JSON, null);
    const active = projectsStore.active();
    const tasks = active ? tasksStore.loadTasks(active.id) : [];
    const bizarAgents = agentsStore.list();
    const baseOverview = state.getOverview();
    // S23 — enrich the overview with the counts the dashboard StatTiles
    // read. Previously `state.getOverview()` returned only `counts.*`,
    // which meant every Overview StatTile rendered 0/— on a real
    // dashboard. Compute the missing keys here from the live stores.
    const enrichedOverview = enrichOverview({
      base: baseOverview,
      tasks,
      bizarAgents,
      ccAgents: safeCCAgents(),
    });
    return {
      overview: enrichedOverview,
      agents: [...bizarAgents, ...safeCCAgents()],
      artifacts: state.getArtifacts(),
      projects: projectsStore.list().projects,
      activeProject: active,
      config: {
        path: CLINE_JSON,
        data: cfg,
        raw: cfg === null ? '' : JSON.stringify(cfg, null, 2),
        exists: existsSync(CLINE_JSON),
      },
      settings: readSettings(),
      tasks,
      mods: modsLoader.list(),
      schedules: active ? schedulesStore.list(active.id) : [],
      providers: providersStore.list(),
      mcps: mcpsStore.list(),
    };
  }

  /**
   * Read CC agents synchronously via the cached listAgents() helper.
   * Falls back to [] if the CLI isn't installed or returns an error —
   * the dashboard must stay online even when `claude` is missing.
   */
  function safeCCAgents() {
    try {
      const cached = peekCachedAgents();
      if (cached && Array.isArray(cached.agents)) return cached.agents;
    } catch { /* ignore */ }
    return [];
  }

  /**
   * Aggregate counts the dashboard StatTiles expect:
   *   tasks:   { queued, active, done, blocked }
   *   goals:   { total, done, atRisk }
   *   agents:  { total, running, idle, error }
   *   tokens:  { last24h, trend }
   *   needsAttention: Array<{label, value, hint?}>
   *
   * Reads PROGRESS.md via `parseProgress` so we share the same source
   * of truth as CC's `/goal` command and the dashboard's /api/goals.
   */
  function enrichOverview({ base, tasks, bizarAgents, ccAgents }) {
    // Tasks — bucket by status.
    const taskBuckets = { queued: 0, active: 0, done: 0, blocked: 0 };
    for (const t of tasks) {
      const s = String(t?.status || '').toLowerCase();
      if (s === 'done') taskBuckets.done += 1;
      else if (s === 'blocked') taskBuckets.blocked += 1;
      else if (s === 'in_progress' || s === 'active' || s === 'working') taskBuckets.active += 1;
      else taskBuckets.queued += 1;
    }

    // Goals — parse PROGRESS.md (same store CC's /goal writes).
    const goalBuckets = { total: 0, done: 0, atRisk: 0 };
    try {
      const root = activeProjectRoot();
      const progressFile = join(root, '.bizar', 'PROGRESS.md');
      if (existsSync(progressFile)) {
        const raw = readFileSync(progressFile, 'utf8');
        const parsed = parseProgress(raw);
        goalBuckets.total = parsed.goals.length;
        for (const g of parsed.goals) {
          const status = String(g.status || '').toLowerCase();
          if (status === 'done') goalBuckets.done += 1;
          if (status === 'at-risk' || status === 'off-track' || status === 'blocked') {
            goalBuckets.atRisk += 1;
          }
        }
      }
    } catch { /* ignore */ }

    // Agents — bucket by status across Bizar + CC rosters.
    const agentBuckets = { total: 0, running: 0, idle: 0, error: 0 };
    const allAgents = [...(bizarAgents || []), ...(ccAgents || [])];
    agentBuckets.total = allAgents.length;
    for (const a of allAgents) {
      const s = String(a?.status || '').toLowerCase();
      if (s === 'working' || s === 'running' || s === 'active') agentBuckets.running += 1;
      else if (s === 'error' || s === 'stuck') agentBuckets.error += 1;
      else if (s === 'idle') agentBuckets.idle += 1;
    }

    // Tokens — carry through from base if present, else zero.
    const tokens = base?.tokens && typeof base.tokens === 'object'
      ? base.tokens
      : { last24h: 0, trend: 'flat' };

    // needsAttention — derived from the buckets above. Order matters:
    // blocked tasks first (urgent), then at-risk goals, then error agents.
    const needsAttention = [];
    if (taskBuckets.blocked > 0) {
      needsAttention.push({
        label: 'Blocked tasks',
        value: `${taskBuckets.blocked} task${taskBuckets.blocked === 1 ? '' : 's'} blocked`,
        hint: 'Open the Tasks view to unblock.',
      });
    }
    if (goalBuckets.atRisk > 0) {
      needsAttention.push({
        label: 'Goals at risk',
        value: `${goalBuckets.atRisk} of ${goalBuckets.total} goal${goalBuckets.total === 1 ? '' : 's'} at risk`,
        hint: 'Review PROGRESS.md or the Goals view.',
      });
    }
    if (agentBuckets.error > 0) {
      needsAttention.push({
        label: 'Agents in error',
        value: `${agentBuckets.error} agent${agentBuckets.error === 1 ? '' : 's'} need attention`,
        hint: 'Open Agents view for restart / kill.',
      });
    }

    return {
      ...base,
      tasks: taskBuckets,
      goals: goalBuckets,
      agents: agentBuckets,
      tokens,
      needsAttention,
    };
  }

  function activeProjectRoot() {
    const active = projectsStore.active();
    return active?.cwd ? active.cwd : homedir();
  }

  return router;
}
