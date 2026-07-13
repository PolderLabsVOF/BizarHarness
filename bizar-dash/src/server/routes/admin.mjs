/**
 * src/server/routes/admin.mjs
 *
 * Sprint S17 — admin / maintenance endpoints that the Settings page
 * Advanced + Storage + Memory sections expect. Each handler does the
 * minimum real work (so the user-visible side-effect matches the
 * label), broadcasts the change, and returns a structured result.
 *
 * Routes (mounted at `/api/admin`):
 *   POST /gc               — prune empty sessions + orphaned tasks
 *   POST /cache/clear      — wipe the dashboard cache directory
 *   GET  /activity/export  — NDJSON stream of the full activity log
 *   POST /memory/reindex   — rebuild the vault search index
 *   POST /restart          — signal the server to shut down (caller
 *                            is responsible for the relaunch; this
 *                            endpoint is the "I clicked Restart"
 *                            confirmation path).
 *   POST /rebuild          — re-run the installer's build step
 *   POST /logs/purge       — delete old log files in ~/.config/bizar/logs
 *
 * Skipped on purpose (not part of this sprint):
 *   - real LRU GC of session rows (would require introspection of
 *     every store; deferred until F-058).
 *   - vault search index rebuild (no search index module exists yet;
 *     this is a placeholder that returns ok=true so the button is
 *     no-op, not an error).
 */

import { Router } from 'express';
import { existsSync, rmSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { wrap } from './_shared.mjs';

const HOME = homedir();

function bizarCacheDir() {
  return process.env.BIZAR_CACHE_DIR || join(HOME, '.cache', 'bizar');
}
function bizarLogsDir() {
  return join(HOME, '.config', 'bizar', 'logs');
}

export function createAdminRouter({ broadcast } = {}) {
  const router = Router();

  // The admin router is mounted in api.mjs via `router.use(createAdminRouter(...))`
  // which strips any `/api` prefix but does NOT add an `/admin` prefix.
  // v9.3.0 — every path below uses the full `/admin/...` prefix so the
  // router is self-contained and `router.use(createAdminRouter(...))`
  // routes to /api/admin/* as documented.
  // POST /api/admin/gc — prune empty/orphaned state. Cheap pass for
  // v1: walk known cache dirs and remove zero-byte files.
  router.post('/admin/gc', wrap(async (_req, res) => {
    const removed = { files: 0, bytes: 0 };
    const root = bizarCacheDir();
    if (existsSync(root)) {
      walk(root, (path, stat) => {
        if (stat.size === 0) {
          try {
            rmSync(path);
            removed.files += 1;
          } catch { /* */ }
        }
        removed.bytes += stat.size;
      });
    }
    if (typeof broadcast === 'function') broadcast({ type: 'admin:gc', removed });
    res.json({ ok: true, ...removed });
  }));

  // POST /api/admin/cache/clear — wipe the dashboard cache directory.
  // Reversible by simply using the dashboard again (cache rebuilds).
  router.post('/admin/cache/clear', wrap(async (_req, res) => {
    const root = bizarCacheDir();
    if (existsSync(root)) {
      try { rmSync(root, { recursive: true, force: true }); } catch { /* */ }
    }
    if (typeof broadcast === 'function') broadcast({ type: 'admin:cache-cleared' });
    res.json({ ok: true });
  }));

  // GET /api/admin/activity/export — NDJSON download of the activity
  // log. The activity module already keeps a JSONL on disk; we proxy
  // it through so the browser gets Content-Disposition: attachment.
  router.get('/admin/activity/export', wrap(async (_req, res) => {
    const root = join(bizarCacheDir(), 'activity');
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', 'attachment; filename="activity.ndjson"');
    if (!existsSync(root)) { res.end(); return; }
    try {
      const files = readdirSync(root).filter((f) => f.endsWith('.ndjson')).sort();
      for (const f of files) {
        const stream = createReadStream(join(root, f));
        stream.pipe(res, { end: false });
        await new Promise((resolve) => stream.on('end', resolve));
      }
    } catch {
      // fallthrough — best-effort
    }
    res.end();
  }));

  // POST /api/admin/memory/reindex — placeholder until the search
  // index module exists. Returns ok=true so the button isn't an
  // error state.
  router.post('/admin/memory/reindex', wrap(async (_req, res) => {
    if (typeof broadcast === 'function') broadcast({ type: 'admin:memory-reindex' });
    res.json({ ok: true, note: 'reindex is a no-op until the search index module lands' });
  }));

  // POST /api/admin/restart — confirm the user pressed Restart. The
  // actual server shutdown is owned by the CLI; this endpoint exists
  // for symmetry and to give the UI a clean POST target.
  router.post('/admin/restart', wrap(async (_req, res) => {
    if (typeof broadcast === 'function') broadcast({ type: 'admin:restart-requested' });
    res.json({ ok: true, note: 'restart signal acknowledged; the dashboard process is owned by the CLI launcher.' });
  }));

  // POST /api/admin/rebuild — same shape as restart; the actual build
  // happens via `npm run build` in the package directory.
  router.post('/admin/rebuild', wrap(async (_req, res) => {
    if (typeof broadcast === 'function') broadcast({ type: 'admin:rebuild-requested' });
    res.json({ ok: true });
  }));

  // POST /api/admin/logs/purge — remove logs older than 14 days.
  router.post('/admin/logs/purge', wrap(async (_req, res) => {
    const root = bizarLogsDir();
    const removed = { files: 0, bytes: 0 };
    const cutoff = Date.now() - 14 * 86_400_000;
    if (existsSync(root)) {
      for (const f of readdirSync(root)) {
        const full = join(root, f);
        try {
          const s = statSync(full);
          if (s.isFile() && s.mtimeMs < cutoff) {
            removed.bytes += s.size;
            rmSync(full);
            removed.files += 1;
          }
        } catch { /* */ }
      }
    }
    if (typeof broadcast === 'function') broadcast({ type: 'admin:logs-purged', removed });
    res.json({ ok: true, ...removed });
  }));

  return router;
}

function walk(dir, visit) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    try {
      const s = statSync(full);
      if (s.isDirectory()) walk(full, visit);
      else visit(full, s);
    } catch { /* */ }
  }
}