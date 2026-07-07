/**
 * src/server/routes-v2/sessions.mjs
 *
 * v0.7.0-alpha.1 — Sessions CRUD for /api/v2/sessions/*.
 *
 * Stores sessions in-memory (Map). The plugin is the source of truth for
 * session state (it owns cline serve); the dashboard reflects what the
 * plugin publishes via the event bus + REST.
 *
 * For v0.7.0-alpha.1 this is a minimal implementation sufficient for the
 * smoke test. v0.7.1 will integrate with the dashboard's existing
 * background-store.mjs.
 */

import express from 'express';

export function createV2SessionsRouter({ eventBus }) {
  const router = express.Router();
  const sessions = new Map(); // id → Session

  router.get('/sessions', (req, res) => {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;
    const agentFilter = typeof req.query.agent === 'string' ? req.query.agent : null;
    let limit = 50;
    if (typeof req.query.limit === 'string') {
      const n = Number.parseInt(req.query.limit, 10);
      if (Number.isFinite(n) && n > 0 && n <= 200) limit = n;
    }

    let list = Array.from(sessions.values());
    if (statusFilter) list = list.filter((s) => s.status === statusFilter);
    if (agentFilter) list = list.filter((s) => s.agent === agentFilter);
    list.sort((a, b) => b.createdAt - a.createdAt);
    res.status(200).json(list.slice(0, limit));
  });

  router.post('/sessions', (req, res) => {
    const body = req.body ?? {};
    if (typeof body.agent !== 'string' || body.agent.length === 0) {
      return res.status(400).json({
        name: 'DashboardError',
        data: { statusCode: 400, message: '`agent` is required' },
      });
    }
    if (typeof body.prompt !== 'string' || body.prompt.length === 0) {
      return res.status(400).json({
        name: 'DashboardError',
        data: { statusCode: 400, message: '`prompt` is required' },
      });
    }
    const now = Date.now();
    const id = `bgr_${randomUlid()}`;
    const session = {
      id,
      agent: body.agent,
      status: 'pending',
      parentId: typeof body.parentId === 'string' ? body.parentId : undefined,
      model: typeof body.model === 'string' ? body.model : undefined,
      toolCallCount: 0,
      worktree: typeof body.worktree === 'string' ? body.worktree : process.cwd(),
      createdAt: now,
      updatedAt: now,
    };
    sessions.set(id, session);
    eventBus.publish({
      type: 'session.created',
      properties: { sessionId: id, agent: session.agent },
    });
    res.status(201).json(session);
  });

  router.get('/sessions/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) {
      return res.status(404).json({
        name: 'DashboardError',
        data: { statusCode: 404, message: 'Session not found' },
      });
    }
    res.status(200).json(session);
  });

  router.delete('/sessions/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) {
      return res.status(404).json({
        name: 'DashboardError',
        data: { statusCode: 404, message: 'Session not found' },
      });
    }
    session.status = 'killed';
    session.updatedAt = Date.now();
    eventBus.publish({
      type: 'session.updated',
      properties: { sessionId: session.id, status: 'killed' },
    });
    res.status(204).end();
  });

  return router;
}

function randomUlid() {
  // Lightweight ULID-ish suffix (10 chars base36 of timestamp + random).
  const ts = Date.now().toString(36).toUpperCase();
  let rnd = '';
  for (let i = 0; i < 10; i += 1) {
    rnd += Math.floor(Math.random() * 36).toString(36).toUpperCase();
  }
  return `${ts}${rnd}`;
}
