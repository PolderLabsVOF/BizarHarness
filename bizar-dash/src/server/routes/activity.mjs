/**
 * src/server/routes/activity.mjs
 *
 * /api/activity                            — full activity log (newest first)
 * /api/activity/stream                     — SSE stream of activity events
 * /api/activity/hidden                     — list of hidden event keys (for overview hide)
 * /api/activity/hide                      — POST { keys: [...] }  add to hidden
 * /api/activity/hide                      — DELETE                  clear all hidden
 * /api/activity/hide/:key                 — DELETE                  unhide one
 *
 * "Hidden" events are NOT deleted — they're just excluded from the
 * Overview feed. The full log is still queryable at /api/activity.
 *
 * Storage: ~/.cache/bizar/activity-hidden.json
 *   Shape: { hidden: string[] }
 *
 * Event key = sha1(kind|ts|slug) — stable across reloads because it's
 * derived from event content, not a synthetic id.
 */
import { Router } from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { wrap } from './_shared.mjs';

const HIDDEN_PATH = join(homedir(), '.cache', 'bizar', 'activity-hidden.json');

function readHidden() {
  if (!existsSync(HIDDEN_PATH)) return { hidden: [] };
  try {
    return JSON.parse(readFileSync(HIDDEN_PATH, 'utf8'));
  } catch {
    return { hidden: [] };
  }
}

function writeHidden(data) {
  mkdirSync(join(homedir(), '.cache', 'bizar'), { recursive: true });
  writeFileSync(HIDDEN_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/** Compute a stable key for an activity event. */
export function activityKey(item) {
  const h = createHash('sha1');
  h.update(String(item.kind || ''));
  h.update('|');
  h.update(String(item.ts || ''));
  h.update('|');
  h.update(String(item.slug || item.title || ''));
  return h.digest('hex').slice(0, 16);
}

/**
 * @param {object} deps
 * @param {object} deps.state
 * @returns {import('express').Router}
 */
export function createActivityRouter({ state } = {}) {
  const router = Router();

  // GET /activity — full log (newest first)
  // Query params:
  //   limit  — max items to return (default 200, hard cap 1000)
  //   since  — ISO timestamp or numeric ms; only items with ts > since are returned
  router.get('/activity', wrap(async (req, res) => {
    if (!state || typeof state.getOverview !== 'function') {
      res.status(503).json({ error: 'unavailable', message: 'state not ready' });
      return;
    }
    const overview = state.getOverview();
    const items = Array.isArray(overview.recentActivity)
      ? [...overview.recentActivity]
      : [];
    items.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

    let filtered = items;
    if (req.query && req.query.since !== undefined) {
      const raw = String(req.query.since);
      const sinceMs = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
      if (Number.isFinite(sinceMs)) {
        filtered = filtered.filter((e) => {
          const t = typeof e.ts === 'number' ? e.ts : Date.parse(String(e.ts || ''));
          return Number.isFinite(t) && t > sinceMs;
        });
      }
    }

    const requested = Number(req.query?.limit);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 1000) : 200;
    const trimmed = filtered.slice(0, limit);

    res.json({ items: trimmed, total: filtered.length, limit, since: req.query?.since ?? null });
  }));

  // GET /activity/hidden — list of hidden event keys
  router.get('/activity/hidden', wrap(async (_req, res) => {
    res.json(readHidden());
  }));

  // POST /activity/hide — add keys to hidden list
  router.post('/activity/hide', wrap(async (req, res) => {
    const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
    if (keys.length === 0) {
      res.status(400).json({ error: 'bad_request', message: 'keys[] required' });
      return;
    }
    const data = readHidden();
    const set = new Set(data.hidden);
    for (const k of keys) if (typeof k === 'string') set.add(k);
    data.hidden = Array.from(set);
    writeHidden(data);
    res.json(data);
  }));

  // DELETE /activity/hide — clear all hidden
  router.delete('/activity/hide', wrap(async (_req, res) => {
    writeHidden({ hidden: [] });
    res.json({ hidden: [] });
  }));

  // DELETE /activity/hide/:key — unhide one
  router.delete('/activity/hide/:key', wrap(async (req, res) => {
    const data = readHidden();
    data.hidden = data.hidden.filter((k) => k !== req.params.key);
    writeHidden(data);
    res.json(data);
  }));

  // GET /activity/stream — SSE stream of activity events.
  //
  // The Overview tab (Overview.tsx) opens this SSE connection to get live
  // activity updates without polling. Two event types are sent:
  //   event: snapshot\ndata: { events: ActivityItem[], generatedAt: string }\n\n
  //   event: activity\ndata: ActivityItem\n\n
  //
  // The SSE lifetime is unbounded; the client auto-reconnects on drop.
  // We send a 25s heartbeat to keep the connection alive through proxies.
  router.get('/activity/stream', (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    let closed = false;

    // Send current snapshot immediately.
    try {
      const overview = state?.getOverview?.();
      const events = Array.isArray(overview?.recentActivity)
        ? overview.recentActivity.slice(0, 50)
        : [];
      res.write(`event: snapshot\ndata: ${JSON.stringify({ events, generatedAt: overview?.generatedAt || new Date().toISOString() })}\n\n`);
    } catch {
      res.write(`event: snapshot\ndata: ${JSON.stringify({ events: [], generatedAt: new Date().toISOString() })}\n\n`);
    }

    // Poll for new activity every 5 seconds.
    // Reads recentActivity from state and emits only genuinely new entries
    // (identified by ts, which is set at write time).
    let knownLastTs = null;
    const pollInterval = setInterval(() => {
      if (closed || res.writableEnded || res.destroyed) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const overview = state?.getOverview?.();
        const events = Array.isArray(overview?.recentActivity)
          ? overview.recentActivity
          : [];
        if (events.length === 0) return;

        const newestTs = events[0].ts;
        // Only emit if there's a genuinely newer event (newer timestamp than
        // what we last sent, or a new entry with the same timestamp but
        // different content).
        if (knownLastTs === null || newestTs !== knownLastTs) {
          const newEvents = knownLastTs === null
            ? events
            : events.filter((e) => e.ts !== knownLastTs);
          for (const entry of newEvents) {
            res.write(`event: activity\ndata: ${JSON.stringify(entry)}\n\n`);
          }
          knownLastTs = newestTs;
        }
      } catch {
        /* ignore poll errors */
      }
    }, 5_000);

    // Heartbeat to keep the connection alive through reverse proxies.
    const heartbeat = setInterval(() => {
      if (closed || res.writableEnded || res.destroyed) {
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
      closed = true;
      clearInterval(pollInterval);
      clearInterval(heartbeat);
    });
  });

  return router;
}