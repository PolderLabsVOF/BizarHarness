/**
 * src/server/routes-v2/auth.mjs
 *
 * v0.7.0-alpha.1 — HTTP Basic auth middleware for /api/v2/* routes.
 *
 * Username: `opencode` (per opencode convention used elsewhere in Bizar).
 * Password: the dashboard-generated secret in ~/.cache/bizarharness/dash-auth.json.
 */

import { Buffer } from 'node:buffer';

export const V2_AUTH_REALM = 'Bizar Dashboard v2';

export function v2BasicAuth(getPassword) {
  return function (req, res, next) {
    const header = req.headers?.authorization ?? req.headers?.Authorization;
    if (!header || typeof header !== 'string' || !header.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', `Basic realm="${V2_AUTH_REALM}"`);
      return res.status(401).json({
        name: 'DashboardError',
        data: { statusCode: 401, message: 'Missing Authorization header' },
      });
    }

    const expected = getPassword();
    if (typeof expected !== 'string' || expected.length === 0) {
      return res.status(500).json({
        name: 'DashboardError',
        data: { statusCode: 500, message: 'Dashboard auth not initialized' },
      });
    }

    let decoded;
    try {
      const b64 = header.slice('Basic '.length);
      decoded = Buffer.from(b64, 'base64').toString('utf-8');
    } catch {
      res.setHeader('WWW-Authenticate', `Basic realm="${V2_AUTH_REALM}"`);
      return res.status(401).json({
        name: 'DashboardError',
        data: { statusCode: 401, message: 'Malformed Authorization header' },
      });
    }

    const colonIdx = decoded.indexOf(':');
    const user = colonIdx === -1 ? decoded : decoded.slice(0, colonIdx);
    const pass = colonIdx === -1 ? '' : decoded.slice(colonIdx + 1);

    if (user !== 'opencode' || pass !== expected) {
      res.setHeader('WWW-Authenticate', `Basic realm="${V2_AUTH_REALM}"`);
      return res.status(401).json({
        name: 'DashboardError',
        data: { statusCode: 401, message: 'Invalid credentials' },
      });
    }

    return next();
  };
}
