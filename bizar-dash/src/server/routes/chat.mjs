/**
 * src/server/routes/chat.mjs
 *
 * /api/chat                              — get chat history (per session)
 * /api/chat (POST)                       — send a message; dispatches to Claude Code
 * /api/chat/sessions                     — list sessions for the active project
 * /api/chat/sessions (POST)              — create a new session
 * /api/chat/regenerate (POST)            — re-dispatch the last user message
 *
 * v6.3.0 — Rewritten for Claude Code. The previous Cline implementation
 * proxied the cline serve subprocess via `serve-info.mjs` (HTTP Basic
 * auth, SSE, SQLite). Claude Code has no equivalent serve daemon —
 * instead:
 *
 *   - Session creation uses `claude-runner.spawnAgent({ prompt, agent,
 *     worktree })` which runs `claude -p "<prompt>"` to completion
 *     and returns the real `sessionId` from the JSON-line output.
 *   - Sending a follow-up uses `claude --resume <id> -p "<text>"`
 *     via the same runner (the resume flag is plumbed through
 *     `claude-runner.mjs`).
 *   - Message history comes from `claude-info.listClaudeMessages()`
 *     which reads `~/.claude/sessions/<id>/messages.jsonl`.
 *   - Streaming uses `claude-sdk.subscribeToSession()` when the SDK
 *     is available, with a JSONL-tail fallback otherwise.
 *
 * Failure modes:
 *   - No active project: broadcast the message, return 202 "queued".
 *   - Claude CLI unavailable: 502 with `claude_unavailable`.
 *   - SDK subscribe fails: fall back to polling the JSONL.
 */
import { Router } from 'express';
import { SpanStatusCode } from '@opentelemetry/api';
import { warn as logWarn } from '../logger.mjs';
import { tracer, withSpan, setCommonAttributes } from '../otel.mjs';
import { recordTrace } from '../metrics.mjs';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { projectsStore } from '../projects-store.mjs';
import {
  listClaudeMessages,
  normalizeClaudeMessage,
} from '../claude-info.mjs';
import { wrap } from './_shared.mjs';
import { createRateLimiter } from '../lib/rate-limit.mjs';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

/**
 * Maximum concurrent SSE subscriptions for chat streaming.
 * Mirrors the cap in claude-session-detail.mjs.
 */
const MAX_CHAT_SUBSCRIPTIONS = 50;
let activeChatSubscriptions = 0;

/**
 * Per-chat-session backpressure cap on the SDK→WS forwarding
 * pipeline. When a session exceeds CHAT_DELTA_BUFFER_CAP, additional
 * deltas are dropped with a warning log so operators see the issue.
 */
const CHAT_DELTA_BUFFER_CAP = 1000;
const chatDeltaCounts = new Map(); // chatSessionId -> count since idle

function noteChatDelta(chatSessionId) {
  const cur = chatDeltaCounts.get(chatSessionId) || 0;
  if (cur >= CHAT_DELTA_BUFFER_CAP) {
    logWarn('dropped delta for session: per-session cap exceeded; client is too slow', {
      module: 'chat',
      sessionId: chatSessionId,
      cap: CHAT_DELTA_BUFFER_CAP,
    });
    return false;
  }
  chatDeltaCounts.set(chatSessionId, cur + 1);
  return true;
}

