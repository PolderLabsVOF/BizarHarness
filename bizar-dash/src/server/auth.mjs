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
  chmodSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createHmac, createHash } from 'node:crypto';
import { isIP } from 'node:net';

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

const EXTRA_ALLOWED_ORIGINS = (process.env.BIZAR_DASHBOARD_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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
      ensureSecretFileMode();
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
    ensureSecretFileMode();
  } catch (err) {
    // Last-ditch — log to stderr but keep the in-memory token so the
    // process can still serve (and so the operator can see the token
    // in the log even if disk writes are failing).
    console.error(`[dashboard] failed to persist secret to ${SECRET_PATH}: ${err.message}`);
  }
  console.error(`[dashboard] Generated new auth token and saved it to ${SECRET_PATH} (mode 0600)`);
  console.error('[dashboard] Open the dashboard Settings tab from a trusted local session to reveal/copy it.');
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
 * v3.6.1 — Trust loopback connections automatically. The dashboard
 * is a local control surface; the user's own browser talks to it
 * over 127.0.0.1 (or via Tailscale serve, which proxies to 127.0.0.1).
 * Requiring a manual token paste for every browser refresh would be
 * hostile UX. Instead, we authenticate by connection origin:
 *
 *   - Loopback (127.0.0.1, ::1, ::ffff:127.0.0.1) → auto-trust. Tailscale
 *     serve reaches the dashboard over a local proxy hop, but we only
 *     trust that path when the original forwarded client was also
 *     loopback. Remote proxy clients must present the bearer token.
 *   - Non-loopback → require a valid bearer token. The token can
 *     arrive via `Authorization: Bearer <token>` header OR via
 *     `?token=<token>` query string (SSE/EventSource can't set
 *     custom headers, so the query fallback is required for those).
 *
 * Skips paths in `skipPaths` (prefix match) regardless of origin so
 * /api/auth/status remains reachable.
 *
 * To disable loopback trust and force auth on every connection (e.g.
 * you're exposing the dashboard on a non-loopback bind and want
 * defense-in-depth), set BIZAR_DASHBOARD_REQUIRE_AUTH=1.
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

    // Trust loopback unless operator explicitly forces auth for all.
    if (!isAuthRequired(req)) {
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
 * carries a valid token via Authorization header or ?token= query,
 * OR if the connection is from loopback (auto-trust).
 *
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
export function checkWebSocketAuth(req) {
  // Loopback auto-trust
  if (!isAuthRequired(req)) {
    return true;
  }
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
 * Detect whether an incoming request is from a loopback address.
 * Handles both IPv4 (127.0.0.1, 127.0.0.0/8) and IPv6 (::1) loopback,
 * including the IPv4-mapped IPv6 form (::ffff:127.0.0.1) that Node
 * sometimes produces for v4 connections on dual-stack listeners.
 *
 * Trusts forwarded loopback only when both the direct peer and the first
 * X-Forwarded-For hop are loopback — i.e. a local reverse proxy in front
 * of a local browser. Remote proxy clients do not inherit loopback trust.
 *
 * @param {import('http').IncomingMessage | { ip?: string; socket?: { remoteAddress?: string }; connection?: { remoteAddress?: string }; headers?: Record<string, string|undefined> }} req
 * @returns {boolean}
 */
export function isLoopback(req) {
  const direct = getDirectPeerAddress(req);
  const forwarded = getForwardedPeerAddress(req);

  // Direct local connection: no proxy hop, safe to trust.
  if (isLoopbackAddr(direct) && !forwarded) return true;

  // Local reverse proxy: trust only when the *original* caller was also
  // loopback. This closes the previous auth bypass where a remote client
  // could arrive through a local proxy (for example Tailscale serve) and
  // inherit loopback trust.
  //
  // Tailscale Serve proxies to localhost and authenticates users on
  // the tailnet before forwarding. Trust its XFF when opted in.
  if (isLoopbackAddr(direct) && forwarded) {
    if (isLoopbackAddr(forwarded)) return true;
    if (process.env.BIZAR_DASHBOARD_TRUST_TAILSCALE === '1') {
      if (isTailscaleIp(forwarded)) return true;
    }
    return false;
  }

  return false;
}

export function isAuthRequired(req) {
  // Explicit operator opt-out: trust everyone, regardless of peer.
  if (process.env.BIZAR_DASHBOARD_REQUIRE_AUTH === '0') return false;
  if (process.env.BIZAR_DASHBOARD_REQUIRE_AUTH === '1') return true;
  return !isLoopback(req);
}

export function getDirectPeerAddress(req) {
  return (
    req?.socket?.remoteAddress ||
    req?.connection?.remoteAddress ||
    req?.ip ||
    ''
  );
}

export function getForwardedPeerAddress(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff !== 'string') return '';
  return xff.split(',')[0]?.trim() || '';
}

export function isAllowedDashboardOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  const normalized = origin.trim();
  if (!normalized) return false;
  if (EXTRA_ALLOWED_ORIGINS.includes(normalized)) return true;
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return isLoopbackAddr(url.hostname);
  } catch {
    return false;
  }
}

