/**
 * src/server/routes/opencode-session-detail.mjs
 *
 * v4.2.4 — Per-session deep-linking for the opencode sessions list.
 *
 * The dashboard's /api/opencode-sessions endpoint (see opencode-sessions.mjs)
 * returns a flat list of session metadata. When the user clicks a session
 * we need the dashboard to:
 *   1. Render the existing chat UI inside the dashboard tab — not a 404
 *      to /opencode/session/:id on the opencode serve child.
 *   2. Fetch the message history for that session.
 *   3. Send new user prompts.
 *   4. Stream live updates (assistant tokens, part updates, idle, errors)
 *      filtered to the chosen session.
 *
 * This router exposes three endpoints that sit on top of the opencode
 * serve child described in serve-info.mjs:
 *
 *   GET  /api/opencode-sessions/:id/messages
 *   POST /api/opencode-sessions/:id/send
 *   GET  /api/opencode-sessions/:id/stream   (SSE proxy)
 *
 * The SSE proxy follows the same wire format as `routes-v2/events.mjs`
 * (one event per `event:` + `data:` block, separated by a blank line).
 * The upstream is opencode's global `/event?directory=...` stream — we
 * unwrap each event with `unwrapOpencodeSseEvent` and forward only the
 * ones whose `sessionID` matches the requested id.
 *
 * Concurrency: a module-level counter caps the number of concurrent
 * SSE subscribers per dashboard instance at 50. Beyond that we emit an
 * `error` event and end the stream rather than risk file-descriptor
 * exhaustion when many tabs are open.
 *
 * The directory resolver walks `listOpencodeSessions` first (so a
 * session started from any worktree gets its own directory), then
 * falls back to `info.worktree` (the plugin's cwd). If neither is
 * known we 503.
 */

import { Router } from 'express';
import {
  readServeInfo,
  listOpencodeMessages,
  listOpencodeSessions,
  sendOpencodePrompt,
  unwrapOpencodeSseEvent,
  buildAuthHeader,
  extractContentFromOpencodeMessage,
} from '../serve-info.mjs';
import { wrap } from './_shared.mjs';

/** Maximum number of concurrent SSE subscribers on this dashboard process. */
const MAX_SSE_SUBSCRIBERS = 50;
/** Read the heartbeat interval on demand so tests can shrink it via
 *  `process.env.BIZAR_SSE_HEARTBEAT_MS` even after module load. */