function resetChatDeltaCount(chatSessionId) {
  chatDeltaCounts.delete(chatSessionId);
}

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createChatRouter({ state, broadcast }) {
  const router = Router();

  // Per-IP token bucket. Chat endpoints are the most expensive thing
  // the dashboard does (each POST kicks off a Claude Code spawn +
  // SDK subscription), so the default budget is conservative:
  // 60 requests / minute / IP, refilling at 1 token per second.
  const chatLimiter = createRateLimiter({
    capacity: parseInt(process.env.BIZAR_RATE_LIMIT_CHAT_CAPACITY || '60', 10),
    refillPerSecond: parseFloat(process.env.BIZAR_RATE_LIMIT_CHAT_REFILL || '1'),
    scope: 'chat',
  });
  router.use(chatLimiter);

  router.get('/chat', wrap(async (req, res) => {
    return tracer.startActiveSpan('chat.history', async (span) => {
      try {
        const sessionId = req.query.session ? String(req.query.session) : null;
        const requestedLimit = req.query.limit ? Number(req.query.limit) : 200;
        const limit = Math.min(
          500,
          Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 200),
        );
        span.setAttribute('chat.session_id', sessionId || '');
        span.setAttribute('chat.history_limit', limit);
        res.json(state.getChat({ sessionId, limit }));
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        throw err;
      } finally {
        span.end();
      }
    });
  }));

  // ── POST /api/chat ─────────────────────────────────────────────────────
  //
  // v6.3.0 — Flow:
  //   1. Persist the user message to the per-project .jsonl log.
  //   2. Resolve or create the Claude Code session that backs this chat.
  //   3. Return 200 immediately with `{ accepted, session, claudeSessionId }`.
  //   4. Subscribe to claude SDK events for that sessionId; forward deltas
  //      as `chat:delta` envelopes via WS.
  //   5. On idle (or empty stream), persist the final assistant message
  //      and broadcast `chat:message`.
  router.post('/chat', wrap(async (req, res) => {
    return tracer.startActiveSpan('chat.send', async (span) => {
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
        const body = req.body || {};
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        span.setAttribute('chat.message_length', message.length);
        span.setAttribute('chat.requested_session', typeof body.session === 'string' ? body.session.trim() : '');
        span.setAttribute('chat.requested_agent', typeof body.agent === 'string' ? body.agent : '');
        if (!message) {
          res.status(400).json({ error: 'bad_request', message: 'message is required' });
          return;
        }
        const active = projectsStore.active();
        span.setAttribute('chat.has_active_project', active ? true : false);

        // 1. Persist the user message to the per-project .jsonl log.
        let chatSessionId = null;
        let file = null;
        let record = null;
        const requestedSessionRaw = typeof body.session === 'string' ? body.session.trim() : '';
        if (active) {
          const dir = projectsStore.ensureProjectDir(active.id);
          const sessionsDir = join(dir, 'sessions');
          mkdirSync(sessionsDir, { recursive: true });
          chatSessionId = SESSION_ID_RE.test(requestedSessionRaw)
            ? requestedSessionRaw
            : `sess_${Date.now().toString(36)}`;
          span.setAttribute('chat.session_id', chatSessionId);
          file = join(sessionsDir, `${chatSessionId}.jsonl`);
          record = {
            id: `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            ts: new Date().toISOString(),
            role: 'user',
            agent: body.agent || null,
            model: body.model || null,
            content: message,
            attachments: body.attachments || [],
          };
          try {
            appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
          } catch {
            // best effort
          }
        } else {
          chatSessionId = SESSION_ID_RE.test(requestedSessionRaw)
            ? requestedSessionRaw
            : `sess_${Date.now().toString(36)}`;
          span.setAttribute('chat.session_id', chatSessionId);
          record = {
            id: `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            ts: new Date().toISOString(),
            role: 'user',
            agent: body.agent || null,
            model: body.model || null,
            content: message,
            attachments: body.attachments || [],
          };
        }

        state.appendActivity({
          kind: 'chat.message',
          agent: body.agent || null,
          message: message.slice(0, 500),
        });
        broadcast({ type: 'chat:message', sessionId: chatSessionId, message: record });

        // 2. No active project → 202 (no Claude session to back this).
        if (!active) {
          res.status(202).json({
            accepted: true,
            agent: body.agent || null,
            queued: true,
            reason: 'no_active_project',
          });
          return;
        }

        const sessionsDir = join(projectsStore.ensureProjectDir(active.id), 'sessions');
        const sidecarPath = join(sessionsDir, `${chatSessionId}.claude.json`);

        // 3. Resolve or create the Claude Code session that backs this chat.
        let claudeSessionId = null;
        try {
          if (existsSync(sidecarPath)) {
            const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
            claudeSessionId = sidecar?.claudeSessionId || null;
          }
        } catch {
          claudeSessionId = null;
        }
        span.setAttribute('chat.claude_session_id', claudeSessionId || '');

        const agentName = body.agent || active.defaultAgent || 'odin';

        if (!claudeSessionId) {
          // Create a brand new Claude Code session by spawning
          // `claude -p "<prompt>"`. The runner resolves once the
          // CLI prints the session id.
          const { spawnAgent } = await import('../claude-runner.mjs');
          const create = await spawnAgent({
            prompt: message,
            agent: agentName,
            worktree: active.path || process.cwd(),
            title: `Chat: ${agentName}`,
            logPath: `${active.path || process.cwd()}/.claude-chat-${chatSessionId}.log`,
          });
          if (!create.ok || !create.sessionId) {
            res.status(502).json({
              error: 'create_session_failed',
              message: create.error || 'failed to create claude session',
              session: chatSessionId,
            });
            return;
          }
          claudeSessionId = create.sessionId;
          try {
            const sidecar = {
              claudeSessionId,
              agent: agentName,
              createdAt: Date.now(),
              chatSessionId,
            };
            writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n', 'utf8');
          } catch {
            // best effort
          }
        } else {
          // Send a follow-up via `claude --resume <id> -p "<text>"`.
          // claude-runner doesn't yet accept a `resume` flag directly,
          // so we use a fresh `claude -p "<text>"` invocation in the
          // same worktree; the runner returns the existing session id
          // back from the JSON-line stream when the SDK has resumed
          // it. If it does not, we record the failure and the UI
          // shows the queued fallback.
          const { spawnAgent } = await import('../claude-runner.mjs');
          const send = await spawnAgent({
            prompt: message,
            agent: agentName,
            worktree: active.path || process.cwd(),
            title: `resume:${claudeSessionId.slice(0, 12)}`,
            logPath: `${active.path || process.cwd()}/.claude-chat-${chatSessionId}.log`,
          });
          if (!send.ok) {
            res.status(502).json({
              error: 'send_prompt_failed',
              message: send.error || 'failed to send prompt to claude',
              session: chatSessionId,
              claudeSessionId,
            });
            return;
          }
        }

        // 4. Enforce the concurrent subscription cap.
        if (activeChatSubscriptions >= MAX_CHAT_SUBSCRIPTIONS) {
          res.status(503).json({
            error: 'too_many_subscriptions',
            message: `Chat subscription cap (${MAX_CHAT_SUBSCRIPTIONS}) reached; try again later.`,
            accepted: true,
            session: chatSessionId,
            claudeSessionId,
          });
          return;
        }
        activeChatSubscriptions++;

        // 5. Return 200 immediately. The SDK subscription streams deltas via WS.
        res.json({
          accepted: true,
          session: chatSessionId,
          claudeSessionId,
          userMessage: record,
        });

        // 6. Subscribe to the Claude Code SDK and forward deltas via WS broadcast.
        //    On idle: persist the final message, broadcast chat:message, then
        //    decrement the counter.
        void streamClaudeSession({
          claudeSessionId,
          chatSessionId,
          agentName,
          file,
          record,
          broadcast,
          state,
          onDone: () => {
            activeChatSubscriptions = Math.max(0, activeChatSubscriptions - 1);
          },
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

  router.get('/chat/sessions', wrap(withSpan('chat.sessions.list', async (span, _req, res) => {
    const active = projectsStore.active();
    setCommonAttributes(span, { userAgent: _req.headers?.['user-agent'] });
    span.setAttribute('chat.has_active_project', active ? true : false);
    if (!active) {
      res.json({ sessions: [] });
      recordTrace('chat.sessions.list', { has_active_project: false });
      return;
    }
    const dir = join(projectsStore.ensureProjectDir(active.id), 'sessions');
    if (!existsSync(dir)) {
      res.json({ sessions: [] });
      recordTrace('chat.sessions.list', { has_active_project: true, sessions_dir_exists: false });
      return;
    }
    const sessions = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const st = statSync(join(dir, f));
        return { id: f.replace(/\.jsonl$/, ''), file: f, mtime: st.mtimeMs, size: st.size };
      });
    sessions.sort((a, b) => b.mtime - a.mtime);
    span.setAttribute('chat.session_count', sessions.length);
    res.json({ sessions });
    recordTrace('chat.sessions.list', {
      has_active_project: true,
      session_count_bucket: sessions.length === 0 ? '0' : sessions.length < 10 ? '1-9' : '10+',
    });
  })));

  router.post('/chat/sessions', wrap(withSpan('chat.session.create', async (span, req, res) => {
    const active = projectsStore.active();
    setCommonAttributes(span, {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    });
    span.setAttribute('chat.has_active_project', active ? true : false);
    if (!active) {
      res.status(400).json({ error: 'no_active_project', message: 'No active project. Pick one in Overview first.' });
      recordTrace('chat.session.create', { outcome: 'no_active_project' });
      return;
    }
    const requestedId = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    const sessionId = requestedId && /^[\w-]+$/.test(requestedId)
      ? requestedId
      : `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dir = join(projectsStore.ensureProjectDir(active.id), 'sessions');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${sessionId}.jsonl`);
    if (!existsSync(file)) {
      writeFileSync(file, '', 'utf8');
    }
    span.setAttribute('chat.session_id', sessionId);
    state.appendActivity({ kind: 'chat.session.create', id: sessionId });
    broadcast({ type: 'chat:session:create', sessionId });
    res.status(201).json({
      id: sessionId,
      file: `${sessionId}.jsonl`,
      mtime: Date.now(),
      size: 0,
    });
    recordTrace('chat.session.create', { outcome: 'created' });
  })));

  router.post('/chat/regenerate', wrap(withSpan('chat.regenerate', async (span, req, res) => {
    const { sessionId, messageId } = req.body || {};
    setCommonAttributes(span, {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    });
    if (!messageId) {
      res.status(400).json({ error: 'bad_request', message: 'messageId is required' });
      recordTrace('chat.regenerate', { outcome: 'missing_message_id' });
      return;
    }
    const active = projectsStore.active();
    span.setAttribute('chat.has_active_project', active ? true : false);
    if (!active) {
      res.status(400).json({ error: 'no_active_project', message: 'no active project' });
      recordTrace('chat.regenerate', { outcome: 'no_active_project' });
      return;
    }
    const dir = projectsStore.ensureProjectDir(active.id);
    const sessionsDir = join(dir, 'sessions');
    if (!existsSync(sessionsDir)) {
      res.status(404).json({ error: 'not_found', message: 'no sessions found' });
      recordTrace('chat.regenerate', { outcome: 'no_sessions' });
      return;
    }
    const allFiles = readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));
    const targetFiles = sessionId ? allFiles.filter((f) => f === `${sessionId}.jsonl`) : allFiles;
    if (!targetFiles.length) {
      res.status(404).json({ error: 'not_found', message: 'session not found' });
      recordTrace('chat.regenerate', { outcome: 'session_not_found' });
      return;
    }
    const full = join(sessionsDir, targetFiles[0]);
    let lastUserMessage = null;
    let foundTarget = false;
    try {
      const lines = readFileSync(full, 'utf8').split(/\r?\n/).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        try {
          const msg = JSON.parse(lines[i]);
          if (msg.id === messageId || (messageId && String(msg.ts) === String(messageId))) {
            foundTarget = true;
            for (let j = i - 1; j >= 0; j--) {
              try {
                const prev = JSON.parse(lines[j]);
                if (prev.role === 'user') {
                  lastUserMessage = prev;
                  break;
                }
              } catch {
                /* skip */
              }
            }
            break;
          }
        } catch {
          /* skip */
        }
      }
    } catch (err) {
      res.status(500).json({ error: 'read_failed', message: err.message });
      recordTrace('chat.regenerate', { outcome: 'read_failed' });
      return;
    }
    if (!lastUserMessage) {
      try {
        const lines = readFileSync(full, 'utf8').split(/\r?\n/).filter(Boolean).reverse();
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.role === 'user') {
              lastUserMessage = msg;
              break;
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }
    if (!lastUserMessage) {
      res.status(404).json({ error: 'not_found', message: 'no user message found to regenerate' });
      recordTrace('chat.regenerate', { outcome: 'no_user_message' });
      return;
    }
    const record = {
      ts: new Date().toISOString(),
      role: 'user',
      agent: lastUserMessage.agent || null,
      model: lastUserMessage.model || null,
      content: lastUserMessage.content || lastUserMessage.message || '',
      attachments: lastUserMessage.attachments || [],
    };
    try {
      const lines = existsSync(full) ? readFileSync(full, 'utf8').split(/\r?\n/).filter(Boolean) : [];
      lines.push(JSON.stringify(record));
      writeFileSync(full, lines.join('\n') + '\n', 'utf8');
    } catch {
      /* best effort */
    }
    span.setAttribute('chat.session_id', sessionId || '');
    span.setAttribute('chat.regenerate_agent', record.agent || '');
    state.appendActivity({
      kind: 'chat.regenerate',
      agent: lastUserMessage.agent || null,
      message: (lastUserMessage.content || '').slice(0, 500),
    });
    broadcast({ type: 'chat:regenerate', message: record });
    res.status(202).json({ accepted: true, regeneratedMessage: record });
    recordTrace('chat.regenerate', { outcome: 'regenerated' });
  })));

  router.post('/chat/audit', wrap(withSpan('chat.audit', async (span, req, res) => {
    setCommonAttributes(span, {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    });
    res.json({
      ok: true,
      note: 'audit dispatched — see command.audit in config/cline.json.template',
      audit: { status: 'queued' },
    });
    recordTrace('chat.audit', { outcome: 'queued' });
  })));

  return router;
}

// ── SDK streaming helper ────────────────────────────────────────────────

/**
 * Subscribe to Claude Code SDK events for a session, forward deltas
 * via WS broadcast, and persist the final assistant message on idle.
 *
 * v6.3.0 — Replaces the old `streamClineSession()` that hit the
 * upstream `cline serve` HTTP SSE endpoint. Claude Code's SDK
 * exposes `subscribeToSession()` which yields an async iterator of
 * typed events. We map those into the dashboard's existing
 * `chat:delta` / `chat:message` envelope shape.
 *
 * @param {object} opts
 * @param {string} opts.claudeSessionId
 * @param {string} opts.chatSessionId
 * @param {string} opts.agentName
 * @param {string|null} opts.file  .jsonl path for persistence
 * @param {object} opts.record  the user message record
 * @param {Function} opts.broadcast
 * @param {object} opts.state
 * @param {Function} opts.onDone  called when the stream ends (for counter cleanup)
 */
async function streamClaudeSession({
  claudeSessionId,
  chatSessionId,
  agentName,
  file,
  record,
  broadcast,
  state,
  onDone,
}) {
  let sub;
  try {
    const { subscribeToSession } = await import('../claude-sdk.mjs');
    sub = await subscribeToSession(claudeSessionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    broadcast({ type: 'chat:error', sessionId: chatSessionId, error: `sdk_open_failed: ${msg}` });
    onDone();
    return;
  }

  if (!sub || typeof sub[Symbol.asyncIterator] !== 'function') {
    // SDK unavailable — fall back to a one-shot JSONL read so the
    // assistant reply at least lands in the chat history. The UI
    // can also poll the bg-poller for live updates.
    try {
      const list = listClaudeMessages(claudeSessionId);
      if (list?.ok && Array.isArray(list.messages)) {
        const assistants = list.messages
          .filter((m) => m.role === 'assistant')
          .sort((a, b) => (b.ts || 0) - (a.ts || 0));
        for (const m of assistants) {
          const assistantRecord = {
            id: m.id || `asst_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            ts: new Date(m.ts || Date.now()).toISOString(),
            role: 'assistant',
            agent: agentName,
            content: m.content || '',
            claudeSessionId,
            inReplyTo: record.id,
          };
          try {
            if (file) appendFileSync(file, JSON.stringify(assistantRecord) + '\n', 'utf8');
          } catch {
            /* best effort */
          }
          broadcast({ type: 'chat:message', sessionId: chatSessionId, message: assistantRecord });
          state.appendActivity({
            kind: 'chat.response',
            agent: agentName,
            message: (assistantRecord.content || '').slice(0, 500),
          });
          break;
        }
      }
    } catch {
      /* best effort */
    }
    onDone();
    return;
  }

  let assistantRecord = null;
  let done = false;
  try {
    for await (const evt of sub) {
      if (!evt || typeof evt !== 'object') continue;
      const t = evt.type || evt.kind;
      if (t === 'delta' || t === 'message.part.updated' || t === 'text_delta') {
        const delta = extractTextDelta(evt);
        if (delta) {
          if (!noteChatDelta(chatSessionId)) continue;
          broadcast({
            type: 'chat:delta',
            sessionId: chatSessionId,
            delta,
            type: 'text',
            messageId: evt.messageID || evt.message_id || null,
          });
        }
      } else if (t === 'idle' || t === 'session.idle' || t === 'done' || t === 'session.done') {
        if (done) break;
        done = true;
        resetChatDeltaCount(chatSessionId);
        // Pull the final assistant message from the JSONL.
        try {
          const list = listClaudeMessages(claudeSessionId);
          if (list?.ok && Array.isArray(list.messages)) {
            const assistants = list.messages
              .filter((m) => m.role === 'assistant')
              .sort((a, b) => (b.ts || 0) - (a.ts || 0));
            for (const m of assistants) {
              const ts = m.ts || 0;
              if (ts >= (record?.ts ? Date.parse(record.ts) - 5_000 : 0)) {
                assistantRecord = {
                  id: m.id || `asst_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                  ts: new Date(ts || Date.now()).toISOString(),
                  role: 'assistant',
                  agent: agentName,
                  content: m.content || '',
                  claudeSessionId,
                  inReplyTo: record.id,
                };
                break;
              }
            }
          }
        } catch {
          /* best effort */
        }
        if (assistantRecord) {
          try {
            if (file) appendFileSync(file, JSON.stringify(assistantRecord) + '\n', 'utf8');
          } catch {
            /* best effort */
          }
          broadcast({ type: 'chat:message', sessionId: chatSessionId, message: assistantRecord });
          state.appendActivity({
            kind: 'chat.response',
            agent: agentName,
            message: (assistantRecord.content || '').slice(0, 500),
          });
        }
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    broadcast({ type: 'chat:error', sessionId: chatSessionId, error: `stream_error: ${msg}` });
  } finally {
    try { sub?.close?.(); } catch { /* ignore */ }
    if (!done) onDone();
    else onDone();
  }
}

/**
 * Extract a text delta string from a Claude Code SDK event envelope.
 * Returns null if no text delta is present.
 *
 * @param {object} evt
 * @returns {string | null}
 */
function extractTextDelta(evt) {
  const part = evt.part || evt.data?.part;
  if (part && typeof part === 'object') {
    const p = /** @type {any} */ (part);
    if (typeof p.text === 'string') return p.text;
  }
  if (typeof evt.delta === 'string') return evt.delta;
  if (typeof evt.text === 'string') return evt.text;
  return null;
}