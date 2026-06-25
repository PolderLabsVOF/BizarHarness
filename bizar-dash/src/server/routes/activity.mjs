/**
 * src/server/routes/activity.mjs
 *
 * /api/activity                            — full activity log (newest first)
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
  router.get('/activity', wrap(async (_req, res) => {
    if (!state || typeof state.getOverview !== 'function') {
      res.status(503).json({ error: 'unavailable', message: 'state not ready' });
      return;
    }
    const overview = state.getOverview();
    const items = Array.isArray(overview.recentActivity)
      ? [...overview.recentActivity]
      : [];
    items.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    res.json({ items, total: items.length });
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

  return router;
}