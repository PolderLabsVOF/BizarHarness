/**
 * src/server/routes/pair.mjs
 *
 * Companion-app pairing (v3.5.2).
 *
 *   /api/pair/start (POST)   — mint a short-lived token, return QR payload
 *   /api/pair/verify (GET)   — companion confirms a token before persisting
 *   /api/pair/status (GET)   — count of currently active pair tokens
 *
 * The pair token is unrelated to the v3.6.0 dashboard auth token;
 * it's a separate short-lived bearer that's minted on demand for
 * the companion QR scan flow.
 */
import { Router } from 'express';
import { pairStore } from '../pair-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createPairRouter({ state, broadcast }) {
  const router = Router();

  router.post('/pair/start', wrap(async (req, res) => {
    const port = req.app?.get('port') || (req.socket?.server?.address()?.port) || 4321;
    const publicUrl = pairStore.detectPublicUrl(req, port);
    const ttlMs = Math.max(30_000, Math.min(15 * 60 * 1000, Number(req.body?.ttlMs) || 5 * 60 * 1000));
    const entry = pairStore.mint(publicUrl, ttlMs);
    state.appendActivity({ kind: 'pair.start', publicUrl: entry.publicUrl, expiresAt: entry.expiresAt });
    broadcast({ type: 'pair:change', publicUrl: entry.publicUrl, expiresAt: entry.expiresAt });
    res.json({
      token: entry.token,
      qrPayload: entry.qrPayload,
      publicUrl: entry.publicUrl,
      expiresAt: entry.expiresAt,
    });
  }));

  // Used by the companion right after scanning the QR to confirm the token
  // works before persisting it. Returns { valid: true } on success, 401
  // { error: 'expired' | 'no_token' } on failure.
  router.get('/pair/verify', wrap(async (req, res) => {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      res.status(401).json({ error: 'no_token', message: 'missing Authorization: Bearer' });
      return;
    }
    const token = auth.slice(7).trim();
    const entry = pairStore.verify(token);
    if (!entry) {
      res.status(401).json({ error: 'expired', message: 'pair token invalid or expired' });
      return;
    }
    res.json({ valid: true, publicUrl: entry.publicUrl, expiresAt: entry.expiresAt });
  }));

  // Lightweight introspection — useful for the Settings card and the TUI
  // to show "X tokens active". Always returns { active: <count> }.
  router.get('/pair/status', wrap(async (_req, res) => {
    res.json({ active: pairStore._size() });
  }));

  return router;
}