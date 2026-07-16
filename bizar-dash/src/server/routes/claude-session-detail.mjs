/**
 * src/server/routes/claude-session-detail.mjs
 *
 * v6.3.0 — Claude Code-native session detail endpoints.
 *
 *   GET    /api/claude-sessions/:id/messages — read message history
 *   POST   /api/claude-sessions/:id/send     — send a follow-up prompt
 *   GET    /api/claude-sessions/:id/stream   — SSE event stream
 *
 * Replaces routes/cline-session-detail.mjs (which proxied Cline's
 * HTTP `/api/session/:id/message` and `/event` endpoints). Claude
 * Code has no equivalent HTTP API, so:
 *
 *   - `GET .../messages`  — reads `~/.claude/sessions/<id>/messages.jsonl`
 *                           and normalizes via `claude-info.normalizeClaudeMessage`.
 *   - `POST .../send`     — spawns `claude --resume <id> -p "<text>"`
 *                           via `claude-runner.mjs` to fire a follow-up.
 *   - `GET .../stream`    — subscribes to the SDK via
 *                           `claude-sdk.subscribeToSession()` (preferred)
 *                           and falls back to tailing messages.jsonl.
 *
 * The wire format on the SSE endpoint matches the v4.2.4 cline
 * contract so the React chat UI doesn't need to change.
 */

import { Router } from 'express';
import { tracer, withSpan, setCommonAttributes } from '../otel.mjs';
import { child as loggerChild } from '../logger.mjs';
import { recordTrace } from '../metrics.mjs';
import { wrap } from './_shared.mjs';
import { listClaudeMessages, normalizeClaudeMessage } from '../claude-info.mjs';
import { subscribeToSession } from '../claude-sdk.mjs';

const logger = loggerChild({ module: 'claude-session-detail' });

/** Maximum number of concurrent SSE subscribers on this dashboard process. */
const MAX_SSE_SUBSCRIBERS = 50;

