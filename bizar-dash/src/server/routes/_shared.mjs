/**
 * src/server/routes/_shared.mjs
 *
 * v3.6.0 — Shared utilities for the split route modules.
 *
 * The original api.mjs had everything in one 2,395-line file. After
 * the split, this module holds the cross-route helpers: file I/O,
 * settings read/write, the `wrap` async error handler, and the
 * "active project id" resolver.
 *
 * Keeping these in one place (rather than duplicating per route file)
 * means a single change here propagates to every router.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname, resolve as pathResolve, sep as pathSep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { projectsStore } from '../projects-store.mjs';

const DASH_PACKAGE_JSON = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'package.json',
);

function readDashboardVersion() {
  try {
    const raw = JSON.parse(readFileSync(DASH_PACKAGE_JSON, 'utf8'));
    return raw?.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const DASHBOARD_VERSION = readDashboardVersion();

/** Home dir, cached at module load (homedir() doesn't change mid-process). */
export const HOME = homedir();

/** Opencode config dir. Same convention used by api.mjs. */
export const OPENCODE_DIR = join(HOME, '.config', 'opencode');
export const OPENCODE_JSON = join(OPENCODE_DIR, 'opencode.json');

/** Bizar home + settings file path. */
export const BIZAR_HOME = join(HOME, '.config', 'bizar');
export const SETTINGS_FILE = join(BIZAR_HOME, 'settings.json');

/**
 * Safe JSON read with a default. Catches every failure mode
 * (missing file, empty file, malformed JSON, permission error) and
 * returns `fallback`.
 *
 * @template T
 * @param {string} file
 * @param {T} fallback
 * @returns {T | null}
 */
