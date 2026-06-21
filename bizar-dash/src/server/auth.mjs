/**
 * src/server/auth.mjs
 *
 * v3.6.0 — Bearer-token authentication for the dashboard API.
 *
 * Threat model: the dashboard is a local control surface for an agent
 * platform. When bound to 127.0.0.1 (the default), the only attacker is
 * other local users on the box. When the user opts in to a non-local
 * bind (BIZAR_DASHBOARD_BIND=0.0.0.0 — typical for Tailscale serve), the
 * attack surface expands to the whole tailnet. A static bearer token
 * (auto-generated on first boot, stored at mode 0600) closes the
 * "anyone on the tailnet can hit my dashboard" gap.
 *
 * Token storage:
 *   - File:  $BIZAR_DASHBOARD_SECRET_PATH or ~/.config/bizar/dashboard-secret
 *   - Mode:  0600 (read+write for owner only)
 *   - Length: 64 hex chars (32 bytes of entropy)
 *
 * Token delivery:
 *   - HTTP routes: Authorization: Bearer <token>
 *   - SSE routes:  Authorization header OR ?token=<token> query param
 *     (EventSource in browsers cannot set custom headers)
 *   - WebSocket:   ?token=<token> query param on the connection URL
 *     (browsers cannot set the Authorization header on WebSocket either)
 *
 * The single public unauthed endpoint is /api/auth/status, which lets
 * the dashboard probe whether auth is required and where to get the
 * token from. /api/auth/reveal (authed) returns the current token for
 * display in the Settings tab. /api/auth/regenerate (authed) mints a
 * fresh token and returns it ONCE in the response — the caller MUST
 * persist it client-side, because the next call without it will 401.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

/** Absolute path to the on-disk token. Override via BIZAR_DASHBOARD_SECRET_PATH. */
export const SECRET_PATH = process.env.BIZAR_DASHBOARD_SECRET_PATH
  || join(homedir(), '.config', 'bizar', 'dashboard-secret');

/**
 * In-process cache of the token. Set on first read so the
 * expensive file I/O only happens once per process. Cleared by
 * /api/auth/regenerate.
 * @type {string | null}
 */
let cachedToken = null;

/**
 * Get the current token, generating one on disk if it doesn't exist.
 *
 * Generation is silent on disk (no token logged there), but the FIRST
 * time we mint a token we ALSO print it to stderr so the operator can
 * see it once. After that the only place to retrieve the token is the
 * Settings tab via /api/auth/reveal (which is itself authed — so only
 * someone who already has the token can read it back).
 *
 * @returns {string} the current bearer token (hex)
 */
export function getOrCreateSecret() {
  if (cachedToken) return cachedToken;
  if (existsSync(SECRET_PATH)) {
    try {
      const onDisk = readFileSync(SECRET_PATH, 'utf8').trim();
      if (onDisk) {
        cachedToken = onDisk;
        return cachedToken;
      }
    } catch {
      /* unreadable — fall through to regen */
    }
  }
  // Generate. 32 bytes = 256 bits of entropy → 64 hex chars.
  cachedToken = randomBytes(32).toString('hex');
  try {
    mkdirSync(dirname(SECRET_PATH), { recursive: true });
    writeFileSync(SECRET_PATH, cachedToken + '\n', { mode: 0o600 });
  } catch (err) {
    // Last-ditch — log to stderr but keep the in-memory token so the
    // process can still serve (and so the operator can see the token
    // in the log even if disk writes are failing).
    console.error(`[dashboard] failed to persist secret to ${SECRET_PATH}: ${err.message}`);
  }
  // v3.6.0 — Print the token to stderr exactly once on first boot.
  // This is the only place the raw token is ever printed. After this
  // point the operator must use /api/auth/reveal from a client that
  // already has the token.
  console.error(`[dashboard] Generated new auth token: ${cachedToken}`);
  console.error(`[dashboard] Saved to ${SECRET_PATH} (mode 0600)`);
  console.error(`[dashboard] Show in dashboard Settings tab to copy.`);
  return cachedToken;
}

/**
 * Public accessor used by /api/auth/reveal. Returns the same string
 * as getOrCreateSecret() but never triggers generation if the file
 * is missing (so we can call it from already-authed code without
 * risking a "first-boot then 401" race).
 *
 * @returns {string | null} the current token, or null if not yet
 *   generated
 */
export function getSecret() {
  if (cachedToken) return cachedToken;
  if (existsSync(SECRET_PATH)) {
    try {
      cachedToken = readFileSync(SECRET_PATH, 'utf8').trim() || null;
    } catch {
      cachedToken = null;
    }
  }
  return cachedToken;
}

/**
 * Force-regenerate the token. Deletes the file, clears the cache,
 * and mints a new one. Called by POST /api/auth/regenerate.
 *
 * @returns {string} the new token
 */
export function regenerateSecret() {
  try {
    unlinkSync(SECRET_PATH);
  } catch {
    /* missing is fine */
  }
  cachedToken = null;
  return getOrCreateSecret();
}

/**
 * Express middleware: reject requests without a valid bearer token.
 *
 * Skips paths in `skipPaths` (prefix match). For all others, accepts
 * the token from either the `Authorization: Bearer <token>` header
 * OR the `?token=<token>` query string. The query string fallback is
 * required because SSE clients (EventSource) cannot set custom
 * headers in the browser.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.skipPaths] — path prefixes to skip (e.g. ['/auth/status'])
 * @returns {import('express').RequestHandler}
 */
export function requireAuth({ skipPaths = [] } = {}) {
  return (req, res, next) => {
    const url = req.path || req.url || '';
    if (skipPaths.some((p) => url === p || url.startsWith(p + '/'))) {
      return next();
    }

    const auth = req.headers?.authorization || '';
    let token = '';
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      token = auth.slice(7);
    } else if (req.query && req.query.token) {
      token = String(req.query.token);
    }

    // Constant-time compare to avoid leaking length / prefix info via
    // timing. String#length and the per-byte XOR loop both run in
    // linear time regardless of match position.
    const expected = getOrCreateSecret();
    if (!token || !timingSafeEqual(token, expected)) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid or missing auth token',
      });
      return;
    }
    next();
  };
}

/**
 * WebSocket upgrade-time auth check. Returns true if the request
 * carries a valid token via Authorization header or ?token= query.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
export function checkWebSocketAuth(req) {
  let token = '';
  const auth = req.headers?.authorization || '';
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    token = auth.slice(7);
  }
  if (!token && req.url) {
    try {
      const u = new URL(req.url, 'http://localhost');
      const q = u.searchParams.get('token');
      if (q) token = q;
    } catch {
      /* bad URL — leave token empty */
    }
  }
  const expected = getOrCreateSecret();
  return !!token && timingSafeEqual(token, expected);
}

/**
 * Length-aware constant-time string compare. We compute XOR over the
 * longer string's length so the runtime depends on `expected.length`
 * (which is constant per process) and not on the candidate's length
 * or prefix.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}