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
import { resolve as pathResolve, sep } from 'node:path';
import { homedir } from 'node:os';

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