export function safeReadJSON(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * Safe text read with a fallback for unreadable / missing files.
 *
 * @param {string} file
 * @param {string} fallback
 * @returns {string}
 */
export function safeReadText(file, fallback = '') {
  try {
    if (!existsSync(file)) return fallback;
    return readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

export function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

/**
 * The v3 settings shape. Keep this in sync with the `DEFAULT_SETTINGS`
 * constant that used to live inline in api.mjs. The frontend mirrors
 * the same shape in web/lib/types.ts → Settings.
 */
export const DEFAULT_SETTINGS = {
  theme: {
    mode: 'dark',
    accent: '#8b5cf6',
    success: '#3fb950',
    warning: '#d29922',
    error: '#f85149',
    info: '#58a6ff',
    fontFamily: 'Inter',
    fontSize: 14,
    compactMode: false,
    animations: true,
  },
  ui: {
    layout: 'topnav',
    showHeader: true,
    showStatusBar: true,
    defaultTab: 'overview',
  },
  defaultAgent: 'odin',
  defaultModel: '',
  notifications: { onAgentComplete: true, onPlanApproval: true },
  dashboard: { autoLaunchWeb: true, projectsDirectory: '', allowedRoots: [] },
  service: { enabled: true, autostart: false },
  about: {
    version: DASHBOARD_VERSION,
    homepage: 'https://github.com/DrB0rk/BizarHarness',
    license: 'MIT',
  },
  agents: {
    maxParallel: 6,
    stuckThresholdMs: 600000,
    autoRestart: true,
  },
  systemLlm: {
    enabled: true,
    provider: 'opencode',
    model: 'opencode/deepseek-v4-flash-free',
  },
};

/**
 * Merge a user-supplied settings object onto the defaults, preserving
 * unknown keys but always overwriting the `about.version` so the
 * package's actual version wins (defends against a user hand-editing
 * settings.json to claim a different version).
 *
 * @param {Record<string, unknown> | null | undefined} existing
 * @returns {Record<string, unknown>}
 */
export function mergeSettings(existing) {
  if (!existing || typeof existing !== 'object') return DEFAULT_SETTINGS;
  const merged = { ...DEFAULT_SETTINGS, ...existing };
  merged.theme = { ...DEFAULT_SETTINGS.theme, ...(existing.theme || {}) };
  merged.ui = { ...DEFAULT_SETTINGS.ui, ...(existing.ui || {}) };
  merged.notifications = {
    ...DEFAULT_SETTINGS.notifications,
    ...(existing.notifications || {}),
  };
  merged.dashboard = { ...DEFAULT_SETTINGS.dashboard, ...(existing.dashboard || {}) };
  merged.service = { ...DEFAULT_SETTINGS.service, ...(existing.service || {}) };
  merged.about = { ...DEFAULT_SETTINGS.about, ...(existing.about || {}) };
  merged.agents = { ...DEFAULT_SETTINGS.agents, ...(existing.agents || {}) };
  merged.systemLlm = { ...DEFAULT_SETTINGS.systemLlm, ...(existing.systemLlm || {}) };
  // Always use the package version — never let user settings override it
  merged.about.version = DEFAULT_SETTINGS.about.version;
  return merged;
}

/**
 * Read settings.json from disk. Returns `{ path, data, exists }`.
 *
 * @returns {{ path: string, data: Record<string, unknown>, exists: boolean }}
 */
export function readSettings() {
  const raw = safeReadJSON(SETTINGS_FILE, null);
  return {
    path: SETTINGS_FILE,
    data: mergeSettings(raw),
    exists: existsSync(SETTINGS_FILE),
  };
}

/**
 * Write settings.json (merged with defaults). Returns the new
 * readSettings() shape so callers can broadcast the canonical data.
 *
 * Validates the merged `dashboard` sub-object via
 * `validateDashboardSettings` before persisting. Invalid payloads
 * throw a structured `Error` (`.status = 400`, `.code`,
 * `.message`) which the route's `wrap()` translates into a 400 JSON
 * response.
 *
 * @param {Record<string, unknown>} data
 * @returns {{ path: string, data: Record<string, unknown>, exists: boolean }}
 */
export function writeSettings(data) {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  const merged = mergeSettings(data);
  // Validate BEFORE atomic write so a bad payload never lands on disk.
  validateDashboardSettings(merged.dashboard);
  atomicWriteJson(SETTINGS_FILE, merged);
  return readSettings();
}

/**
 * Maximum number of entries permitted in `dashboard.allowedRoots`.
 * Prevents a malicious or accidental payload from widening the
 * filesystem boundary to thousands of roots, which would make the
 * allow-list itself a DoS vector at request time.
 */
const MAX_ALLOWED_ROOTS = 50;

/**
 * Validate one path string in the dashboard sub-object. Returns the
 * trimmed path if it is safe, or throws a structured Error.
 *
 * Rules applied:
 *   - must be a non-empty string
 *   - must NOT contain NUL (`\0`)
 *   - must NOT contain a backslash (POSIX paths have no backslash;
 *     a backslash is a strong signal of a path-escape attempt)
 *   - must be an absolute path (starts with `/` on POSIX)
 *   - must resolve under `os.homedir()` — the dashboard's filesystem
 *     boundary. A configured path that escapes home is rejected
 *     outright so a typo can't silently widen the boundary.
 *
 * @param {unknown} value
 * @param {string} fieldName  — used in the error message
 * @returns {string}          — the trimmed path
 */
function validateDashboardPath(value, fieldName) {
  if (typeof value !== 'string') {
    const err = new Error(`${fieldName} must be a string`);
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    // Empty is allowed for `projectsDirectory` (means "unset");
    // higher-level validation already decided whether empty is OK
    // for the calling field. Here we just hand back the trimmed
    // empty string so the caller can short-circuit.
    return trimmed;
  }
  if (trimmed.includes('\0')) {
    const err = new Error(`${fieldName} must not contain NUL bytes`);
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }
  if (trimmed.includes('\\')) {
    const err = new Error(`${fieldName} must not contain backslashes`);
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }
  if (!trimmed.startsWith('/')) {
    const err = new Error(`${fieldName} must be an absolute path (start with /)`);
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }
  const home = homedir();
  const homeResolved = pathResolve(home);
  const candidateResolved = pathResolve(trimmed);
  if (candidateResolved !== homeResolved &&
      !candidateResolved.startsWith(homeResolved + pathSep)) {
    const err = new Error(
      `${fieldName} must live under the user's home directory (${home})`,
    );
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }
  return trimmed;
}

/**
 * Validate the `dashboard.*` sub-object on PUT /api/settings. Throws
 * a structured Error (`.status = 400`, `.code = 'bad_request'`,
 * `.message`) when the payload is unsafe. Returns normally on
 * success.
 *
 * Rules:
 *   - `dashboard.projectsDirectory` must be empty, OR a non-empty
 *     string path that is absolute and lives under `os.homedir()`.
 *     Rationale: the projects scanner is gated to home, so a
 *     `projectsDirectory` that escapes home would be silently
 *     unusable; rejecting at write time surfaces the mistake
 *     instead of letting it rot in settings.json.
 *   - `dashboard.allowedRoots` must be an array of strings. Each
 *     entry must be an absolute path under `os.homedir()`. An empty
 *     array is allowed (means "no extras"). Entries that fail
 *     validation are rejected here (NOT silently dropped) so the
 *     operator sees the bad value. Runtime allow-list building
 *     (`buildAllowedRootsFromSettings`) drops silently for the
 *     "tampered-settings" defense-in-depth path.
 *   - No path may contain NUL bytes or backslashes (POSIX-path
 *     escape attempts).
 *   - The total number of allowedRoots entries is capped at
 *     `MAX_ALLOWED_ROOTS` to keep the per-request allow-list
 *     bounded.
 *
 * @param {Record<string, unknown> | null | undefined} dashboard
 */
export function validateDashboardSettings(dashboard) {
  if (dashboard == null) return;
  if (typeof dashboard !== 'object' || Array.isArray(dashboard)) {
    const err = new Error('dashboard settings must be an object');
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }

  // projectsDirectory
  const proj = dashboard.projectsDirectory;
  if (proj !== undefined && proj !== null && proj !== '') {
    validateDashboardPath(proj, 'dashboard.projectsDirectory');
  } else if (proj !== undefined && proj !== null && typeof proj !== 'string') {
    const err = new Error('dashboard.projectsDirectory must be a string');
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }

  // allowedRoots
  const roots = dashboard.allowedRoots;
  if (roots === undefined || roots === null) {
    // Field omitted — mergeSettings fills in the default `[]`. Fine.
  } else if (!Array.isArray(roots)) {
    const err = new Error('dashboard.allowedRoots must be an array');
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  } else {
    if (roots.length > MAX_ALLOWED_ROOTS) {
      const err = new Error(
        `dashboard.allowedRoots may not exceed ${MAX_ALLOWED_ROOTS} entries`,
      );
      err.status = 400;
      err.code = 'bad_request';
      throw err;
    }
    roots.forEach((entry, i) => {
      validateDashboardPath(entry, `dashboard.allowedRoots[${i}]`);
    });
  }
}

/**
 * Tiny frontmatter parser. Used by the mods routes that need to
 * read SKILL.md / command / agent YAML frontmatter. We only support
 * scalar values (string / number) — no nested objects — because the
 * dashboard never edits frontmatter, only displays it.
 *
 * @param {string} raw
 * @returns {{ frontmatter: Record<string, string>, body: string }}
 */
export function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s+/, '');
  const frontmatter = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    frontmatter[key] = val;
  }
  return { frontmatter, body };
}

/**
 * Resolve the current active project id (or null if none). This is
 * the per-request default that task/schedule/state lookups fall back
 * to when the client didn't pass an explicit projectId.
 *
 * @returns {string | null}
 */
export function readActiveProjectId() {
  return projectsStore.active()?.id || null;
}

/**
 * Async-error wrapper used by every route handler. A throw inside the
 * handler becomes a JSON `{ error, message }` response with the
 * right status, instead of crashing the server.
 *
 * Usage: `router.get('/foo', wrap(async (req, res) => { ... }))`
 *
 * @template T
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<T>} fn
 * @returns {import('express').RequestHandler}
 */
export function wrap(fn) {
  return async (req, res, ...rest) => {
    try {
      await fn(req, res, ...rest);
    } catch (err) {
      const status = err?.status || 500;
      res.status(status).json({
        error: err?.code || 'internal_error',
        message: err?.message || String(err),
      });
    }
  };
}