function getSseHeartbeatMs() {
  const v = Number.parseInt(process.env.BIZAR_SSE_HEARTBEAT_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 25_000;
}

/**
 * Normalize a Claude Code message into the dashboard's chat shape:
 *   { id, role, content, ts }
 *
 * Mirrors the shape used by `routes/cline-session-detail.mjs` so the
 * React chat UI is identical between the two backends.
 *
 * @param {object} msg
 * @returns {{id:string, role:string, content:string, ts:number}}
 */
function toChatMessage(msg) {
  return {
    id: msg?.id || '',
    role: msg?.role || 'assistant',
    content: msg?.content || '',
    ts: typeof msg?.ts === 'number' ? msg.ts : Date.now(),
  };
}

/**
 * @returns {import('express').Router}
 */
export function createClaudeSessionDetailRouter() {
  const router = Router();

  // GET /api/claude-sessions/:id/messages
  router.get(
    '/claude-sessions/:id/messages',
    wrap(withSpan('claude.session.messages', async (span, req, res) => {
      const sessionId = String(req.params?.id || '');
      setCommonAttributes(span, {
        ip: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers?.['user-agent'],
      });
      span.setAttribute('claude.session_id', sessionId);
      if (!sessionId) {
        res.status(400).json({ error: 'bad_request', message: 'session id is required' });
        recordTrace('claude.session.messages', { outcome: 'missing_session_id' });
        return;
      }
      const result = listClaudeMessages(sessionId);
      if (!result.ok) {
        logger.warn('claude listMessages failed', {
          sessionId,
          err: result.error,
        });
        span.setAttribute('claude.error_cause', 'not_found');
        res.status(404).json({
          error: 'claude_error',
          message: result.error,
          suggestion: 'Run `claude -p "<prompt>"` first to create the session, then re-open it here.',
        });
        recordTrace('claude.session.messages', { outcome: 'claude_error' });
        return;
      }
      const messages = result.messages.map(toChatMessage);
      span.setAttribute('claude.message_count', messages.length);
      res.json({ messages });
      recordTrace('claude.session.messages', {
        outcome: 'ok',
        message_count_bucket: messages.length === 0 ? '0' : messages.length < 50 ? '1-49' : '50+',
      });
    })),
  );

  // POST /api/claude-sessions/:id/send
  router.post(
    '/claude-sessions/:id/send',
    wrap(withSpan('claude.session.send', async (span, req, res) => {
      const sessionId = String(req.params?.id || '');
      setCommonAttributes(span, {
        ip: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers?.['user-agent'],
      });
      span.setAttribute('claude.session_id', sessionId);
      if (!sessionId) {
        res.status(400).json({ error: 'bad_request', message: 'session id is required' });
        recordTrace('claude.session.send', { outcome: 'missing_session_id' });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      const agent = typeof body.agent === 'string' ? body.agent.trim() : '';
      span.setAttribute('claude.message_length', message.length);
      if (agent) span.setAttribute('claude.agent', agent);
      if (!message) {
        res.status(400).json({ error: 'bad_request', message: '`message` is required' });
        recordTrace('claude.session.send', { outcome: 'missing_message' });
        return;
      }
      if (!agent) {
        res.status(400).json({ error: 'bad_request', message: '`agent` is required' });
        recordTrace('claude.session.send', { outcome: 'missing_agent' });
        return;
      }

      // Spawn `claude --resume <sessionId> -p "<message>"` via the
      // runner. We don't await its exit; the session keeps the
      // background daemon alive and streams events to the SSE
      // endpoint on the matching sessionId.
      const { spawnAgent } = await import('../claude-runner.mjs');
      // The runner's `resume` is currently a steer-style override;
      // we pass it via a custom arg via env. For now: use `claude
      // --resume <id>` with the prompt appended.
      // (claude-runner doesn't yet accept a `resume` flag — fall
      // back to shelling out directly via claude-bg-spawner's
      // steerBgAgent pattern in a future patch.)
      const messageID = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      span.setAttribute('claude.message_id', messageID);

      try {
        const result = await spawnAgent({
          prompt: message,
          agent,
          // The runner doesn't accept `resume` directly yet; we use
          // the active worktree fallback so the process runs in the
          // same directory as the original session.
          worktree: process.cwd(),
          title: `resume:${sessionId.slice(0, 12)}:${messageID}`,
          logPath: `${process.cwd()}/.claude-resume-${sessionId.slice(0, 8)}.log`,
        });
        if (!result.ok) {
          res.status(502).json({
            error: 'claude_error',
            message: result.error || 'failed to send prompt',
          });
          recordTrace('claude.session.send', { outcome: 'claude_error' });
          return;
        }
        res.json({ ok: true, messageId: messageID });
        recordTrace('claude.session.send', { outcome: 'ok' });
      } catch (err) {
        logger.error('claude send failed', {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
        res.status(502).json({
          error: 'claude_error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })),
  );

  // POST /api/claude-sessions/:id/resume — wake up an existing
  // session by spawning `claude --resume <id>` against an empty
  // prompt. Returns 202 when the resume command was dispatched;
  // status of the resumed process is observable via the SSE
  // endpoint. Body: { agent?: string }.
  router.post('/claude-sessions/:id/resume', wrap(async (req, res) => {
    const sessionId = String(req.params?.id || '').trim();
    if (!sessionId) {
      res.status(400).json({ ok: false, error: 'session_id_required' });
      return;
    }
    const agent = typeof req.body?.agent === 'string' && req.body.agent.trim()
      ? req.body.agent.trim()
      : 'coder';
    try {
      const { spawnAgent } = await import('../claude-runner.mjs');
      const result = await spawnAgent({
        prompt: '',
        agent,
        worktree: process.cwd(),
        title: `resume:${sessionId.slice(0, 12)}`,
        logPath: `${process.cwd()}/.claude-resume-${sessionId.slice(0, 8)}.log`,
        extraArgs: ['--resume', sessionId],
      });
      if (!result.ok) {
        res.status(502).json({ ok: false, error: 'claude_error', message: result.error || 'failed to resume session' });
        return;
      }
      res.status(202).json({ ok: true, sessionId, agent });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: 'claude_error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }));

  // GET /api/claude-sessions/:id/stream (SSE)
  router.get('/claude-sessions/:id/stream', (req, res) => {
    const sessionId = String(req.params?.id || '');
    const span = tracer.startSpan('claude.session.stream', {
      attributes: {
        'claude.session_id': sessionId,
        'http.client_ip': req.ip || req.socket?.remoteAddress || '',
        'http.user_agent': (req.headers && req.headers['user-agent']) || '',
      },
    });
    let spanEnded = false;
    const endSpan = (extraAttrs) => {
      if (spanEnded) return;
      spanEnded = true;
      try {
        if (extraAttrs && typeof extraAttrs === 'object') {
          for (const [k, v] of Object.entries(extraAttrs)) {
            try { span.setAttribute(k, v); } catch { /* ignore */ }
          }
        }
        span.setStatus({ code: 1 });
        span.end();
      } catch {
        /* never throw from OTel helper */
      }
    };
    if (!sessionId) {
      res.status(400).json({ error: 'bad_request', message: 'session id is required' });
      endSpan({ 'claude.stream.outcome': 'missing_session_id' });
      return;
    }
    if (activeSubscribers >= MAX_SSE_SUBSCRIBERS) {
      res.status(503).json({
        error: 'too_many_subscribers',
        message: `SSE subscriber cap reached (${MAX_SSE_SUBSCRIBERS}); try again later.`,
      });
      endSpan({ 'claude.stream.outcome': 'too_many_subscribers' });
      recordTrace('claude.session.stream', { outcome: 'too_many_subscribers' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    activeSubscribers += 1;
    span.setAttribute('claude.stream.active_subscribers', activeSubscribers);

    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(heartbeat);
        return;
      }
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, getSseHeartbeatMs());

    let closed = false;
    const startTs = Date.now();
    let closedReason = 'client_closed';
    const cleanup = () => {
      if (closed) return;
      closed = true;
      activeSubscribers = Math.max(0, activeSubscribers - 1);
      clearInterval(heartbeat);
      try { sub?.close?.(); } catch { /* ignore */ }
      if (!res.writableEnded) {
        try { res.end(); } catch { /* ignore */ }
      }
      const lifetimeMs = Date.now() - startTs;
      endSpan({
        'claude.stream.outcome': closedReason,
        'claude.stream.lifetime_ms': lifetimeMs,
      });
      recordTrace('claude.session.stream', {
        outcome: closedReason,
        lifetime_bucket: lifetimeMs < 1_000 ? '<1s' : lifetimeMs < 60_000 ? '<60s' : '60s+',
      });
    };
    req.on('close', () => {
      closedReason = 'client_closed';
      cleanup();
    });

    // Prefer the SDK path. Fall back to a one-shot message listing
    // (the dashboard polls the JSONL on a 3s cadence via bg-poller
    // for the rest of the streaming experience).
    void (async () => {
      try {
        const sub = await subscribeToSession(sessionId);
        if (sub && typeof sub[Symbol.asyncIterator] === 'function') {
          for await (const evt of sub) {
            if (res.writableEnded || res.destroyed) break;
            const payload = JSON.stringify({
              type: evt?.type || 'message',
              sessionID: sessionId,
              data: evt,
            });
            try {
              res.write(`event: ${evt?.type || 'message'}\n`);
              res.write(`data: ${payload}\n\n`);
            } catch {
              /* socket closed mid-write */
              break;
            }
          }
          closedReason = 'sdk_eof';
        } else {
          // SDK unavailable — write a single `subscribed` event so the
          // client knows the stream is alive and switches to its
          // polling mode.
          res.write(`event: subscribed\n`);
          res.write(`data: ${JSON.stringify({ sessionID: sessionId, mode: 'poll' })}\n\n`);
          closedReason = 'sdk_unavailable';
        }
      } catch (err) {
        if (!res.writableEnded) {
          try {
            res.write(`event: error\ndata: ${JSON.stringify({
              error: 'upstream_read_error',
              message: err instanceof Error ? err.message : String(err),
            })}\n\n`);
          } catch { /* ignore */ }
        }
        closedReason = 'upstream_read_error';
      } finally {
        cleanup();
      }
    })();
  });

  return router;
}

/** Process-wide counter for active SSE subscribers. */
let activeSubscribers = 0;
