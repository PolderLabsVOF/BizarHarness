/**
 * src/server/routes/chat.mjs
 *
 * /api/chat                              — get chat history (per session)
 * /api/chat (POST)                       — send a message; dispatches to opencode plugin
 * /api/chat/sessions                     — list sessions for the active project
 * /api/chat/sessions (POST)              — create a new session
 * /api/chat/regenerate (POST)            — re-dispatch the last user message
 *
 * v0.1.0 — POST /api/chat now streams tokens in real time via SSE.
 * Instead of polling for up to 90s, the handler:
 *   1. Persists the user message + resolves/creates the opencode session (unchanged).
 *   2. Returns 200 immediately with `{ accepted, session, opencodeSessionId }`.
 *   3. Subscribes to opencode's SSE `/event?directory=…` filtered by sessionID.
 *   4. Streams `message.part.updated` deltas over the WebSocket as `chat:delta` envelopes.
 *   5. On `session.idle`, persists the final assistant message and broadcasts
 *      `chat:message`, then closes the subscription.
 *
 * Failure modes:
 *   - No active project: broadcast the message, return 202 "queued" (unchanged).
 *   - No serve-info: same queued fallback (unchanged).
 *   - Upstream SSE error: clean up and return without crashing.
 */
import { Router } from 'express';
import { SpanStatusCode } from '@opentelemetry/api';
import { warn as logWarn } from '../logger.mjs';
import { tracer } from '../otel.mjs';
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
  readServeInfo,
  createOpencodeSession,
  sendOpencodePrompt,
  listOpencodeMessages,
  extractContentFromOpencodeMessage,
  unwrapOpencodeSseEvent,
  buildAuthHeader,
} from '../serve-info.mjs';
import { wrap } from './_shared.mjs';
import { createRateLimiter } from '../lib/rate-limit.mjs';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

/**
 * Maximum concurrent SSE subscriptions for chat streaming.
 * Mirrors the cap in opencode-session-detail.mjs.
 */
const MAX_CHAT_SUBSCRIPTIONS = 50;
let activeChatSubscriptions = 0;

