/**
 * src/server/routes/claude-sessions.mjs
 *
 * v6.3.0 — Claude Code-native sessions CRUD endpoints.
 *
 *   GET    /api/claude-sessions          — list sessions on disk
 *   POST   /api/claude-sessions/new      — create a new Claude Code session
 *   PATCH  /api/claude-sessions/:id      — rename / update a session
 *   DELETE /api/claude-sessions/:id      — delete a session's on-disk dir
 *
 * Replaces routes/cline-sessions.mjs (which read from
 * `~/.local/share/cline/cline.db`). Claude Code stores sessions as
 * JSONL files under `~/.claude/sessions/<sessionId>/messages.jsonl`,
 * so this router:
 *
 *   - Lists sessions by walking `~/.claude/sessions/` and reading
 *     each `messages.jsonl`'s init line.
 *   - Creates sessions by spawning `claude -p "<prompt>"` via
 *     `claude-runner.mjs`.
 *   - Renames / updates by writing a `meta.json` next to the JSONL
 *     (Claude Code doesn't have a PATCH endpoint — the title is
 *     derived from the first user message at list time, so we
 *     override it with a sidecar `meta.json` that `claude-info.mjs`
 *     prefers when present).
 *   - Deletes by `rm -rf` the session directory.
 *
 * The HTTP API surface stays compatible with the old
 * cline-sessions.mjs contract so the React frontend doesn't have to
 * change — only the path prefix is updated (`/api/cline-sessions/*`
 * → `/api/claude-sessions/*`).
 */

import { Router } from 'express';
import { SpanStatusCode } from '@opentelemetry/api';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { wrap } from './_shared.mjs';
import { tracer } from '../otel.mjs';
import {
  CLAUDE_SESSIONS_DIR,
  listClaudeSessions,
  deleteClaudeSession,
} from '../claude-info.mjs';

const HOME = homedir();

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const AGENT_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TITLE_MAX = 200;

/**
 * Path to a per-session `meta.json` sidecar. Claude Code doesn't
 * expose a rename endpoint, so the dashboard persists user-set
 * titles in this file. {@link listClaudeSessions} prefers the
 * sidecar title when present.
 */
function metaFileFor(sessionId) {
  return join(CLAUDE_SESSIONS_DIR, sessionId, 'meta.json');
}

/**
 * Read the sidecar meta.json (if any). Returns `{}` on any failure.
 */
