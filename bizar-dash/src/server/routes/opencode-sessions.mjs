/**
 * src/server/routes/opencode-sessions.mjs
 *
 * /api/opencode-sessions  — reads active sessions from the opencode
 * SQLite database (~/.local/share/opencode/opencode.db) and returns
 * them in a format compatible with the dashboard's session list.
 *
 * Sessions are filtered to non-archived (time_archived IS NULL) and
 * ordered by most recently updated.
 */
import { Router } from 'express';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { wrap } from './_shared.mjs';

const DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

/**
 * @returns {import('express').Router}
 */
export function createOpencodeSessionsRouter() {
  const router = Router();

  router.get('/opencode-sessions', wrap(async (_req, res) => {
    let db;
    try {
      db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
      const rows = db.prepare(`
        SELECT id, title, project_id, time_created, time_updated
        FROM session
        WHERE time_archived IS NULL
        ORDER BY time_updated DESC
        LIMIT 200
      `).all();
      return res.json({
        sessions: rows.map((r) => ({
          id: r.id,
          title: r.title,
          project: r.project_id,
          created: r.time_created,
          updated: r.time_updated,
          mtime: r.time_updated,
        })),
      });
    } catch (err) {
      // DB might not exist yet, or permissions issue — return empty list
      return res.json({ sessions: [], error: err.message });
    } finally {
      if (db) db.close();
    }
  }));

  return router;
}