export function isAllowedDashboardOriginForRequest(req) {
  const origin = req?.headers?.origin;
  if (typeof origin !== 'string' || !origin.trim()) return true;
  if (isAllowedDashboardOrigin(origin)) return true;
  if (EXTRA_ALLOWED_ORIGINS.includes(origin.trim())) return true;
  try {
    const originUrl = new URL(origin);
    const hostHeader = String(req?.headers?.host || '').trim();
    const host = stripPort(hostHeader);
    return !!host && originUrl.hostname.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function isLoopbackAddr(addr) {
  if (!addr) return false;
  const normalized = String(addr).replace(/^\[|\]$/g, '').toLowerCase();
  // IPv6 loopback
  if (normalized === '::1' || normalized === 'localhost') return true;
  // IPv4-mapped IPv6 loopback (Node sometimes returns this)
  if (normalized === '::ffff:127.0.0.1' || normalized === '::ffff:7f00:1') return true;
  // IPv4 loopback (entire 127.0.0.0/8)
  if (normalized.startsWith('127.')) return true;
  if (isIP(normalized) === 4) return normalized.startsWith('127.');
  if (isIP(normalized) === 6) return normalized === '::1';
  return false;
}

function isTailscaleIp(addr) {
  if (!addr) return false;
  const s = String(addr).toLowerCase();
  return s.startsWith('100.') || s.startsWith('fd7a:115c:a1e0::');
}

function stripPort(hostHeader) {
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) {
    const idx = hostHeader.indexOf(']');
    return idx === -1 ? hostHeader : hostHeader.slice(1, idx);
  }
  return hostHeader.split(':')[0] || '';
}

function ensureSecretFileMode() {
  try {
    chmodSync(SECRET_PATH, 0o600);
  } catch {
    /* best effort */
  }
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

// ── v5.0.0: JWT helpers for multi-user workspaces ──────────────────────────────

/**
 * Simple HMAC-SHA256 based JWT encoding. Not standards-compliant (no
 * Base64URL padding quirks, no claims validation beyond expiry), but
 * sufficient for local dashboard use and avoids adding a jwt library
 * dependency. The secret is the dashboard secret, giving us free key
 * distribution for existing single-user setups.
 *
 * Payload shape:
 * {
 *   userId: string,
 *   email?: string,
 *   name?: string,
 *   role?: string,
 *   workspaceIds?: string[],
 *   iat: number,  // issued at (unix ms)
 *   exp: number,  // expiry (unix ms)
 * }
 *
 * @param {object} payload
 * @param {number} [expiresInMs=30 days]
 * @returns {string} JWT-like token (base64header.base64payload.signature)
 */
export function mintToken(payload, expiresInMs = 30 * 24 * 60 * 60 * 1000) {
  // We use the raw crypto module for HMAC-SHA256, which is built-in.
  // use named import
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const now = Date.now();
  const claims = { ...payload, iat: now, exp: now + expiresInMs };
  const payloadEncoded = Buffer.from(JSON.stringify(claims)).toString('base64');
  const signature = createHmac('sha256', getOrCreateSecret())
    .update(`${header}.${payloadEncoded}`)
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${payloadEncoded}.${signature}`;
}

/**
 * Decode and verify a JWT-like token. Returns null if the token is
 * invalid, expired, or has been tampered with.
 *
 * @param {string} token
 * @returns {{ payload: object } | null}
 */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  // use named import
  const expectedSig = createHmac('sha256', getOrCreateSecret())
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  if (signatureB64 !== expectedSig) return null;

  let payload;
  try {
    // Restore base64 padding and standard base64
    const payloadStd = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadStd + '=='.slice(0, (4 - payloadStd.length % 4) % 4);
    payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }

  // Check expiry
  if (payload.exp && Date.now() > payload.exp) return null;

  return { payload };
}

/**
 * Extract the raw token from a request (header or query param).
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function extractToken(req) {
  const auth = req.headers?.authorization || '';
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  if (req.query && req.query.token) {
    return String(req.query.token);
  }
  return '';
}

/**
 * Determine the current userId from the request.
 *
 * Tries to decode the token as a JWT first (v5.0 multi-user format).
 * Falls back to treating the raw token as a legacy secret, deriving a
 * deterministic userId from it for single-user compatibility.
 *
 * @param {import('express').Request} req
 * @returns {string|null} userId or null if not authenticated
 */
export function getCurrentUserId(req) {
  const token = extractToken(req);
  if (!token) {
    // v5.3.1 — Tailscale trust: when the dashboard is reached via
    // tailscale serve and the operator has opted in to trust tailnet
    // clients, derive a deterministic userId from the tailnet hostname
    // so the rest of the v5.0 multi-user code paths (workspaces, etc.)
    // work without requiring an explicit token.
    if (process.env.BIZAR_DASHBOARD_TRUST_TAILSCALE === '1' && isLoopback(req)) {
      const hostname = String(req?.headers?.host || '').split(':')[0];
      if (hostname && hostname.endsWith('.ts.net')) {
        return 'usr_ts_' + createHash('sha256').update(hostname).digest('hex').slice(0, 12);
      }
    }
    return null;
  }

  const secret = getOrCreateSecret();

  // If the token exactly matches the secret, it's a legacy single-user setup.
  // Derive a deterministic userId from the secret for backward compat.
  if (timingSafeEqual(token, secret)) {
    // use named import
    return 'usr_' + createHash('sha256').update(secret).digest('hex').slice(0, 12);
  }

  // Try JWT decode
  const verified = verifyToken(token);
  if (verified?.payload?.userId) {
    return verified.payload.userId;
  }

  return null;
}

/**
 * Get the workspaceId the request wants to operate in.
 * Reads X-Workspace-Id header, falls back to first workspace for the user.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function getCurrentWorkspaceId(req) {
  const headerWsId = req.headers?.['x-workspace-id'];
  if (typeof headerWsId === 'string' && headerWsId.trim()) {
    return headerWsId.trim();
  }
  // Fallback: let the caller decide (usually first workspace)
  return null;
}

/**
 * Express middleware: attach userId and workspaceId to the request
 * from the bearer token. Must run AFTER requireAuth.
 *
 * @returns {import('express').RequestHandler}
 */
export function attachUserContext() {
  return (req, _res, next) => {
    req.userId = getCurrentUserId(req);
    req.workspaceId = getCurrentWorkspaceId(req);
    next();
  };
}
