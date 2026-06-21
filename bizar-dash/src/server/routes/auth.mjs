/**
 * src/server/routes/auth.mjs
 *
 * v3.6.0 — Auth-related routes: status, reveal, regenerate.
 *
 * /api/auth/status   — UNAUTHED. Returns { required: true } so a
 *                      client can detect that auth is on and ask the
 *                      operator to paste a token.
 * /api/auth/reveal   — AUTHED. Returns the current token. Only useful
 *                      to someone who already has it (chicken-and-egg
 *                      by design — initial token comes from server
 *                      stderr on first boot).
 * /api/auth/regenerate — AUTHED. Mints a new token, invalidating the
 *                      old one immediately. The response body carries
 *                      the new token ONCE — the caller must persist
 *                      it client-side.
 */
import { Router } from 'express';
import { getSecret, regenerateSecret } from '../auth.mjs';
import { wrap } from './_shared.mjs';

/**
 * @returns {import('express').Router}
 */
export function createAuthRouter() {
  const router = Router();

  // Unauthed status probe. Mounted by the server as an explicit
  // skipPath in requireAuth — so even this endpoint doesn't need its
  // own auth check.
  router.get('/auth/status', (_req, res) => {
    res.json({ required: true });
  });

  // AUTHED — returns the current token. The caller is presumed to
  // already have it (that's why the auth middleware let them in);
  // we just hand it back so the UI can render a "Copy token" button.
  router.get('/auth/reveal', wrap((_req, res) => {
    const token = getSecret();
    if (!token) {
      res.status(500).json({ error: 'no_secret', message: 'token not initialized' });
      return;
    }
    res.json({ token });
  }));

  // AUTHED — rotate the token. Anything still holding the old token
  // will start getting 401s immediately. The new token is in the
  // response body; the caller MUST save it.
  router.post('/auth/regenerate', wrap((_req, res) => {
    const newToken = regenerateSecret();
    res.json({ token: newToken });
  }));

  return router;
}