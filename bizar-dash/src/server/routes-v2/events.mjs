/**
 * src/server/routes-v2/events.mjs
 *
 * v0.7.0-alpha.1 — SSE event stream + publish endpoint.
 *
 * GET  /api/v2/event  — subscribe (text/event-stream, sends dashboard.connected first)
 * POST /api/v2/event  — publish (returns 204)
 *
 * Matches the cline SSE wire format:
 *   event: <type>
 *   data: {"type": "<type>", "properties": {...}}
 *
 * Replay buffer: last 100 events, accessible via `?since=<seq>`.
 */

import express from 'express';
import { createRateLimiter } from '../lib/rate-limit.mjs';

export function createV2EventsRouter({ eventBus }) {
  const router = express.Router();

  // v4.8.0 — Per-IP token bucket. The v2 event endpoint accepts
  // arbitrary publishes from the cline plugin, so we cap it
  // higher than chat to keep automation pipelines flowing under
  // burst. Defaults: 120 requests / minute / IP, 2 tokens/sec refill.
  // Operators can tune via BIZAR_RATE_LIMIT_EVENT_CAPACITY /
  // BIZAR_RATE_LIMIT_EVENT_REFILL.
  const eventLimiter = createRateLimiter({
    capacity: parseInt(process.env.BIZAR_RATE_LIMIT_EVENT_CAPACITY || '120', 10),
    refillPerSecond: parseFloat(process.env.BIZAR_RATE_LIMIT_EVENT_REFILL || '2'),
    scope: 'event',
  });
  router.use(eventLimiter);

  router.get('/event', (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders?.();

    // First event: dashboard.connected.
    writeSseEvent(res, { type: 'dashboard.connected', properties: {} });

    const sinceRaw = req.query?.since;
    const since = typeof sinceRaw === 'string' ? Number.parseInt(sinceRaw, 10) : undefined;
    const validSince = Number.isFinite(since) ? since : undefined;

    const sub = eventBus.subscribe({ since: validSince });

    // Async pump: pull events from sub.events and write them to res.
    const pump = (async () => {
      try {
        for await (const record of sub.events) {
          if (res.writableEnded || res.destroyed) break;
          writeSseEvent(res, record);
        }
      } catch (err) {
        if (!res.writableEnded) {
          try {
            res.end();
          } catch {
            /* ignore */
          }
        }
      }
    })();

    // Heartbeat every 25s to keep the connection alive through proxies.
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
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sub.close();
    });

    // Don't await pump — it's a long-lived stream.
    void pump;
  });

  router.post('/event', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || typeof body.type !== 'string') {
      return res.status(400).json({
        name: 'DashboardError',
        data: { statusCode: 400, message: 'Event must have a string `type` field' },
      });
    }
    try {
      eventBus.publish({ type: body.type, properties: body.properties ?? {} });
    } catch (err) {
      return res.status(400).json({
        name: 'DashboardError',
        data: { statusCode: 400, message: err instanceof Error ? err.message : String(err) },
      });
    }
    return res.status(204).end();
  });

  return router;
}

function writeSseEvent(res, record) {
  const payload = JSON.stringify({
    type: record.type,
    properties: record.properties ?? {},
  });
  res.write(`event: ${record.type}\n`);
  res.write(`data: ${payload}\n\n`);
}
