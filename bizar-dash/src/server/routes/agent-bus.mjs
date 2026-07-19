/**
 * src/server/routes/agent-bus.mjs
 *
 * G-autoloop Phase 5 — HTTP surface for the agent-bus.
 *
 * Endpoints (mounted under `/api/agent-bus`):
 *   GET  /api/agent-bus/presence                — current presence snapshot
 *   GET  /api/agent-bus/channels                — list known channels
 *   GET  /api/agent-bus/channels/:name          — recent messages on a channel
 *   POST /api/agent-bus/channels/:name/publish  — publish a raw message
 *   POST /api/agent-bus/steer                   — convenience: steer wrapper
 *   POST /api/agent-bus/correct                 — convenience: correct wrapper
 *   POST /api/agent-bus/handoff                 — convenience: handoff wrapper
 *   POST /api/agent-bus/announce                — update presence
 *   DELETE /api/agent-bus/agents/:name          — leave (remove from presence)
 *
 * Phase 5 deliberately keeps this endpoint surface read-mostly with
 * a thin publish helper — the consumer sites (Loop sidebar, Agent
 * viewer) are mostly subscribers via WebSocket, not publishers. The
 * `publish` endpoint is included so curl/operators can drop a steer
 * in from outside without writing a node script.
 *
 * Authz: every endpoint goes through the bearer-token gate the server
 * already applies. We deliberately do NOT enforce address-from ==
 * current user; that's reserved for a later pill once we layer in the
 * Bizar identity model.
 */

import { Router } from 'express';
import { existsSync, readdirSync, statSync } from 'node:fs';
import {
  getPresence,
  announce,
  leave,
  readChannel,
  publish as busPublish,
  steer as busSteer,
  correct as busCorrect,
  handoff as busHandoff,
  AGENT_BUS_LOG_DIR,
  DEFAULT_CHANNEL,
  isValidAddress,
} from '../agent-bus.mjs';
import { wrap } from './_shared.mjs';

const VALID_KINDS = new Set(['request', 'response', 'steer', 'correct', 'handoff', 'ack', 'status', 'error']);

/**
 * @param {Object} deps
 * @param {Function} [deps.broadcast]
 */
export function createAgentBusRouter({ broadcast = () => {} } = {}) {
  const router = Router();

  router.get('/agent-bus/presence', wrap(async (req, res) => {
    const p = getPresence();
    res.json({ agents: p, count: Object.keys(p).length });
  }));

  router.get('/agent-bus/channels', wrap(async (req, res) => {
    if (!existsSync(AGENT_BUS_LOG_DIR)) {
      res.json({ channels: [], count: 0 });
      return;
    }
    const channels = [];
    for (const f of readdirSync(AGENT_BUS_LOG_DIR)) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        const fullStat = statSync(`${AGENT_BUS_LOG_DIR}/${f}`);
        if (fullStat.isFile()) {
          channels.push({
            name: f.replace(/\.jsonl$/, ''),
            bytes: fullStat.size,
          });
        }
      } catch { /* ignore */ }
    }
    res.json({ channels, count: channels.length });
  }));

  router.get('/agent-bus/channels/:name', wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    const since = req.query.since || null;
    const messages = readChannel(req.params.name, { limit, since });
    res.json({ channel: req.params.name, messages, count: messages.length });
  }));

  router.post('/agent-bus/channels/:name/publish', wrap(async (req, res) => {
    const body = req.body || {};
    if (!body.from || !isValidAddress(body.from)) {
      res.status(400).json({ error: 'bad_request', message: 'from (valid agent://address) required' });
      return;
    }
    if (!body.to || !isValidAddress(body.to)) {
      res.status(400).json({ error: 'bad_request', message: 'to (valid agent://address) required' });
      return;
    }
    if (!body.kind || !VALID_KINDS.has(body.kind)) {
      res.status(400).json({ error: 'bad_request', message: 'kind required and valid' });
      return;
    }
    const id = busPublish({
      from: body.from,
      to: body.to,
      channel: req.params.name === DEFAULT_CHANNEL ? undefined : req.params.name,
      kind: body.kind,
      payload: body.payload || {},
      correlationId: body.correlationId || null,
      taskId: body.taskId || null,
    });
    broadcast({ type: 'agent-bus:message', channel: req.params.name });
    res.status(202).json({ id, ok: true });
  }));

  router.post('/agent-bus/steer', wrap(async (req, res) => {
    const body = req.body || {};
    if (!body.from || !body.to) {
      res.status(400).json({ error: 'bad_request', message: 'from and to required' });
      return;
    }
    const id = busSteer(body.from, body.to, body.note || '', {
      channel: body.channel,
      taskId: body.taskId,
    });
    if (body.channel) broadcast({ type: 'agent-bus:message', channel: body.channel });
    res.status(202).json({ id, ok: true });
  }));

  router.post('/agent-bus/correct', wrap(async (req, res) => {
    const body = req.body || {};
    if (!body.from || !body.to) {
      res.status(400).json({ error: 'bad_request', message: 'from and to required' });
      return;
    }
    const id = busCorrect(body.from, body.to, body.note || '', {
      before: body.before ?? null,
      after: body.after ?? null,
      reason: body.reason || null,
    }, {
      channel: body.channel,
      taskId: body.taskId,
    });
    if (body.channel) broadcast({ type: 'agent-bus:message', channel: body.channel });
    res.status(202).json({ id, ok: true });
  }));

  router.post('/agent-bus/handoff', wrap(async (req, res) => {
    const body = req.body || {};
    if (!body.from || !body.to || !body.taskId) {
      res.status(400).json({ error: 'bad_request', message: 'from, to, taskId required' });
      return;
    }
    const id = busHandoff(body.from, body.to, body.taskId, body.reason || '', {
      channel: body.channel,
    });
    if (body.channel) broadcast({ type: 'agent-bus:message', channel: body.channel });
    res.status(202).json({ id, ok: true });
  }));

  router.post('/agent-bus/announce', wrap(async (req, res) => {
    const body = req.body || {};
    try {
      announce({
        name: body.name,
        sessionId: body.sessionId,
        capabilities: body.capabilities,
        currentTask: body.currentTask,
        model: body.model,
      });
    } catch (err) {
      res.status(400).json({ error: 'bad_request', message: err.message });
      return;
    }
    broadcast({ type: 'agent-bus:presence', agents: getPresence() });
    res.json({ ok: true });
  }));

  router.delete('/agent-bus/agents/:name', wrap(async (req, res) => {
    leave(req.params.name);
    broadcast({ type: 'agent-bus:presence', agents: getPresence() });
    res.status(204).end();
  }));

  return router;
}
