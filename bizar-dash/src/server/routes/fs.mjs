/**
 * src/server/routes/fs.mjs
 *
 * /api/fs?path=<absolute>                    — list directory entries
 *
 * Read-only filesystem browser for the Add Project dialog. The
 * frontend passes an absolute path; the server resolves it against
 * the allow-list (`os.homedir()` + the user's configured
 * `dashboard.projectsDirectory`) and returns the immediate children.
 *
 * Security boundaries:
 *   - Only absolute, resolved paths under an allowed root are
 *     honoured. Anything else returns 403.
 *   - First-level dotdirs under home (`.ssh`, `.aws`, `.gnupg`,
 *     …) are silently skipped in listings and refused as roots.
 *   - The endpoint never writes to disk.
 *   - All filesystem errors map to structured JSON, never an
 *     unhandled exception.
 */
import { Router } from 'express';
import { readdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { wrap, readSettings } from './_shared.mjs';
import {
  resolveSafePath,
  defaultAllowedRoots,
} from '../lib/path-safe.mjs';

/**
 * Build the per-request allow-list. We always include `os.homedir()`,
 * and additionally include `settings.dashboard.projectsDirectory`
 * when set — but only after re-validating it against home so a
 * tampered settings file can't widen the boundary.
 *
 * @returns {string[]}
 */
function buildAllowedRoots() {
  const settings = readSettings();
  const configured = settings.data?.dashboard?.projectsDirectory;
  const extras = [];
  const home = homedir();
  if (typeof configured === 'string' && configured.trim()) {
    // Re-validate the configured projectsDirectory against home. If
    // the operator typed `/etc` or `/var`, this returns null and we
    // simply omit it — the user will see an error when they try to
    // scan and can fix the setting.
    const safe = resolveSafePath(configured, [home]);
    if (safe) extras.push(safe);
  }
  return defaultAllowedRoots({ home, extras });
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
        message: 'path is outside the allowed roots (home + dashboard.projectsDirectory)',
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
    const parent = dirname(safe);
    // The "parent" we return should be null when we're already at
    // the filesystem root — Express/Node will give us '/' there.
    const isRoot = parent === safe;
    res.json({
      path: safe,
      parent: isRoot ? null : parent,
      entries: sorted,
    });
  }));

  // Keep `state` referenced so this router follows the same factory
  // signature as the others (settings/overview/etc.). Future fs
  // operations may broadcast state changes.
  void state;

  return router;
}