/**
 * v5.0.0 — Bug S3: per-chat-session backpressure cap on the SSE→WS
 * forwarding pipeline. The upstream SSE can pump deltas faster than
 * the WS broadcast can flush them if a connected WS client is slow.
 * `safeSend()` in server.mjs already terminates slow WS clients based
 * on the byte-level `bufferedAmount`, but we also need a defensive
 * message-count cap so a single chat session can't accumulate an
 * unbounded number of queued deltas in this process. When a session
 * exceeds CHAT_DELTA_BUFFER_CAP, additional deltas are dropped with
 * a warning log so operators see the issue.
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

  // v4.8.0 — Per-IP token bucket. Chat endpoints are the most expensive
  // thing the dashboard does (each POST kicks off an SSE subscription +
  // opencode prompt dispatch), so the default budget is conservative:
  // 60 requests / minute / IP, refilling at 1 token per second.
  // Operators can tune via BIZAR_RATE_LIMIT_CHAT_CAPACITY /
  // BIZAR_RATE_LIMIT_CHAT_REFILL.
  const chatLimiter = createRateLimiter({
    capacity: parseInt(process.env.BIZAR_RATE_LIMIT_CHAT_CAPACITY || '60', 10),
    refillPerSecond: parseFloat(process.env.BIZAR_RATE_LIMIT_CHAT_REFILL || '1'),
    scope: 'chat',
  });
  router.use(chatLimiter);

  // v4.9.0 — Wrap chat reads in a span. Status flips to ERROR only on
  // thrown errors; a 200 with empty history is still OK. We bind the
  // session id up front so a trace collector can filter by chat
  // session across the SSE pump span opened further downstream.
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
  // Flow (changes from v0.1.0):
  //   1-4: unchanged (persist user message, resolve/opencode session, POST prompt).
  //   5: Instead of polling, subscribe to SSE and stream deltas via WS.
  //   6: On session.idle, persist + broadcast final message, return 200.
  //
  // v4.9.0 — POST /api/chat now runs entirely inside a 'chat.send'
  // span. The span's status is driven by the final HTTP status code
  // (captured via `res.on('finish')`), so every early-return branch —
  // 202 queued fallback, 502 upstream error, 503 subscription cap,
  // 400 missing message — automatically lands on the right span
  // status. The async SSE pump launched at the tail of the handler is
  // intentionally NOT parented to this span: that work continues for
  // seconds after the response flushes, and riding one span for the
  // whole pump would defeat the point of distributed tracing.
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

        // 2. No active project → legacy 202.
        if (!active) {
          res.status(202).json({
            accepted: true,
            agent: body.agent || null,
            queued: true,
            reason: 'no_active_project',
          });
          return;
        }

        // 3. No plugin running → queued fallback.
        const serveInfo = readServeInfo();
        if (!serveInfo) {
          res.status(202).json({
            accepted: true,
            agent: body.agent || null,
            queued: true,
            session: chatSessionId,
            reason: 'plugin_offline',
          });
          return;
        }

        const sessionsDir = join(projectsStore.ensureProjectDir(active.id), 'sessions');
        const sidecarPath = join(sessionsDir, `${chatSessionId}.opencode.json`);

        // 4. Resolve or create the opencode session that backs this chat.
        let opencodeSessionId = null;
        try {
          if (existsSync(sidecarPath)) {
            const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
            opencodeSessionId = sidecar?.opencodeSessionId || null;
          }
        } catch {
          opencodeSessionId = null;
        }
        span.setAttribute('chat.opencode_session_id', opencodeSessionId || '');

        if (!opencodeSessionId) {
          const agentName = body.agent || active.defaultAgent || 'odin';
          const create = await createOpencodeSession(
            serveInfo,
            { title: `Chat: ${agentName}`, agent: agentName },
            active.path || serveInfo.worktree,
          );
          if (!create.ok || !create.sessionId) {
            res.status(502).json({
              error: 'create_session_failed',
              message: create.error || 'failed to create opencode session',
              session: chatSessionId,
            });
            return;
          }
          opencodeSessionId = create.sessionId;
          try {
            const sidecar = {
              opencodeSessionId,
              agent: agentName,
              createdAt: Date.now(),
              chatSessionId,
            };
            writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n', 'utf8');
          } catch {
            // best effort
          }
        }

        // 5. POST the prompt.
        const agentName = body.agent || active.defaultAgent || 'odin';
        const send = await sendOpencodePrompt(
          serveInfo,
          {
            sessionId: opencodeSessionId,
            agent: agentName,
            text: message,
            messageID: record.id,
          },
          active.path || serveInfo.worktree,
        );
        if (!send.ok) {
          res.status(502).json({
            error: 'send_prompt_failed',
            message: send.error || 'failed to send prompt to opencode',
            session: chatSessionId,
            opencodeSessionId,
          });
          return;
        }

        // 6. Enforce the concurrent subscription cap.
        if (activeChatSubscriptions >= MAX_CHAT_SUBSCRIPTIONS) {
          res.status(503).json({
            error: 'too_many_subscriptions',
            message: `Chat subscription cap (${MAX_CHAT_SUBSCRIPTIONS}) reached; try again later.`,
            accepted: true,
            session: chatSessionId,
            opencodeSessionId,
          });
          return;
        }
        activeChatSubscriptions++;

        // 7. Return 200 immediately. The SSE subscription streams deltas via WS.
        res.json({
          accepted: true,
          session: chatSessionId,
          opencodeSessionId,
          userMessage: record,
        });

        // 8. Subscribe to opencode SSE and forward deltas via WS broadcast.
        //    On session.idle: persist the final message, broadcast chat:message,
        //    then decrement the counter.
        void streamOpencodeSession({
          serveInfo,
          opencodeSessionId,
          directory: active.path || serveInfo.worktree,
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
          // Errors caught here propagate to `wrap()`, which writes
          // an error JSON response and triggers `res.on('finish')`
          // later. We must end the span NOW (before rethrowing) so
          // finishSpan sees `spanEnded === true` and skips its own
          // end — calling span.end() twice is invalid in the OTel
          // API.
          spanEnded = true;
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          span.end();
        }
        throw err;
      }
    });
  }));

  router.get('/chat/sessions', wrap(async (_req, res) => {
    const active = projectsStore.active();
    if (!active) {
      res.json({ sessions: [] });
      return;
    }
    const dir = join(projectsStore.ensureProjectDir(active.id), 'sessions');
    if (!existsSync(dir)) {
      res.json({ sessions: [] });
      return;
    }
    const sessions = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const st = statSync(join(dir, f));
        return { id: f.replace(/\.jsonl$/, ''), file: f, mtime: st.mtimeMs, size: st.size };
      });
    sessions.sort((a, b) => b.mtime - a.mtime);
    res.json({ sessions });
  }));

  router.post('/chat/sessions', wrap(async (req, res) => {
    const active = projectsStore.active();
    if (!active) {
      res.status(400).json({ error: 'no_active_project', message: 'No active project. Pick one in Overview first.' });
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
    state.appendActivity({ kind: 'chat.session.create', id: sessionId });
    broadcast({ type: 'chat:session:create', sessionId });
    res.status(201).json({
      id: sessionId,
      file: `${sessionId}.jsonl`,
      mtime: Date.now(),
      size: 0,
    });
  }));

  router.post('/chat/regenerate', wrap(async (req, res) => {
    const { sessionId, messageId } = req.body || {};
    if (!messageId) {
      res.status(400).json({ error: 'bad_request', message: 'messageId is required' });
      return;
    }
    const active = projectsStore.active();
    if (!active) {
      res.status(400).json({ error: 'no_active_project', message: 'no active project' });
      return;
    }
    const dir = projectsStore.ensureProjectDir(active.id);
    const sessionsDir = join(dir, 'sessions');
    if (!existsSync(sessionsDir)) {
      res.status(404).json({ error: 'not_found', message: 'no sessions found' });
      return;
    }
    const allFiles = readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));
    const targetFiles = sessionId ? allFiles.filter((f) => f === `${sessionId}.jsonl`) : allFiles;
    if (!targetFiles.length) {
      res.status(404).json({ error: 'not_found', message: 'session not found' });
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
    state.appendActivity({
      kind: 'chat.regenerate',
      agent: lastUserMessage.agent || null,
      message: (lastUserMessage.content || '').slice(0, 500),
    });
    broadcast({ type: 'chat:regenerate', message: record });
    res.status(202).json({ accepted: true, regeneratedMessage: record });
  }));

  router.post('/chat/audit', wrap(async (req, res) => {
    res.json({
      ok: true,
      note: 'audit dispatched — see command.audit in config/opencode.json.template',
      audit: { status: 'queued' },
    });
  }));

  return router;
}

// ── SSE streaming helper ──────────────────────────────────────────────────────

/**
 * Subscribe to opencode's SSE stream for a session, forward deltas via WS
 * broadcast, and persist the final assistant message on idle.
 *
 * @param {object} opts
 * @param {import('../serve-info.mjs').ServeInfo} opts.serveInfo
 * @param {string} opts.opencodeSessionId
 * @param {string} opts.directory
 * @param {string} opts.chatSessionId
 * @param {string} opts.agentName
 * @param {string|null} opts.file  .jsonl path for persistence
 * @param {object} opts.record  the user message record
 * @param {Function} opts.broadcast
 * @param {object} opts.state
 * @param {Function} opts.onDone  called when the stream ends (for counter cleanup)
 */
