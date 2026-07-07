/**
 * src/server/lib/path-safe.mjs
 *
 * Helpers for the file-browser / scan endpoints that need to accept
 * an arbitrary absolute path from the authenticated client and decide
 * whether it is safe to operate on.
 *
 * The dashboard runs on a developer's machine, so the boundary here
 * is the user's home directory. Any path outside `os.homedir()` (and
 * any explicitly-listed additional allowed root, validated by the
 * caller) is rejected before we ever call `fs` on it.
 *
 * No `..` traversal escapes — `path.resolve` normalizes first, then
 * we check the resolved string against the allow-list.
 */
import { resolve as pathResolve, sep, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * Normalize an arbitrary list of root paths and dedupe them. Empty /
 * non-string entries are dropped silently so callers can pass
 * `readSettings().dashboard.projectsDirectory` directly.
 *
 * @param {Array<string | null | undefined>} roots
 * @returns {string[]}
 */
function normalizeRoots(roots) {
  const out = [];
  const seen = new Set();
  for (const raw of roots) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const resolved = pathResolve(trimmed);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

/**
 * Build the default allow-list: the user's home plus any explicit
 * extra roots. The caller is expected to validate the extras against
 * home before calling this (we don't try to be clever about Windows
 * reparse points, symlinks, etc. — this is a developer-tool boundary,
 * not a chroot).
 *
 * @param {object} [opts]
 * @param {string} [opts.home]           — override for `os.homedir()`
 * @param {Array<string>} [opts.extras]  — additional absolute roots (already resolved)
 * @returns {string[]}
 */
export function defaultAllowedRoots({ home, extras } = {}) {
  return normalizeRoots([home || homedir(), ...(extras || [])]);
}

/**
 * Build the per-request allow-list straight from a settings object.
 * Each configured entry is re-validated against home; entries that
 * fail validation (escape home, empty, non-string, NUL/backslash,
 * …) are silently dropped. The intent is to survive a tampered
 * settings.json: the writer (`validateDashboardSettings`) catches
 * the bad values, but the reader has to be robust against anything
 * on disk.
 *
 * Includes both:
 *   - `dashboard.allowedRoots[]` (operator-declared extras)
 *   - `dashboard.projectsDirectory` (single legacy extra)
 *
 * @param {object} opts
 * @param {Record<string, unknown> | null | undefined} opts.settings
 * @param {string} [opts.home]             — override for `os.homedir()`
 * @returns {string[]}
 */
export function buildAllowedRootsFromSettings({ settings, home } = {}) {
  const homeResolved = home || homedir();
  const extras = [];
  const configured = settings?.dashboard?.allowedRoots;
  if (Array.isArray(configured)) {
    for (const candidate of configured) {
      if (typeof candidate !== 'string' || !candidate.trim()) continue;
      const safe = resolveSafePath(candidate, [homeResolved]);
      if (safe) extras.push(safe);
      // Silently skip entries that fail validation. The Settings UI
      // (frontend) is responsible for surfacing a warning when a
      // user-typed root is silently dropped.
    }
  }
  const proj = settings?.dashboard?.projectsDirectory;
  if (typeof proj === 'string' && proj.trim()) {
    const safe = resolveSafePath(proj, [homeResolved]);
    if (safe) extras.push(safe);
  }
  return defaultAllowedRoots({ home: homeResolved, extras });
}

/**
 * Resolve and authorize a requested absolute path against an
 * allow-list of roots.
 *
 * Rules:
 *   - The input must be a non-empty string.
 *   - The path is `path.resolve()`d — `..` segments collapse.
 *   - The resolved path must be `===` to one of the allowed roots,
 *     OR live strictly beneath it (segment-aware — `pathA` does NOT
 *     count as "inside" `pathB` if `pathB` is just a prefix string).
 *   - Dotfile / dotdir roots (e.g. `~/.ssh`, `~/.aws`) are rejected
 *     even when they live under home. The frontend can still SEE them
 *     in listings (so users know the directory exists) but cannot
 *     enter them via the browser.
 *
 * Returns `null` on any failure. The caller is expected to translate
 * `null` into a 403 with a clear message.
 *
 * @param {unknown} requestedPath
 * @param {string[]} allowedRoots
 * @returns {string | null}
 */
export function resolveSafePath(requestedPath, allowedRoots) {
  if (typeof requestedPath !== 'string') return null;
  const trimmed = requestedPath.trim();
  if (!trimmed) return null;
  const resolved = pathResolve(trimmed);

  const roots = Array.isArray(allowedRoots) ? allowedRoots : [];
  for (const root of roots) {
    if (typeof root !== 'string' || !root) continue;
    const resolvedRoot = pathResolve(root);
    if (resolved === resolvedRoot) {
      if (isDotRoot(resolved)) return null;
      return resolved;
    }
    // Strict segment-aware prefix: ensure a separator boundary so
    // `/home/user/foo` is NOT considered inside `/home/user/foobar`.
    const rootWithSep = resolvedRoot.endsWith(sep)
      ? resolvedRoot
      : resolvedRoot + sep;
    if (resolved.startsWith(rootWithSep)) {
      if (isDotRoot(resolved)) return null;
      return resolved;
    }
  }
  return null;
}

/**
 * Return `true` if the path is (or lives directly inside) a dotdir
 * at the home root. We deliberately do NOT match deeper dotdirs
 * (`/home/user/projects/.secret` is fine to enter) — only the ones
 * at the top of the home tree are treated as sensitive.
 *
 * @param {string} resolvedPath
 * @param {string} [home]
 * @returns {boolean}
 */
export function isDotRoot(resolvedPath, home = homedir()) {
  if (typeof resolvedPath !== 'string') return false;
  const homeRoot = pathResolve(home);
  const homeWithSep = homeRoot.endsWith(sep) ? homeRoot : homeRoot + sep;
  if (resolvedPath === homeRoot) return false;
  if (!resolvedPath.startsWith(homeWithSep)) return false;
  const tail = resolvedPath.slice(homeWithSep.length);
  if (!tail) return false;
  // Only first-level dotdirs under home are blocked.
  const first = tail.split(sep)[0];
  return first.startsWith('.') && first.length > 1;
}

// --- Background-agent logPath reconstruction ------------------------------
//
// The plugin's `bgr_<id>.json` state files include a `logPath` field
// built as `${worktree}/.cline/log/${id}.log`. If `worktree` was
// empty or `/` when the bg instance was spawned, the resulting
// `logPath` is broken (e.g. `//.cline/log/...`) and no log file
// can ever be written. The bg-retry loop calls into this helper to
// repair the field before re-dispatching.
//
// `deriveAbsoluteBgLogPath(worktree, instanceId)` always returns an
// absolute path. It falls back to the user's home directory when
// `worktree` is missing or non-absolute. Never throws — a bad input
// produces a synthetic `~/.cache/bizar/logs/<id>.log` rather than
// crashing the retry loop.
//
// v3.11.1 — Note on log path correctness:
//   The plugin's `LogWriter` (plugins/bizar/src/report.ts:147) writes
//   to `${logDir}/${sessionId}.log` where `logDir` defaults to
//   `~/.cache/bizar/logs` (plugins/bizar/src/options.ts:88). The
//   bg-spawn tool records a DIFFERENT path —
//   `${worktree}/.cline/log/${instanceId}.log` — in the state
//   file. Nothing ever writes to that path. This module's
//   `deriveAbsoluteBgLogPath` historically returned the same broken
//   path; the new `getActualBgLogPath` below returns the path the
//   LogWriter actually writes to. Use that for any operator-facing
//   `tail -F` (e.g. the tmux wrap in task-delegator.mjs).

const FALLBACK_LOG_DIR = pathResolve(homedir(), '.cache', 'bizar', 'logs');

/**
 * Resolve the per-session log directory used by the plugin's
 * `LogWriter`. The plugin's default is `~/.cache/bizar/logs`
 * (configurable via the `logDir` option in `cline.json`). We
 * honor the `BIZAR_LOG_DIR` env var first, fall back to the
 * plugin's default, and never throw.
 *
 * @param {object} [opts]
 * @param {string} [opts.env]  — env-var bag to read (defaults to process.env)
 * @returns {string}
 */
export function getBgLogDir({ env } = {}) {
  const source = env || process.env;
  const fromEnv = source?.BIZAR_LOG_DIR;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    const resolved = pathResolve(fromEnv);
    return resolved;
  }
  return FALLBACK_LOG_DIR;
}

/**
 * Resolve the per-session log path the plugin's `LogWriter` actually
 * writes to. Use this for any operator-facing `tail -F` so the user
 * sees real activity rather than a phantom-file error.
 *
 * Important: the LogWriter keys files by SESSION id (not instance
 * id). When you only have an `instanceId` (e.g. `bg_<sessionId16>`),
 * pass it as `sessionId` — the function will accept any non-empty
 * string and sanitize it.
 *
 * @param {object} [opts]
 * @param {string} [opts.sessionId]  — the cline session id (or any unique key)
 * @param {string} [opts.env]        — env-var bag to read
 * @returns {string} absolute path that exists or will exist once the plugin writes
 */
export function getActualBgLogPath({ sessionId, env } = {}) {
  const safeId = typeof sessionId === 'string' && sessionId.length > 0
    ? sessionId.replace(/[^a-zA-Z0-9_.-]/g, '_')
    : `unknown_${randomBytes(4).toString('hex')}`;
  return pathResolve(getBgLogDir({ env }), `${safeId}.log`);
}

/**
 * @param {unknown} worktree
 * @param {string} instanceId
 * @returns {string}
 */
export function deriveAbsoluteBgLogPath(worktree, instanceId) {
  const safeId = typeof instanceId === 'string' && instanceId.length > 0
    ? instanceId.replace(/[^a-zA-Z0-9_.-]/g, '_')
    : `unknown_${randomBytes(4).toString('hex')}`;
  const base = typeof worktree === 'string' && worktree.length > 0 && isAbsolute(worktree)
    ? pathResolve(worktree)
    : FALLBACK_LOG_DIR;
  return pathResolve(base, '.cline', 'log', `${safeId}.log`);
}

/**
 * Decide whether a `logPath` value stored on a bg instance needs to
 * be repaired. A path is considered broken when it is:
 *   - not a string
 *   - empty
 *   - not absolute
 *   - contains a literal double-slash sequence (`//` outside of the
 *     protocol prefix) — a tell-tale sign of `${empty}/${...}`
 *     concatenation
 *
 * @param {unknown} logPath
 * @returns {boolean}
 */
export function isBrokenBgLogPath(logPath) {
  if (typeof logPath !== 'string' || logPath.length === 0) return true;
  if (!isAbsolute(logPath)) return true;
  // Look for `//` not at the protocol position. Cheap heuristic that
  // catches the user's `//.cline/log/...` case without requiring
  // a full URL parser.
  const idx = logPath.indexOf('//');
  if (idx === -1) return false;
  // Allow a leading `//` only on Windows-style UNC paths like `\\server\share`.
  // On POSIX, a leading `/` followed by another `/` is always broken.
  if (idx === 0) return true;
  return false;
}
