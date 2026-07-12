/**
 * src/server/routes/timeline.mjs
 *
 * F-042 — REST surface for the Timeline aggregator.
 *
 *   GET    /api/timeline                  — query (filters: projectId, type, since, until, agentName, file, taskId, goalId, sessionId, commitSha, text, limit, offset)
 *   POST   /api/timeline/refresh          — manual re-tail hook logs (info only; returns { appended })
 *   GET    /api/timeline/summary          — counts by type for the last N days (default 7)
 *   GET    /api/timeline/agent-context    — short prose summary (≤200 words)
 *   POST   /api/timeline/append           — fire-and-forget for hooks (no auth; internal)
 *
 * Every successful `appendEvent` also broadcasts `{ type: 'timeline:event', event }`
 * over the dashboard WS so connected clients update without polling.
 */

import { Router } from 'express';
import { timelineStore } from '../timeline-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * Build the timeline router.
 *
 * @param {object} deps
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createTimelineRouter({ broadcast = () => {} } = {}) {
  const router = Router();

  // Start the in-memory ring + hook-log watcher the first time the
  // router is mounted. Idempotent.
  timelineStore.start({ broadcast });

  router.get('/timeline', wrap(async (req, res) => {
    const opts = pickOpts(req.query);
    const r = timelineStore.query(opts);
    res.json({ events: r.items, total: r.total, limit: r.limit, offset: r.offset });
  }));

  router.post('/timeline/refresh', wrap(async (_req, res) => {
    const appended = timelineStore.scanHookLogsDir();
    res.json({ ok: true, appended });
  }));

  router.get('/timeline/summary', wrap(async (req, res) => {
    const since = req.query.since
      || new Date(Date.now() - Number(req.query.days || 7) * 24 * 60 * 60 * 1000).toISOString();
    const r = timelineStore.summary({ since });
    res.json(r);
  }));

  router.get('/timeline/agent-context', wrap(async (req, res) => {
    const since = req.query.since
      || new Date(Date.now() - Number(req.query.hours || 24) * 60 * 60 * 1000).toISOString();
    const text = timelineStore.agentContext({ since });
    res.json({ text, since, scope: req.query.scope || null });
  }));

  // Fire-and-forget entry for hooks. Never throws — wraps in a try
  // and always returns 204 so a hook can call it without ceremony.
  router.post('/timeline/append', wrap(async (req, res) => {
    const body = req.body || {};
    if (!body || typeof body !== 'object') {
      res.status(204).end();
      return;
    }
    try {
      timelineStore.appendEvent(body);
    } catch {
      /* swallow — hooks must never see exceptions from this path */
    }
    res.status(204).end();
  }));

  return router;
}

function pickOpts(query) {
  const opts = {};
  const fields = ['projectId', 'type', 'since', 'until', 'agentName', 'file', 'taskId', 'goalId', 'sessionId', 'commitSha', 'text'];
  for (const f of fields) {
    if (query[f] != null) opts[f] = String(query[f]);
  }
  if (query.limit != null) opts.limit = Number(query.limit);
  if (query.offset != null) opts.offset = Number(query.offset);
  return opts;
}
