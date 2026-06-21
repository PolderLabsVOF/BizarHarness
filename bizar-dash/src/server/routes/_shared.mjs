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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { projectsStore } from '../projects-store.mjs';

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
  dashboard: { autoLaunchWeb: true },
  service: { enabled: true, autostart: false },
  about: {
    version: '3.5.9',
    homepage: 'https://github.com/DrB0rk/BizarHarness',
    license: 'MIT',
  },
  agents: {
    maxParallel: 6,
    stuckThresholdMs: 600000,
    autoRestart: true,
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
 * @param {Record<string, unknown>} data
 * @returns {{ path: string, data: Record<string, unknown>, exists: boolean }}
 */
export function writeSettings(data) {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  const merged = mergeSettings(data);
  writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return readSettings();
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