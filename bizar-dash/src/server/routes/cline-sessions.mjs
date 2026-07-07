/**
 * src/server/routes/cline-sessions.mjs
 *
 * /api/cline-sessions           — list cline sessions
 * POST /api/cline-sessions/new  — create a new cline session
 * PATCH /api/cline-sessions/:id — rename an cline session
 * DELETE /api/cline-sessions/:id — delete an cline session
 *
 * The list endpoint reads from the cline SQLite database
 * (~/.local/share/cline/cline.db). The mutating endpoints
 * talk to the cline serve child via the helpers in
 * `../serve-info.mjs` (see `createClineSession`,
 * `updateClineSession`, `deleteClineSession`).
 *
 * Both surfaces share directory-resolution logic: we discover the
 * session's directory from `listClineSessions()` and fall back to
 * `info.worktree` so a freshly created session (not yet listed) can
 * still be addressed using the active project's path or the plugin's
 * recorded cwd.
 *
 * v4.2.5 — Added POST/PATCH/DELETE so the dashboard's "New session"
 * button, the rail row menu (rename / delete), and the info-panel
 * actions all work end-to-end against the cline serve child.
 * Sessions are filtered to non-archived (time_archived IS NULL) and
 * ordered by most recently updated.
 */

import { Router } from 'express';
import { SpanStatusCode } from '@opentelemetry/api';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { wrap } from './_shared.mjs';
import { tracer } from '../otel.mjs';
import {
  readServeInfo,
  listClineSessions,
  createClineSession,
  updateClineSession,
  deleteClineSession,
} from '../serve-info.mjs';

const DB_PATH = join(homedir(), '.local', 'share', 'cline', 'cline.db');

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const AGENT_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TITLE_MAX = 200;

/**
 * Resolve the cline `directory` for a known session. Used by
 * PATCH and DELETE so a session started from any worktree is
 * addressed through its own scope.
 *
 * @param {ReturnType<typeof readServeInfo>} info
 * @param {string} sessionId
 * @returns {Promise<string|null>}
 */
async function resolveSessionDirectory(info, sessionId) {
  if (!info) return null;
  try {
    const sessions = await listClineSessions(info, 5_000);
    if (Array.isArray(sessions)) {
      const entry = sessions.find((s) => s && s.id === sessionId);
      const dir = entry?.location?.directory;
      if (typeof dir === 'string' && dir.length > 0) return dir;
    }
  } catch {
    /* fall through to worktree */
  }
  if (typeof info.worktree === 'string' && info.worktree.length > 0) {
    return info.worktree;
  }
  return null;
}

/**
 * @returns {import('express').Router}
 */
