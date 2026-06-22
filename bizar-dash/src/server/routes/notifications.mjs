/**
 * src/server/routes/notifications.mjs
 *
 * /api/notifications                     — list (?unread=true to filter)
 * /api/notifications/:id/read (POST)     — mark one as read
 * /api/notifications/read-all (POST)     — mark every as read
 * /api/notifications/:id (DELETE)        — dismiss
 */
import { Router } from 'express';
import { notificationsStore } from '../notifications-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createNotificationsRouter({ broadcast }) {
  const router = Router();

  // v3.3.0 — Per-user notification stream. Backed by an append-only
  // JSONL log at ~/.config/bizar/notifications.jsonl. Read state is
  // persisted separately at notifications.read.json.
  router.get('/notifications', wrap(async (req, res) => {
    const unread = req.query.unread === 'true' || req.query.unread === '1';
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '200', 10) || 200));
    const items = notificationsStore.list({ unread, limit });
    res.json({ notifications: items, stats: notificationsStore.stats() });
  }));

  router.post('/notifications/:id/read', wrap(async (req, res) => {
    const ok = notificationsStore.markRead(req.params.id);
    if (ok) broadcast({ type: 'notifications:change' });
    res.json({ ok });
  }));

  router.post('/notifications/read-all', wrap(async (_req, res) => {
    const marked = notificationsStore.markAllRead();
    broadcast({ type: 'notifications:change' });
    res.json({ ok: true, marked });
  }));

  router.delete('/notifications/:id', wrap(async (req, res) => {
    const ok = notificationsStore.remove(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'notifications:change' });
    res.status(204).end();
  }));

  return router;
}
