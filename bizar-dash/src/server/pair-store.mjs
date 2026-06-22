/**
 * src/server/pair-store.mjs
 *
 * v3.5.2 — Pairing token store for the Bizar Companion mobile app.
 *
 * Generates short-lived bearer tokens that the dashboard issues when a user
 * taps "Pair Device" in the Settings view (or runs the TUI / pair CLI).
 * The companion app scans a QR code containing:
 *
 *   bizar://pair?url=<publicUrl>&token=<token>
 *
 * …then calls `GET /api/pair/verify` with the token. On success the
 * companion stores the URL + token in expo-secure-store and uses it as a
 * Bearer header for all subsequent API + WebSocket calls.
 *
 * Tokens are stored in memory only — a server restart invalidates all
 * outstanding tokens. The TTL is 5 minutes, which is enough for the user
 * to open the app, scan, and verify.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** @typedef {{ token: string, expiresAt: number, publicUrl: string }} PairToken */

/** @type {Map<string, PairToken>} */
const tokens = new Map();

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

function gc() {
  const now = Date.now();
  for (const [tok, entry] of tokens) {
    if (entry.expiresAt <= now) tokens.delete(tok);
  }
}

/**
 * Mint a fresh pairing token bound to a public URL.
 * @param {string} publicUrl - URL the companion app should hit (https://... or http://localhost:...)
 * @param {number} [ttlMs] - milliseconds until expiry
 * @returns {PairToken & { qrPayload: string }}
 */
export function mint(publicUrl, ttlMs = DEFAULT_TTL_MS) {
  gc();
  const token = `pair_${randomBytes(24).toString('base64url')}`;
  const expiresAt = Date.now() + ttlMs;
  const entry = { token, expiresAt, publicUrl };
  tokens.set(token, entry);
  return {
    ...entry,
    qrPayload: `bizar://pair?url=${encodeURIComponent(publicUrl)}&token=${encodeURIComponent(token)}`,
  };
}

/**
 * Verify a Bearer token. Returns the entry on success, null on failure.
 * @param {string | null | undefined} token
 * @returns {PairToken | null}
 */
export function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const entry = tokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    tokens.delete(token);
    return null;
  }
  return entry;
}

/**
 * Express middleware: if the request carries a valid Bearer pair token,
 * set `req.pairToken` and `req.pairEntry`. Does NOT block unauthenticated
 * requests — the dashboard itself doesn't require auth; this middleware
 * just enriches the request so other handlers can recognize paired clients.
 */
export function pairTokenMiddleware(req, _res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    req.pairToken = null;
    req.pairEntry = null;
    return next();
  }
  const token = auth.slice(7).trim();
  const entry = verify(token);
  req.pairToken = entry ? token : null;
  req.pairEntry = entry;
  next();
}

/**
 * Detect the URL the companion app should hit. Preference order:
 *   1. Tailscale MagicDNS hostname from `tailscale.json` (if enabled)
 *   2. The Host header from the current request (so localhost works in dev)
 *   3. localhost on the configured port
 *
 * @param {import('express').Request} req
 * @param {number} port
 * @returns {string}
 */
export function detectPublicUrl(req, port) {
  // 1. Tailscale config (best for phone-over-WiFi)
  try {
    const cfgPath = join(homedir(), '.config', 'bizar', 'tailscale.json');
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      if (cfg?.enabled && cfg?.hostname) {
        const proto = cfg.https === false ? 'http' : 'https';
        return `${proto}://${cfg.hostname}`;
      }
    }
  } catch {
    /* fall through */
  }

  // 2. Host header from the current request
  const host = (req?.headers?.host || '').toString().trim();
  if (host && /^[A-Za-z0-9.:[\]-]+$/.test(host) && !host.startsWith('127.0.0.1') && !host.startsWith('localhost')) {
    const rawProto = (req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').toString().split(',')[0].trim().toLowerCase();
    const proto = rawProto === 'https' ? 'https' : 'http';
    return `${proto}://${host}`;
  }

  // 3. localhost fallback
  return `http://localhost:${port}`;
}

export const pairStore = {
  mint,
  verify,
  detectPublicUrl,
  middleware: pairTokenMiddleware,
  /** For tests / introspection only. */
  _size: () => tokens.size,
  _clear: () => tokens.clear(),
};
