/**
 * src/server/routes/fs.mjs
 *
 * GET  /api/fs?path=<absolute>            — list directory entries
 * POST /api/fs/mkdir                      — create a new subdirectory
 *
 * Read-only filesystem browser for the Add Project dialog. The
 * frontend passes an absolute path; the server resolves it against
 * the allow-list (`os.homedir()` + the user's configured
 * `dashboard.projectsDirectory` + each entry in
 * `dashboard.allowedRoots`) and returns the immediate children.
 *
 * Security boundaries:
 *   - Only absolute, resolved paths under an allowed root are
 *     honoured. Anything else returns 403.
 *   - First-level dotdirs under home (`.ssh`, `.aws`, `.gnupg`,
 *     …) are silently skipped in listings and refused as roots.
 *   - The GET endpoint never writes to disk. The POST endpoint
 *     creates exactly one new directory; nothing else.
 *   - All filesystem errors map to structured JSON, never an
 *     unhandled exception.
 *   - GET responses are capped at `MAX_ENTRIES` so a directory
 *     with millions of children (a `node_modules` clone, a Go
 *     module cache) cannot OOM the browser.
 */
import { Router } from 'express';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { wrap, readSettings } from './_shared.mjs';
import {
  resolveSafePath,
  buildAllowedRootsFromSettings,
} from '../lib/path-safe.mjs';

/**
 * v3.11.0 — Hard cap on the number of entries returned by GET
 * /api/fs. Sliced (not paginated) to keep the response shape
 * stable and the round-trip cheap; the client gets a `truncated`
 * flag so it can show "showing 500 of N" feedback.
 */
const MAX_ENTRIES = 500;

/**
 * v3.11.0 — Hard cap on the new-directory name length. 255 chars
 * matches the typical ext4/NTFS max-component limit; longer names
 * are almost certainly a bug or an attack.
 */
const MAX_NAME_LENGTH = 255;

/**
 * Build the per-request allow-list. We always include `os.homedir()`,
 * and additionally include every entry in `settings.dashboard.allowedRoots`
 * plus `settings.dashboard.projectsDirectory` — but only after
 * re-validating each one against home so a tampered settings file
 * can't widen the boundary.
 *
 * @returns {string[]}
 */
function buildAllowedRoots() {
  const settings = readSettings();
  return buildAllowedRootsFromSettings({
    settings: settings.data,
    home: homedir(),
  });
}

/**
 * Decide whether a given directory entry should be visible to the
 * file browser. We hide dotfiles / dotdirs at every depth — keeps
 * the browser focused on real user-visible projects and prevents
 * accidental click-throughs into things like `node_modules/.cache`.
 *
 * (Dotdir *roots* under home are blocked at a different layer by
 * resolveSafePath; this is the in-listing filter.)
 *
 * @param {string} name
 * @returns {boolean}
 */
function isHiddenEntry(name) {
  return typeof name === 'string' && name.startsWith('.');
}

/**
 * Sort entries: directories first (case-insensitive), then files
 * (case-insensitive). Stable for ties.
 *
 * @param {{ isDir: boolean, name: string }[]} entries
 */
function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

/**
 * v3.11.0 — Validate a new-directory name. Defense in depth: the
 * frontend should validate too, but the server is the boundary.
 *
 * Returns `null` on success, or a human-readable error message on
 * failure. Designed to surface as `400 { error: "bad_request",
 * message }` to the client.
 *
 * Rules:
 *   - must be a non-empty string
 *   - length 1..255
 *   - must NOT be `.` or `..`
 *   - must NOT start with `-` (could be confused with a CLI flag)
 *   - must NOT contain `/`, `\`, NUL, `:`, `*`, `?`, `"`, `<`, `>`, `|`
 *
 * @param {unknown} name
 * @returns {string | null}
 */
function validateDirName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return 'name is required';
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `name is too long (max ${MAX_NAME_LENGTH} characters)`;
  }
  if (name === '.' || name === '..') {
    return 'name may not be "." or ".."';
  }
  if (name.startsWith('-')) {
    return 'name may not start with "-"';
  }
  // Denylist of characters that have a special meaning on the shell,
  // Windows, or POSIX paths. Listed as discrete substrings (some are
  // multi-character escapes) for an explicit denylist with clear
  // error messages.
  const denylist = ['/', '\\', '\0', ':', '*', '?', '"', '<', '>', '|'];
  for (const c of denylist) {
    if (name.includes(c)) {
      return `name may not contain "${c}"`;
    }
  }
  return null;
}

