/**
 * src/server/v2-auth-file.mjs
 *
 * v0.7.0-alpha.1 — Manages the dashboard's persistent password file.
 *
 * On first start: generate a 32-byte random password (base64), write to
 * `~/.cache/bizarharness/dash-auth.json` with mode 0600.
 *
 * On subsequent starts: read the existing file and reuse the password.
 *
 * The plugin reads this same file to authenticate (or accepts
 * `BIZAR_DASHBOARD_PASSWORD` env var override).
 *
 * Discovery paths (mirrors serve-info.mjs pattern):
 *   - ~/.cache/bizarharness/dash-auth.json   (default)
 *   - ~/.cache/bizar/dash-auth.json          (legacy, fallback)
 */

import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const DEFAULT_DIR = join(HOME, '.cache', 'bizarharness');
const DEFAULT_FILE = join(DEFAULT_DIR, 'dash-auth.json');
const LEGACY_FILE = join(HOME, '.cache', 'bizar', 'dash-auth.json');

export const V2_DEFAULT_PORT = 4098;

/**
 * Load or create the dashboard auth record.
 *
 * @param {object} opts
 * @param {string} [opts.file=DEFAULT_FILE] - explicit path
 * @param {number} [opts.port=V2_DEFAULT_PORT] - port to record in auth file
 * @returns {{ password: string, port: number, baseUrl: string, file: string, createdAt: number }}
 */
export function loadOrCreateAuth({ file = DEFAULT_FILE, port = V2_DEFAULT_PORT } = {}) {
  // Prefer legacy file if it exists and default doesn't (migration).
  const candidates = [file, LEGACY_FILE];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.password === 'string' && parsed.password.length >= 16) {
          const p = typeof parsed.port === 'number' ? parsed.port : port;
          return {
            password: parsed.password,
            port: p,
            baseUrl: parsed.baseUrl ?? `http://127.0.0.1:${p}`,
            file: candidate,
            createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
          };
        }
      } catch {
        // fall through to regeneration
      }
    }
  }

  // Generate a new password.
  const password = randomBytes(24).toString('base64');
  const createdAt = Date.now();
  const record = { password, port, baseUrl: `http://127.0.0.1:${port}`, createdAt };

  // Atomic write with mode 0600.
  mkdirSync(dirname(file), { recursive: true });
  const tmpFile = `${file}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(record, null, 2), { mode: 0o600 });
  chmodSync(tmpFile, 0o600);
  renameSync(tmpFile, file);
  // Enforce mode on the final path too (rename preserves mode on some FSes).
  try {
    chmodSync(file, 0o600);
  } catch {
    // non-fatal
  }

  return { ...record, file };
}
