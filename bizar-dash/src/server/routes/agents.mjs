/**
 * src/server/routes/agents.mjs
 *
 * /api/agents                            — list
 * /api/agents/stuck                      — agents exceeding the stuck threshold
 * /api/agents/hierarchy                  — parent/child tree
 * /api/agents/:name                      — single agent metadata
 * /api/agents (POST)                     — create
 * /api/agents/:name (PUT)                — update
 * /api/agents/:name/invoke (POST)        — log an invocation intent
 * /api/agents/:name/status (POST)        — update status (idle|working|error|stuck)
 * /api/agents/:name/heartbeat (POST)     — bump last-heartbeat
 * /api/agents/:name/restart (POST)       — restart
 * /api/agents/:name (DELETE)             — remove
 *
 * Express-ordering notes:
 *   - /agents/stuck MUST come before /agents/:name (else "stuck"
 *     gets captured as a name).
 *   - /agents/hierarchy MUST come before /agents/:name (same reason).
 */
import { Router } from 'express';
import { agentsStore, buildHierarchyTree } from '../agents-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createAgentsRouter({ state, broadcast }) {
  const router = Router();

  router.get('/agents', wrap(async (_req, res) => {
    res.json({ agents: agentsStore.list() });
  }));

  // v3.1.0 — /api/agents/stuck must be defined BEFORE the /:name
  // catch-all or Express will treat "stuck" as an agent name.
  router.get('/agents/stuck', wrap(async (_req, res) => {
    res.json({ stuck: agentsStore.stuck() });
  }));

  // v3.2.0 — Agent hierarchy. Must be defined BEFORE /agents/:name
  // or Express will treat "hierarchy" as a name.
  router.get('/agents/hierarchy', wrap(async (_req, res) => {
    const agents = agentsStore.list();
    const tree = buildHierarchyTree(agents);
    res.json(tree);
  }));

  router.get('/agents/:name', wrap(async (req, res) => {
    const agent = agentsStore.get(req.params.name);
    if (!agent) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(agent);
  }));

  router.post('/agents', wrap(async (req, res) => {
    const agent = agentsStore.create(req.body || {});
    broadcast({ type: 'agents:change' });
    res.status(201).json(agent);
  }));

  router.put('/agents/:name', wrap(async (req, res) => {
    const agent = agentsStore.update(req.params.name, req.body || {});
    broadcast({ type: 'agents:change' });
    res.json(agent);
  }));

  router.post('/agents/:name/invoke', wrap(async (req, res) => {
    const name = req.params.name;
    const prompt = (req.body && req.body.prompt) || '';
    if (!prompt.trim()) {
      res.status(400).json({ error: 'bad_request', message: 'prompt is required' });
      return;
    }
    state.appendActivity({ kind: 'agent.invoke', agent: name, prompt: String(prompt).slice(0, 500) });
    res.status(202).json({ accepted: true, agent: name });
  }));

  // v3.1.0 — Agent status (idle / working / error / stuck). The opencode
  // plugin pings this when it picks up or finishes a task; the dashboard
  // also calls it on the lifecycle hooks below.
  router.post('/agents/:name/status', wrap(async (req, res) => {
    const name = req.params.name;
    const { status, currentTaskId } = req.body || {};
    const valid = ['idle', 'working', 'error', 'stuck'];
    if (status && !valid.includes(status)) {
      res.status(400).json({ error: 'bad_request', message: `invalid status (use: ${valid.join(', ')})` });
      return;
    }
    const agent = agentsStore.updateStatus(name, status || 'idle', currentTaskId ?? null);
    if (!agent) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'agent:status', agent });
    res.json(agent);
  }));

  router.post('/agents/:name/heartbeat', wrap(async (req, res) => {
    const agent = agentsStore.heartbeat(req.params.name);
    if (!agent) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(agent);
  }));

  router.post('/agents/:name/restart', wrap(async (req, res) => {
    const agent = agentsStore.restart(req.params.name);
    if (!agent) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'agent:restarted', agent });
    res.json(agent);
  }));

  router.delete('/agents/:name', wrap(async (req, res) => {
    const ok = agentsStore.delete(req.params.name);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'agents:change' });
    res.status(204).end();
  }));

  return router;
}