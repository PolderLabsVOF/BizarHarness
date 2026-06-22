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
import {
  getDirectPeerAddress,
  getOrCreateSecret,
  isAuthRequired,
  isLoopback,
  regenerateSecret,
} from '../auth.mjs';
import { wrap } from './_shared.mjs';

/**
 * @returns {import('express').Router}
 */
export function createAuthRouter() {
  const router = Router();

  // Unauthed status probe. Tells the client whether auth is required
  // and whether the current connection is loopback (in which case
  // the server is auto-trusting it and the client doesn't need to
  // send a token). This is how the dashboard "just works" in a
  // browser on the same machine as the server. Reverse-proxy access
  // still reports the direct peer so operators can tell whether a
  // bearer token will be required.
  router.get('/auth/status', (req, res) => {
    const trusted = isLoopback(req);
    res.json({
      required: isAuthRequired(req),
      loopback: trusted,
      // Surface the direct peer for the Settings UI to display
      // (helps the operator debug if the auto-trust isn't kicking
      // in as expected — e.g. they're hitting a different bind).
      peer: getDirectPeerAddress(req),
    });
  });

  // AUTHED — returns the current token. The caller is presumed to
  // already have it (that's why the auth middleware let them in);
  // we just hand it back so the UI can render a "Copy token" button.
  router.get('/auth/reveal', wrap((_req, res) => {
    res.json({ token: getOrCreateSecret() });
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