function getSseHeartbeatMs() {
  const v = Number.parseInt(process.env.BIZAR_SSE_HEARTBEAT_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 25_000;
}
/** Default timeout for the upstream message listing endpoint. */
const LIST_MESSAGES_TIMEOUT_MS = 8_000;
/** Default timeout for the upstream prompt endpoint. */
const SEND_PROMPT_TIMEOUT_MS = 12_000;

/**
 * Resolve the opencode `directory` query parameter for a session.
 *
 * Tries (in order):
 *   1. The session's own `location.directory` from `listOpencodeSessions`.
 *   2. `info.worktree` (the plugin's recorded cwd at startup).
 *
 * Returns `null` when neither is known — callers should 503 in that
 * case so the UI can show "directory unknown" rather than sending the
 * prompt with a blank directory (which the opencode API would 400).
 *
 * @param {ReturnType<typeof readServeInfo>} info
 * @param {string} sessionId
 * @returns {Promise<string|null>}
 */
async function resolveSessionDirectory(info, sessionId) {
  if (!info) return null;
  try {
    const sessions = await listOpencodeSessions(info, 5_000);
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
 * Normalize an opencode message into the dashboard's chat shape:
 *   { id, role, content, ts }
 *
 * Mirrors `normalizeOpencodeMessage` in serve-info.mjs but is inlined
 * here because the inline shape lets us cheaply build the response
 * without re-parsing the parts twice.
 *
 * @param {object} msg  one entry from `listOpencodeMessages().messages`
 * @returns {{id:string, role:string, content:string, ts:number}}
 */
function toChatMessage(msg) {
  if (!msg) return { id: '', role: 'assistant', content: '', ts: Date.now() };
  const id = msg?.info?.id || msg?.id || '';
  const role = msg?.info?.role || msg?.role || 'assistant';
  const ts =
    msg?.info?.time?.created
    || (typeof msg?.info?.time === 'object' ? msg.info.time.created : null)
    || (typeof msg?.time?.created === 'number' ? msg.time.created : null)
    || Date.now();
  return {
    id: String(id),
    role: String(role),
    content: extractContentFromOpencodeMessage(msg),
    ts: typeof ts === 'number' ? ts : Date.now(),
  };
}

/**
 * @returns {import('express').Router}
 */
export function createOpencodeSessionDetailRouter() {
  const router = Router();

  // ---------------------------------------------------------------------
  // GET /opencode-sessions/:id/messages
  //
  // Returns the message history for a session in the dashboard's
  // ChatMessage shape: { id, role, content, ts }.
  // ---------------------------------------------------------------------
  router.get('/opencode-sessions/:id/messages', wrap(async (req, res) => {
    const sessionId = String(req.params?.id || '');
    if (!sessionId) {
      return res.status(400).json({ error: 'bad_request', message: 'session id is required' });
    }
    const info = readServeInfo();
    if (!info) {
      return res.status(503).json({
        error: 'plugin_offline',
        message: 'opencode plugin is not running',
      });
    }
    const directory = await resolveSessionDirectory(info, sessionId);
    if (!directory) {
      return res.status(503).json({
        error: 'directory_unknown',
        message:
          'Cannot determine the opencode session directory; ensure the opencode plugin is running with serve.json containing worktree.',
      });
    }
    const result = await listOpencodeMessages(info, sessionId, directory, LIST_MESSAGES_TIMEOUT_MS);
    if (!result?.ok) {
      return res.status(502).json({
        error: 'opencode_error',
        message: result?.error || 'unknown error from opencode serve',
      });
    }
    const messages = Array.isArray(result.messages) ? result.messages.map(toChatMessage) : [];
    return res.json({ messages });
  }));

  // ---------------------------------------------------------------------
  // POST /opencode-sessions/:id/send
  //
  // Body: { message: string, agent: string } — both required.
  // Returns { ok: true, messageId } or an error envelope.
  // ---------------------------------------------------------------------
  router.post('/opencode-sessions/:id/send', wrap(async (req, res) => {
    const sessionId = String(req.params?.id || '');
    if (!sessionId) {
      return res.status(400).json({ error: 'bad_request', message: 'session id is required' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const agent = typeof body.agent === 'string' ? body.agent.trim() : '';
    if (!message) {
      return res.status(400).json({ error: 'bad_request', message: '`message` is required' });
    }
    if (!agent) {
      return res.status(400).json({ error: 'bad_request', message: '`agent` is required' });
    }
    const info = readServeInfo();
    if (!info) {
      return res.status(503).json({
        error: 'plugin_offline',
        message: 'opencode plugin is not running',
      });
    }
    const directory = await resolveSessionDirectory(info, sessionId);
    if (!directory) {
      return res.status(503).json({
        error: 'directory_unknown',
        message:
          'Cannot determine the opencode session directory; ensure the opencode plugin is running with serve.json containing worktree.',
      });
    }
    // Synthesize a unique messageID so the client can correlate the
    // prompt with the SSE events that opencode emits for it.
    const messageID = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const result = await sendOpencodePrompt(
      info,
      { sessionId, agent, text: message, messageID },
      directory,
      SEND_PROMPT_TIMEOUT_MS,
    );
    if (!result?.ok) {
      return res.status(502).json({
        error: 'opencode_error',
        message: result?.error || 'unknown error from opencode serve',
      });
    }
    return res.json({ ok: true, messageId: result.messageId });
  }));

  // ---------------------------------------------------------------------
  // GET /opencode-sessions/:id/stream  (SSE proxy)
  //
  // Opens ONE upstream connection to opencode's `/event?directory=...`
  // and forwards only the events whose `sessionID === :id` to the client.
  //
  // Concurrency is capped per-process. A 25s heartbeat keeps the
  // connection alive through reverse proxies (nginx, cloudflare).
  //
  // Implementation notes:
  //   - We DON'T import plugins/bizar/src/event-stream.ts because it
  //     lives outside this package and is TypeScript. The unwrap logic
  //     is ported to serve-info.mjs (`unwrapOpencodeSseEvent`).
  //   - We DO mirror the response shape used by `routes-v2/events.mjs`:
  //     `event: <type>\ndata: <json>\n\n`.
  // ---------------------------------------------------------------------
  router.get('/opencode-sessions/:id/stream', (req, res) => {
    const sessionId = String(req.params?.id || '');
    if (!sessionId) {
      return res.status(400).json({ error: 'bad_request', message: 'session id is required' });
    }
    if (activeSubscribers >= MAX_SSE_SUBSCRIBERS) {
      res.status(503).json({
        error: 'too_many_subscribers',
        message: `SSE subscriber cap reached (${MAX_SSE_SUBSCRIBERS}); try again later.`,
      });
      return;
    }

    // SSE headers — mirror routes-v2/events.mjs exactly so proxies that
    // already trust this dashboard's SSE format don't need new rules.
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const info = readServeInfo();
    if (!info) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'plugin_offline' })}\n\n`);
      res.end();
      return;
    }

    activeSubscribers += 1;

    // Upstream fetch + line-buffered SSE parser. Aborted on client
    // disconnect or when the upstream closes.
    const controller = new AbortController();
    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(heartbeat);
        return;
      }
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, getSseHeartbeatMs());
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      activeSubscribers = Math.max(0, activeSubscribers - 1);
      clearInterval(heartbeat);
      try { controller.abort(); } catch { /* ignore */ }
      if (!res.writableEnded) {
        try { res.end(); } catch { /* ignore */ }
      }
    };
    req.on('close', cleanup);

    const upstreamUrl = `${info.baseUrl}/event?directory=${encodeURIComponent(info.worktree || '')}`;
    let upstream;
    try {
      upstream = fetch(upstreamUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: buildAuthHeader(info),
        },
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'upstream_open_failed', message: msg })}\n\n`);
      cleanup();
      return;
    }

    void (async () => {
      try {
        const r = await upstream;
        if (!r.ok || !r.body) {
          res.write(`event: error\ndata: ${JSON.stringify({
            error: 'upstream_status',
            status: r.status,
          })}\n\n`);
          cleanup();
          return;
        }
        await pumpSseStream(r.body, res, sessionId);
      } catch (err) {
        if (controller.signal.aborted) return; // client disconnected, already cleaned up
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.writableEnded) {
          try {
            res.write(`event: error\ndata: ${JSON.stringify({ error: 'upstream_read_error', message: msg })}\n\n`);
          } catch { /* ignore */ }
        }
      } finally {
        cleanup();
      }
    })();
  });

  return router;
}