/**
 * v3.11.0 — Build the absolute path of the would-be new directory,
 * verifying it remains inside the allow-list. A symlink or
 * pre-existing weirdness in the parent could in principle make
 * `path.join` produce a target that escapes; the re-check is
 * cheap and prevents the race.
 *
 * @param {string} safeParent
 * @param {string} name
 * @param {string[]} allowedRoots
 * @returns {string | null}
 */
function resolveTargetUnderParent(safeParent, name, allowedRoots) {
  const target = join(safeParent, name);
  return resolveSafePath(target, allowedRoots);
}

/**
 * @param {object} deps
 * @param {object} deps.state
 * @returns {import('express').Router}
 */
export function createFsRouter({ state }) {
  const router = Router();

  router.get('/fs', wrap(async (req, res) => {
    const requested = typeof req.query.path === 'string' ? req.query.path : '';
    const allowedRoots = buildAllowedRoots();
    const safe = resolveSafePath(requested, allowedRoots);
    if (!safe) {
      res.status(403).json({
        error: 'forbidden',
        message: 'path is outside the allowed roots (home + dashboard.projectsDirectory + dashboard.allowedRoots)',
      });
      return;
    }

    let dirStat;
    try {
      dirStat = await stat(safe);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
        res.status(403).json({ error: 'permission_denied' });
        return;
      }
      throw err;
    }

    if (!dirStat.isDirectory()) {
      res.status(400).json({ error: 'not_a_directory' });
      return;
    }

    let dirents;
    try {
      dirents = await readdir(safe, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
        res.status(403).json({ error: 'permission_denied' });
        return;
      }
      throw err;
    }

    const entries = [];
    for (const dirent of dirents) {
      const name = dirent.name;
      // Hide dotfile / dotdir entries at every depth.
      if (isHiddenEntry(name)) continue;
      const sep = safe.includes('\\') && !safe.includes('/') ? '\\' : '/';
      const entryPath = safe.endsWith(sep) ? safe + name : safe + sep + name;
      // Defaults — used when stat fails. dirent.isDirectory() is a
      // cheap, reliable indicator that does not require an extra
      // syscall, so prefer it for isDir.
      let isDir = dirent.isDirectory();
      let isSymlink = dirent.isSymbolicLink();
      try {
        // Follow the symlink (if any) so the user can see whether
        // it resolves to a real directory.
        const s = await stat(entryPath);
        if (s.isDirectory()) isDir = true;
        if (s.isSymbolicLink()) isSymlink = true;
      } catch {
        // Best-effort. Common cases:
        //  - EACCES on a sibling we can't stat (parent only readable
        //    to us, entry mode 000). Trust the dirent.
        //  - ENOENT means the entry disappeared between readdir and
        //    stat (rare race). Drop it.
        if (dirent.isSymbolicLink() && !isDir) {
          // Symlink whose target we can't read — show it as a
          // symlink, not a directory, so the user knows to be
          // careful before entering.
          isDir = false;
        }
      }
      entries.push({ name, path: entryPath, isDir, isSymlink });
    }

    const sorted = sortEntries(entries);
    const totalEntries = sorted.length;
    // v3.11.0 — Cap the response so a 50k-entry `node_modules`
    // clone cannot OOM the browser. We always include the
    // `truncated` flag (and `totalEntries`) for type stability —
    // the client can rely on the shape even when no truncation
    // happened.
    const truncated = totalEntries > MAX_ENTRIES;
    const capped = truncated ? sorted.slice(0, MAX_ENTRIES) : sorted;
    const parent = dirname(safe);
    // The "parent" we return should be null when we're already at
    // the filesystem root — Express/Node will give us '/' there.
    const isRoot = parent === safe;
    res.json({
      path: safe,
      parent: isRoot ? null : parent,
      entries: capped,
      truncated,
      totalEntries,
    });
  }));

  /**
   * v3.11.0 — Create a new directory. This is the FIRST write
   * endpoint in the file-browser surface, so it is paranoid about
   * race conditions: check-then-create (EEXIST → 409), and
   * validate the result via `stat` after creation.
   *
   * Auth: mounted under `/api`, so `requireAuth` in server.mjs
   * gates this automatically.
   *
   * Rate limiting: not yet implemented at the server side. The
   * frontend should debounce the click. Follow-up: add a per-IP
   * token bucket if abuse becomes a concern.
   */
  router.post('/fs/mkdir', wrap(async (req, res) => {
    const parent = typeof req.body?.parent === 'string' ? req.body.parent : '';
    const name = typeof req.body?.name === 'string' ? req.body.name : '';

    if (!parent) {
      res.status(400).json({
        error: 'bad_request',
        message: 'parent is required',
      });
      return;
    }

    const allowedRoots = buildAllowedRoots();

    // 1. Parent must be inside the allow-list.
    const safeParent = resolveSafePath(parent, allowedRoots);
    if (!safeParent) {
      res.status(403).json({
        error: 'forbidden',
        message: 'parent is outside the allowed roots',
      });
      return;
    }

    // 2. Name must pass the denylist validation.
    const nameError = validateDirName(name);
    if (nameError) {
      res.status(400).json({ error: 'bad_request', message: nameError });
      return;
    }

    // 3. Compute target and re-validate it is in the allow-list
    //    (defense against symlinks or pre-existing weirdness in
    //    the parent).
    const safeTarget = resolveTargetUnderParent(safeParent, name, allowedRoots);
    if (!safeTarget) {
      res.status(403).json({
        error: 'forbidden',
        message: 'target is outside the allowed roots',
      });
      return;
    }

    // 4. Parent must exist and be a directory.
    let parentStat;
    try {
      parentStat = await stat(safeParent);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        res.status(404).json({ error: 'not_found', message: 'parent does not exist' });
        return;
      }
      if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
        res.status(403).json({ error: 'permission_denied' });
        return;
      }
      throw err;
    }
    if (!parentStat.isDirectory()) {
      res.status(400).json({ error: 'not_a_directory' });
      return;
    }

    // 5. Pre-check existence (best-effort; EEXIST from mkdir is
    //    authoritative).
    try {
      await stat(safeTarget);
      res.status(409).json({
        error: 'already_exists',
        message: `an entry named "${name}" already exists in this directory`,
      });
      return;
    } catch (err) {
      if (err && err.code !== 'ENOENT') throw err;
      // ENOENT is the expected "good to go" case.
    }

    // 6. Create the directory. recursive:false — we want a flat
    //    one-level create, never a multi-level path.
    try {
      await mkdir(safeTarget, { recursive: false });
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        // Race: someone else created the dir between our stat
        // and our mkdir. Surface as 409.
        res.status(409).json({
          error: 'already_exists',
          message: `an entry named "${name}" already exists in this directory`,
        });
        return;
      }
      if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
        res.status(403).json({
          error: 'permission_denied',
          message: err.message,
        });
        return;
      }
      if (err && err.code === 'ENOSPC') {
        res.status(500).json({
          error: 'mkdir_failed',
          message: 'no space left on device',
        });
        return;
      }
      res.status(500).json({
        error: 'mkdir_failed',
        message: err?.message || String(err),
      });
      return;
    }

    // 7. Verify the result via stat. Catches a vanishingly rare
    //    race where something removed the dir between mkdir and
    //    stat, and any other weirdness (e.g. EPERM on a follow-up
    //    stat due to a mode change).
    let createdStat;
    try {
      createdStat = await stat(safeTarget);
    } catch (err) {
      res.status(500).json({
        error: 'mkdir_verify_failed',
        message: err?.message || String(err),
      });
      return;
    }
    if (!createdStat.isDirectory()) {
      res.status(409).json({
        error: 'already_exists',
        message: `an entry named "${name}" is no longer a directory`,
      });
      return;
    }

    res.status(201).json({
      path: safeTarget,
      parent: safeParent,
      name,
    });
  }));

  // Keep `state` referenced so this router follows the same factory
  // signature as the others (settings/overview/etc.). Future fs
  // operations may broadcast state changes.
  void state;

  return router;
}