export function createClineSessionsRouter() {
  const router = Router();

  router.get('/cline-sessions', wrap(async (_req, res) => {
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

  // ── POST /api/cline-sessions/new ───────────────────────────────────
  //
  // Body: { title?: string, agent: string, directory?: string }.
  // When `directory` is omitted we use the cline plugin's recorded
  // worktree (the active project's path on disk).
  //
  // Returns 201 with `{ id, title, agent, directory, createdAt }`.
  // Returns 400 when the body is missing / invalid.
  // Returns 502 when the upstream cline serve errors.
  // Returns 503 when the cline plugin is offline.
  // ────────────────────────────────────────────────────────────────────
  router.post('/cline-sessions/new', wrap(async (req, res) => {
    return tracer.startActiveSpan('cline.session.create', async (span) => {
      let spanEnded = false;
      const finishSpan = () => {
        if (spanEnded) return;
        spanEnded = true;
        try {
          const code = res.statusCode || 0;
          if (code >= 400) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${code}` });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }
        } finally {
          span.end();
        }
      };
      res.once('finish', finishSpan);
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const title = typeof body.title === 'string' && body.title.trim().length > 0
          ? body.title.trim().slice(0, TITLE_MAX)
          : null;
        const agent = typeof body.agent === 'string' ? body.agent.trim() : '';
        span.setAttribute('cline.session.agent', agent);
        span.setAttribute('cline.session.title_length', title === null ? 0 : title.length);
        if (!agent) {
          res.status(400).json({ error: 'bad_request', message: '`agent` is required' });
          return;
        }
        if (!AGENT_NAME_RE.test(agent)) {
          res.status(400).json({ error: 'bad_request', message: '`agent` is invalid (allowed: [A-Za-z0-9_-]{1,64})' });
          return;
        }
        if (title !== null && title.length > TITLE_MAX) {
          res.status(400).json({ error: 'bad_request', message: `title too long (> ${TITLE_MAX} chars)` });
          return;
        }

        const info = readServeInfo();
        if (!info) {
          res.status(503).json({
            error: 'plugin_offline',
            message: 'cline plugin is not running',
          });
          return;
        }

        const directory = typeof body.directory === 'string' && body.directory.length > 0
          ? body.directory
          : (info.worktree || '');
        span.setAttribute('cline.session.directory', directory);

        const finalTitle = title || `Chat: ${agent}`;
        const result = await createClineSession(
          info,
          { title: finalTitle, agent },
          directory,
        );
        if (!result.ok || !result.sessionId) {
          const status = result.status === 404 ? 404 : 502;
          res.status(status).json({
            error: 'cline_error',
            message: result.error || 'failed to create cline session',
          });
          return;
        }

        span.setAttribute('cline.session.id', result.sessionId);
        res.status(201).json({
          id: result.sessionId,
          title: finalTitle,
          agent,
          directory,
          createdAt: Date.now(),
        });
      } catch (err) {
        if (!spanEnded) {
          spanEnded = true;
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          span.end();
        }
        throw err;
      }
    });
  }));

  // ── PATCH /api/cline-sessions/:id ──────────────────────────────────
  //
  // Body: { title: string } — required, non-empty, ≤ 200 chars.
  // Returns 200 with `{ id, title }` on success.
  // 400 / 404 (unknown) / 502 / 503 / 504 (timeouts).
  // ────────────────────────────────────────────────────────────────────
  router.patch('/cline-sessions/:id', wrap(async (req, res) => {
    const sessionId = String(req.params?.id || '');
    if (!SESSION_ID_RE.test(sessionId)) {
      res.status(400).json({ error: 'bad_request', message: 'invalid session id' });
      return;
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      res.status(400).json({ error: 'bad_request', message: '`title` is required (non-empty)' });
      return;
    }
    if (title.length > TITLE_MAX) {
      res.status(400).json({ error: 'bad_request', message: `title too long (> ${TITLE_MAX} chars)` });
      return;
    }

    const info = readServeInfo();
    if (!info) {
      res.status(503).json({ error: 'plugin_offline', message: 'cline plugin is not running' });
      return;
    }
    const directory = await resolveSessionDirectory(info, sessionId);
    if (!directory) {
      res.status(503).json({
        error: 'directory_unknown',
        message: 'cannot determine the cline session directory',
      });
      return;
    }

    const result = await updateClineSession(info, sessionId, { title }, directory);
    if (!result.ok) {
      const status = result.status === 404 ? 404 : 502;
      res.status(status).json({ error: 'cline_error', message: result.error || 'rename failed' });
      return;
    }
    res.json({ id: sessionId, title });
  }));

  // ── DELETE /api/cline-sessions/:id ─────────────────────────────────
  //
  // No body. Returns 200 on success or if the session was already gone.
  // 400 (invalid id) / 404 (unknown — surfaces when upstream says so) /
  // 502 / 503.
  // ────────────────────────────────────────────────────────────────────
  router.delete('/cline-sessions/:id', wrap(async (req, res) => {
    const sessionId = String(req.params?.id || '');
    if (!SESSION_ID_RE.test(sessionId)) {
      res.status(400).json({ error: 'bad_request', message: 'invalid session id' });
      return;
    }
    const info = readServeInfo();
    if (!info) {
      res.status(503).json({ error: 'plugin_offline', message: 'cline plugin is not running' });
      return;
    }
    const directory = await resolveSessionDirectory(info, sessionId);
    if (!directory) {
      res.status(503).json({
        error: 'directory_unknown',
        message: 'cannot determine the cline session directory',
      });
      return;
    }
    const result = await deleteClineSession(info, sessionId, directory);
    if (!result.ok) {
      const status = result.status === 404 ? 404 : 502;
      res.status(status).json({ error: 'cline_error', message: result.error || 'delete failed' });
      return;
    }
    res.json({ id: sessionId, deleted: true });
  }));

  return router;
}