/** Process-wide counter for active SSE subscribers. */
let activeSubscribers = 0;

/**
 * Pump an upstream SSE ReadableStream, parse blocks, unwrap opencode
 * events, filter by sessionID, and forward to `res`.
 *
 * SSE blocks are separated by a blank line (`\n\n` or `\r\n\r\n`).
 * Within a block, lines look like `event: <name>` and `data: <json>`.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @param {import('express').Response} res
 * @param {string} sessionId  only forward events for this session
 */
async function pumpSseStream(body, res, sessionId) {
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
        handleSseBlock(block, res, sessionId);
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

/**
 * Parse one SSE block and forward the event to the client if it
 * matches the requested session.
 *
 * @param {string} block
 * @param {import('express').Response} res
 * @param {string} sessionId
 */
function handleSseBlock(block, res, sessionId) {
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
    return; // non-JSON data: drop silently
  }
  const evt = unwrapOpencodeSseEvent(eventName, parsed);
  if (!evt || !evt.type) return;
  // Filter to the requested session. Events without a sessionID
  // (e.g. opencode's own server-wide pings) are dropped.
  if (!evt.sessionID || evt.sessionID !== sessionId) return;
  if (res.writableEnded || res.destroyed) return;
  const payload = JSON.stringify({
    type: evt.type,
    sessionID: evt.sessionID,
    ...(evt.messageID ? { messageID: evt.messageID } : {}),
    ...(evt.part ? { part: evt.part } : {}),
    data: evt.data,
  });
  try {
    // Forward a single canonical envelope per upstream event. The
    // dashboard's stream listeners consume the opencode event names
    // (`message.part.updated`, `session.idle`, `message.updated`, …)
    // directly — emitting redundant `chat:delta` / `chat:status` aliases
    // here would duplicate events and (e.g.) cause an idle event to
    // arrive twice on the wire, which breaks both subscribers and
    // round-trip tests.
    res.write(`event: ${evt.type}\n`);
    res.write(`data: ${payload}\n\n`);
  } catch {
    /* socket closed mid-write */
  }
}