function readMeta(sessionId) {
  try {
    const fp = metaFileFor(sessionId);
    if (!existsSync(fp)) return {};
    return JSON.parse(readFileSync(fp, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Create a new Claude Code session via `claude -p "<prompt>"`.
 * Returns `{ ok, sessionId, error? }`.
 *
 * @param {{ title?: string, agent: string, prompt: string, worktree?: string, model?: string }} opts
 * @returns {Promise<{ ok: boolean, sessionId?: string, error?: string }>}
 */
async function createClaudeSession(opts) {
  const { spawnAgent } = await import('../claude-runner.mjs');
  const worktree = opts.worktree && opts.worktree.trim() ? opts.worktree.trim() : HOME;
  const title = (opts.title || `Chat: ${opts.agent}`).slice(0, TITLE_MAX);
  // We use `claude -p` (print mode, runs to completion) so the
  // dashboard gets a real sessionId back. For long-running sessions
  // the dashboard should use the bg-spawner instead.
  const result = await spawnAgent({
    prompt: opts.prompt,
    agent: opts.agent,
    worktree,
    title,
    logPath: join(CLAUDE_SESSIONS_DIR, '_new', `${Date.now()}.log`),
    model: opts.model,
  });
  if (!result.ok || !result.sessionId) {
    return { ok: false, error: result.error || 'claude session spawn failed' };
  }
  return { ok: true, sessionId: result.sessionId };
}

/**
 * Persist a sidecar meta.json for a session so subsequent lists
 * pick up the user-set title without re-parsing the JSONL.
 *
 * @param {string} sessionId
 * @param {object} patch
 */
function writeMeta(sessionId, patch) {
  const cur = readMeta(sessionId);
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  const dir = join(CLAUDE_SESSIONS_DIR, sessionId);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(metaFileFor(sessionId), JSON.stringify(next, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {import('express').Router}
 */
export function createClaudeSessionsRouter() {
  const router = Router();

  // GET /api/claude-sessions
  router.get('/claude-sessions', wrap(async (_req, res) => {
    try {
      const sessions = listClaudeSessions();
      // Overlay the sidecar meta.json titles so user-renamed sessions
      // show up correctly in the rail.
      const enriched = sessions.map((s) => {
        const meta = readMeta(s.id);
        return {
          id: s.id,
          title: meta.title || s.title,
          model: s.model,
          created: s.createdAt,
          updated: s.updatedAt,
          mtime: s.updatedAt,
        };
      });
      res.json({ sessions: enriched });
    } catch (err) {
      res.json({ sessions: [], error: err instanceof Error ? err.message : String(err) });
    }
  }));

  // POST /api/claude-sessions/new
  router.post('/claude-sessions/new', wrap(async (req, res) => {
    return tracer.startActiveSpan('claude.session.create', async (span) => {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const title = typeof body.title === 'string' && body.title.trim().length > 0
          ? body.title.trim().slice(0, TITLE_MAX)
          : null;
        const agent = typeof body.agent === 'string' ? body.agent.trim() : '';
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        const directory = typeof body.directory === 'string' && body.directory.length > 0
          ? body.directory
          : '';
        const model = typeof body.model === 'string' ? body.model.trim() : '';
        span.setAttribute('claude.session.agent', agent);
        span.setAttribute('claude.session.title_length', title === null ? 0 : title.length);

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
        if (!prompt) {
          res.status(400).json({ error: 'bad_request', message: '`prompt` is required to seed a new session' });
          return;
        }
        const finalTitle = title || `Chat: ${agent}`;
        const result = await createClaudeSession({
          title: finalTitle,
          agent,
          prompt,
          worktree: directory,
          model,
        });
        if (!result.ok || !result.sessionId) {
          res.status(502).json({ error: 'claude_error', message: result.error || 'failed to create claude session' });
          return;
        }
        // Persist the user-set title into the sidecar meta.json so the
        // next list call surfaces it without re-parsing JSONL.
        writeMeta(result.sessionId, { title: finalTitle, agent });
        span.setAttribute('claude.session.id', result.sessionId);
        res.status(201).json({
          id: result.sessionId,
          title: finalTitle,
          agent,
          directory,
          createdAt: Date.now(),
        });
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        throw err;
      } finally {
        span.end();
      }
    });
  }));

  // PATCH /api/claude-sessions/:id
  router.patch('/claude-sessions/:id', wrap(async (req, res) => {
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
    if (!existsSync(join(CLAUDE_SESSIONS_DIR, sessionId))) {
      res.status(404).json({ error: 'not_found', message: `session ${sessionId} not found` });
      return;
    }
    writeMeta(sessionId, { title });
    res.json({ id: sessionId, title });
  }));

  // DELETE /api/claude-sessions/:id
  router.delete('/claude-sessions/:id', wrap(async (req, res) => {
    const sessionId = String(req.params?.id || '');
    if (!SESSION_ID_RE.test(sessionId)) {
      res.status(400).json({ error: 'bad_request', message: 'invalid session id' });
      return;
    }
    const r = deleteClaudeSession(sessionId);
    if (!r.ok) {
      res.status(502).json({ error: 'claude_error', message: r.error || 'delete failed' });
      return;
    }
    res.json({ id: sessionId, deleted: true });
  }));

  // F-040 — POST /api/claude-sessions/:id/kill: best-effort kill
  // of the underlying `claude --bg` instance for a session id.
  // Returns `{ ok: true, note: 'not_alive' | 'killed' }`. The
  // on-disk JSONL is left untouched — the bg-spawner registry is
  // the source of truth for "is this session alive".
  router.post('/claude-sessions/:id/kill', wrap(async (req, res) => {
    const sessionId = String(req.params?.id || '');
    if (!SESSION_ID_RE.test(sessionId)) {
      res.status(400).json({ error: 'bad_request', message: 'invalid session id' });
      return;
    }
    try {
      const bg = await import('../claude-bg-spawner.mjs');
      const rec = bg.findBgBySessionId(sessionId);
      if (!rec) {
        res.json({ ok: true, sessionId, note: 'not_alive' });
        return;
      }
      if (rec.endedAt) {
        res.json({ ok: true, sessionId, note: 'not_alive' });
        return;
      }
      const result = await bg.killBgAgent(rec.instanceId, {});
      res.json({ ok: !!result?.ok, sessionId, ...(result || {}) });
    } catch (err) {
      res.status(500).json({
        error: 'kill_failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }));

  return router;
}