async function streamOpencodeSession({
  serveInfo,
  opencodeSessionId,
  directory,
  chatSessionId,
  agentName,
  file,
  record,
  broadcast,
  state,
  onDone,
}) {
  const upstreamUrl = `${serveInfo.baseUrl}/event?directory=${encodeURIComponent(directory || '')}`;
  const auth = buildAuthHeader(serveInfo);
  const controller = new AbortController();

  let upstream;
  try {
    upstream = fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: auth,
      },
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    broadcast({
      type: 'chat:error',
      sessionId: chatSessionId,
      error: `upstream_open_failed: ${msg}`,
    });
    onDone();
    return;
  }

  let assistantRecord = null;
  let done = false;

  void (async () => {
    try {
      const r = await upstream;
      if (!r.ok || !r.body) {
        const msg = `upstream_status: ${r.status}`;
        broadcast({ type: 'chat:error', sessionId: chatSessionId, error: msg });
        onDone();
        return;
      }
      await pumpSseForChat(r.body, controller, opencodeSessionId, {
        onDelta(envelope) {
          // Forward text part deltas as chat:delta
          const textDelta = extractTextDelta(envelope);
          if (textDelta) {
            // Bug S3 — drop the delta (with warning) if this session
            // has hit the per-connection cap. The upstream SSE pump
            // continues, but we stop forwarding to WS to avoid
            // unbounded buffering here.
            if (!noteChatDelta(chatSessionId)) return;
            broadcast({
              type: 'chat:delta',
              sessionId: chatSessionId,
              delta: textDelta.delta,
              type: 'text',
              messageId: envelope.messageID || null,
            });
          }
        },
        onIdle(envelope) {
          if (done) return;
          done = true;
          // Bug S3 — release the per-session delta counter on idle so
          // the next prompt starts with a fresh budget.
          resetChatDeltaCount(chatSessionId);
          // Fetch the final message list and extract the assistant reply.
          void (async () => {
            try {
              const list = await listOpencodeMessages(
                serveInfo,
                opencodeSessionId,
                directory,
              );
              if (list?.ok && Array.isArray(list.messages)) {
                const promptSentAt = Date.now() - 5_000; // buffer for clock skew
                const assistants = list.messages
                  .filter((m) => (m?.info?.role || m?.role) === 'assistant')
                  .sort((a, b) => {
                    const ta = a?.info?.time?.created || 0;
                    const tb = b?.info?.time?.created || 0;
                    return tb - ta;
                  });
                for (const m of assistants) {
                  const created = m?.info?.time?.created || 0;
                  if (created >= promptSentAt) {
                    const id = m?.info?.id || '';
                    assistantRecord = {
                      id: id || `asst_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                      ts: new Date(created || Date.now()).toISOString(),
                      role: 'assistant',
                      agent: agentName,
                      content: extractContentFromOpencodeMessage(m),
                      opencodeSessionId,
                      inReplyTo: record.id,
                    };
                    break;
                  }
                }
              }
            } catch {
              // best effort
            }

            if (assistantRecord) {
              try {
                if (file) appendFileSync(file, JSON.stringify(assistantRecord) + '\n', 'utf8');
              } catch {
                // best effort
              }
              broadcast({ type: 'chat:message', sessionId: chatSessionId, message: assistantRecord });
              state.appendActivity({
                kind: 'chat.response',
                agent: agentName,
                message: (assistantRecord.content || '').slice(0, 500),
              });
            }
            onDone();
          })();
        },
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      broadcast({ type: 'chat:error', sessionId: chatSessionId, error: `stream_error: ${msg}` });
      onDone();
    } finally {
      if (!done) {
        done = true;
        onDone();
      }
    }
  })();
}

/**
 * Pump an opencode SSE stream, filtering by sessionID and dispatching to
 * the appropriate callback.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @param {AbortController} controller
 * @param {string} sessionId
 * @param {{ onDelta: Function, onIdle: Function }} handlers
 */
async function pumpSseForChat(body, controller, sessionId, handlers) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        buffer += decoder.decode(value, { stream: true });
      }
      let sep;
      while ((sep = buffer.indexOf('\n\n')) >= 0 || (sep = buffer.indexOf('\r\n\r\n')) >= 0) {
        const isCRLF = buffer[sep] === '\r';
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + (isCRLF ? 4 : 2));
        handleChatSseBlock(block, sessionId, handlers);
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

/**
 * Parse one SSE block and dispatch to onDelta or onIdle.
 *
 * @param {string} block
 * @param {string} sessionId
 * @param {{ onDelta: Function, onIdle: Function }} handlers
 */
function handleChatSseBlock(block, sessionId, handlers) {
  if (!block || block.trim() === '') return;
  let eventName = null;
  const dataLines = [];
  for (const line of block.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return;
  const raw = dataLines.join('\n');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const evt = unwrapOpencodeSseEvent(eventName, parsed);
  if (!evt || !evt.type) return;
  if (evt.sessionID && evt.sessionID !== sessionId) return;

  if (evt.type === 'message.part.updated') {
    handlers.onDelta(evt);
  } else if (evt.type === 'session.idle') {
    handlers.onIdle(evt);
  }
}

/**
 * Extract a text delta from an opencode SSE event envelope.
 * Returns null if no text delta is present.
 *
 * @param {object} envelope  from unwrapOpencodeSseEvent
 * @returns {{ delta: string } | null}
 */
function extractTextDelta(envelope) {
  const part = envelope.part;
  if (!part || typeof part !== 'object') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = /** @type {any} */ (part);
  if (p.type === 'text' && typeof p.text === 'string') {
    return { delta: p.text };
  }
  return null;
}
