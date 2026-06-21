/**
 * src/server/routes/activity.mjs
 *
 * /api/activity                          — recent events
 * /api/activity (POST)                   — append event
 * /api/activity/stream (GET, SSE)        — live snapshot stream
 * /api/activity/session                  — scoped to recent hour
 * /api/comments (POST)                   — generic node-scoped comment
 * /api/nodes/:nodeId/tasks (POST)        — create task from canvas node
 *
 * The SSE route is intentionally NOT wrapped in `wrap()` — a thrown
 * error inside a long-lived stream should tear down the connection,
 * not bubble back as a 500 JSON response. Errors are swallowed and
 * the loop dies on socket close.
 */
import { Router } from 'express';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @returns {import('express').Router}
 */
export function createActivityRouter({ state }) {
  const router = Router();

  router.get('/activity', wrap(async (req, res) => {
    const { activityLog } = await import('../activity-log.mjs');
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '100', 10) || 100));
    const kind = req.query.kind ? String(req.query.kind) : null;
    const nodeId = req.query.nodeId ? String(req.query.nodeId) : null;
    let events;
    if (nodeId) events = activityLog.forNode(nodeId, limit);
    else if (kind) events = activityLog.byKind(kind, limit);
    else events = activityLog.recent(limit);
    res.json({ events, stats: activityLog.stats() });
  }));

  router.post('/activity', wrap(async (req, res) => {
    const { activityLog } = await import('../activity-log.mjs');
    const event = req.body || {};
    if (!event.kind) {
      res.status(400).json({ error: 'bad_request', message: 'kind required' });
      return;
    }
    const record = activityLog.append(event);
    res.status(201).json(record);
  }));

  // ── /api/activity/stream (v3.5.6) ─────────────────────────────────────
  // Server-Sent Events stream of recent activity. Sends:
  //   - 'snapshot' on connect with the current 30-entry window
  //   - 'snapshot' again whenever a new entry is appended (polled at 1Hz)
  //   - 'heartbeat' comment line every 25s so proxies don't drop the conn
  // The frontend subscribes via `new EventSource('/api/activity/stream')`
  // and replaces its array on each 'snapshot' event.
  router.get('/activity/stream', (req, res) => {
    // Tell Express / proxies this is an event stream
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    // CORS for SSE — echo origin so the Vite dev server can subscribe
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    // Flush headers immediately
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const writeSse = (event, data, id) => {
      try {
        if (id !== undefined && id !== null) res.write(`id: ${id}\n`);
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* socket closed mid-write — the close handler will clean up */
      }
    };
    const writeComment = (text) => {
      try { res.write(`: ${text}\n\n`); } catch { /* ignore */ }
    };

    let lastFingerprint = '';
    let closed = false;

    const computeFingerprint = (entries) => {
      if (!Array.isArray(entries) || entries.length === 0) return 'empty';
      const first = entries[0];
      return `${entries.length}:${first.ts || ''}:${first.kind || ''}:${first.id || ''}`;
    };

    const tick = () => {
      if (closed) return;
      try {
        const overview = state.getOverview();
        const recent = Array.isArray(overview.recentActivity) ? overview.recentActivity : [];
        const fp = computeFingerprint(recent);
        if (fp !== lastFingerprint) {
          lastFingerprint = fp;
          writeSse('snapshot', { events: recent, generatedAt: overview.generatedAt });
        }
      } catch {
        /* best-effort — keep the stream alive */
      }
    };

    // Initial snapshot
    try {
      const overview = state.getOverview();
      const recent = Array.isArray(overview.recentActivity) ? overview.recentActivity : [];
      lastFingerprint = computeFingerprint(recent);
      writeSse('snapshot', { events: recent, generatedAt: overview.generatedAt });
      writeComment('initial snapshot sent');
    } catch {
      /* initial write can fail on closed sockets; close handler will fire */
    }

    const pollInterval = setInterval(tick, 1000);
    const hbInterval = setInterval(() => writeComment('heartbeat'), 25000);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(pollInterval);
      clearInterval(hbInterval);
      try { res.end(); } catch { /* ignore */ }
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);
  });

  // ── /api/activity/session (v3.3.0) ────────────────────────────────
  // Returns activity events scoped to the "current session". A
  // session is the most recent hour of activity, or — if the
  // caller provides `?since=<iso>` — the events since that
  // timestamp. Used by the Activity tab to drive the new
  // "session timeline" view.
  router.get('/activity/session', wrap(async (req, res) => {
    const { activityLog } = await import('../activity-log.mjs');
    const sinceParam = req.query.since ? new Date(String(req.query.since)) : null;
    const sinceTs = sinceParam && !Number.isNaN(sinceParam.getTime())
      ? sinceParam.getTime()
      : Date.now() - 60 * 60 * 1000; // 1h default
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '200', 10) || 200));
    const recent = activityLog.recent(limit * 4);
    const events = recent
      .filter((e) => {
        const t = e.ts ? new Date(e.ts).getTime() : 0;
        return t >= sinceTs;
      })
      .slice(0, limit);
    // Group events by "agent involved" — the agent name, when
    // available, lives in `agent`, `actor`, `assignee`, or
    // `nodeId="agent:<name>"`. The Activity canvas uses this to
    // filter the graph down to session participants.
    const agents = new Set();
    for (const e of events) {
      if (typeof e.agent === 'string') agents.add(e.agent);
      if (typeof e.assignee === 'string') agents.add(e.assignee);
      if (typeof e.actor === 'string') agents.add(e.actor);
      if (typeof e.nodeId === 'string' && e.nodeId.startsWith('agent:')) {
        agents.add(e.nodeId.slice('agent:'.length));
      }
      if (typeof e.taskId && e.subtaskIds) {
        // task.delegated event — has subtaskIds
      }
    }
    res.json({
      events,
      since: new Date(sinceTs).toISOString(),
      agents: Array.from(agents),
      stats: activityLog.stats(),
    });
  }));

  // ── /api/comments (v3.2.0 — node-scoped, generic) ──────────────────
  // Comments on any node (agent, task, bg instance, etc.). Stored in
  // the activity log so they show up in the global stream and the
  // per-node drilldown.
  router.post('/comments', wrap(async (req, res) => {
    const { activityLog } = await import('../activity-log.mjs');
    const { nodeId, text, author } = req.body || {};
    if (!nodeId || !text) {
      res.status(400).json({ error: 'bad_request', message: 'nodeId and text required' });
      return;
    }
    const record = activityLog.append({
      kind: 'node.comment',
      nodeId,
      author: author || 'user',
      text: String(text).slice(0, 4000),
    });
    res.status(201).json(record);
  }));

  // v3.2.0 — Create a task from a canvas node (used by the Activity
  // tab to spin up follow-up tasks).
  router.post('/nodes/:nodeId/tasks', wrap(async (req, res) => {
    const { tasksStore } = await import('../tasks-store.mjs');
    const { readActiveProjectId } = await import('./_shared.mjs');
    const projectId = req.body?.projectId || readActiveProjectId();
    const { title, description, priority, assignee } = req.body || {};
    if (!title) {
      res.status(400).json({ error: 'bad_request', message: 'title required' });
      return;
    }
    const task = await tasksStore.create(projectId, {
      title,
      description: description || '',
      priority: ['low', 'normal', 'high'].includes(priority) ? priority : 'normal',
      assignee: assignee || null,
      tags: [`node:${req.params.nodeId}`],
    });
    // Record in the activity log so it shows up under this node.
    try {
      const { activityLog } = await import('../activity-log.mjs');
      activityLog.append({
        kind: 'node.task',
        nodeId: req.params.nodeId,
        taskId: task.id,
        title: task.title,
      });
    } catch { /* best-effort */ }
    res.status(201).json(task);
  }));

  return router;
}