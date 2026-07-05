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
 * The directory resolver lives in `serve-info.mjs` as
 * `resolveSessionDirectory(sessionId, serveInfo)` and is shared with
 * `routes/opencode-sessions.mjs`. It probes the recorded worktree
 * first (cheap), then falls back to listing every session and
 * matching on id. If neither yields a directory we 503 with
 * `directory_unknown`.
 *
 * v5.0.0 — bug #4 fix: structured error envelopes with `cause`,
 * `status`, and `suggestion`; structured `logger.error` on every
 * upstream failure for diagnostics.
 */

import { Router } from 'express';
import {
  readServeInfo,
  listOpencodeMessages,
  resolveSessionDirectory,
  sendOpencodePrompt,
  unwrapOpencodeSseEvent,
  buildAuthHeader,
  extractContentFromOpencodeMessage,
} from '../serve-info.mjs';
import { child as loggerChild } from '../logger.mjs';
import { tracer, withSpan, setCommonAttributes } from '../otel.mjs';
import { recordTrace } from '../metrics.mjs';
import { wrap } from './_shared.mjs';

/** Structured logger scoped to this route — emits `{module:'opencode-session-detail', ...}` on every line. */
const logger = loggerChild({ module: 'opencode-session-detail' });

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
  router.get('/opencode-sessions/:id/messages', wrap(withSpan('opencode.session.messages', async (span, req, res) => {
    const sessionId = String(req.params?.id || '');
    setCommonAttributes(span, {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    });
    span.setAttribute('opencode.session_id', sessionId);
    if (!sessionId) {
      res.status(400).json({ error: 'bad_request', message: 'session id is required' });
      recordTrace('opencode.session.messages', { outcome: 'missing_session_id' });
      return;
    }
    const info = readServeInfo();
    if (!info) {
      res.status(503).json({
        error: 'plugin_offline',
        message: 'opencode plugin is not running',
        suggestion: 'Run `bizar doctor` for diagnostics, or start opencode with `opencode serve`',
      });
      recordTrace('opencode.session.messages', { outcome: 'plugin_offline' });
      return;
    }
    const directory = await resolveSessionDirectory(sessionId, info);
    if (!directory) {
      res.status(503).json({
        error: 'directory_unknown',
        message:
          'Cannot determine the opencode session directory; ensure the opencode plugin is running with serve.json containing worktree.',
        suggestion: 'Create a new session or restart opencode serve.',
      });
      recordTrace('opencode.session.messages', { outcome: 'directory_unknown' });
      return;
    }
    span.setAttribute('opencode.worktree', directory);
    const result = await listOpencodeMessages(info, sessionId, directory, LIST_MESSAGES_TIMEOUT_MS);
    if (!result?.ok) {
      const errMsg = result?.error || 'unknown error from opencode serve';
      // v5.0.0 — bug #4: prefer the structured `cause` field if the
      // helper surfaced one (it carries `ECONNREFUSED` / `UND_ERR_*`
      // from the underlying fetch); fall back to substring inference
      // for older error message shapes.
      let cause = result?.cause || 'unknown';
      if (cause === 'unknown') {
        if (errMsg.includes('timed out')) cause = 'timeout';
        else if (errMsg.includes('network error') || errMsg.includes('fetch failed')) cause = 'network';
      }
      logger.error('opencode listMessages failed', {
        sessionId,
        worktree: directory,
        servePort: info.port,
        status: result?.status ?? null,
        cause,
        err: errMsg,
      });
      span.setAttribute('opencode.error_cause', cause);
      span.setAttribute('opencode.upstream_status', result?.status ?? 0);
      res.status(502).json({
        error: 'opencode_error',
        message: errMsg,
        cause,
        status: result?.status ?? undefined,
        suggestion: 'Check that the opencode serve child is running. Try `bizar doctor` or restart the plugin.',
      });
      recordTrace('opencode.session.messages', { outcome: 'opencode_error', cause });
      return;
    }
    const messages = Array.isArray(result.messages) ? result.messages.map(toChatMessage) : [];
    span.setAttribute('opencode.message_count', messages.length);
    res.json({ messages });
    recordTrace('opencode.session.messages', { outcome: 'ok', message_count_bucket: messages.length === 0 ? '0' : messages.length < 50 ? '1-49' : '50+' });
  })));

  // ---------------------------------------------------------------------
  // POST /opencode-sessions/:id/send
  //
  // Body: { message: string, agent: string } — both required.
  // Returns { ok: true, messageId } or an error envelope.
  // ---------------------------------------------------------------------
  router.post('/opencode-sessions/:id/send', wrap(withSpan('opencode.session.send', async (span, req, res) => {
    const sessionId = String(req.params?.id || '');
    setCommonAttributes(span, {
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    });
    span.setAttribute('opencode.session_id', sessionId);
    if (!sessionId) {
      res.status(400).json({ error: 'bad_request', message: 'session id is required' });
      recordTrace('opencode.session.send', { outcome: 'missing_session_id' });
      return;
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const agent = typeof body.agent === 'string' ? body.agent.trim() : '';
    span.setAttribute('opencode.message_length', message.length);
    if (agent) span.setAttribute('opencode.agent', agent);
    if (!message) {
      res.status(400).json({ error: 'bad_request', message: '`message` is required' });
      recordTrace('opencode.session.send', { outcome: 'missing_message' });
      return;
    }
    if (!agent) {
      res.status(400).json({ error: 'bad_request', message: '`agent` is required' });
      recordTrace('opencode.session.send', { outcome: 'missing_agent' });
      return;
    }
    const info = readServeInfo();
    if (!info) {
      res.status(503).json({
        error: 'plugin_offline',
        message: 'opencode plugin is not running',
        suggestion: 'Run `bizar doctor` for diagnostics, or start opencode with `opencode serve`',
      });
      recordTrace('opencode.session.send', { outcome: 'plugin_offline' });
      return;
    }
    const directory = await resolveSessionDirectory(sessionId, info);
    if (!directory) {
      res.status(503).json({
        error: 'directory_unknown',
        message:
          'Cannot determine the opencode session directory; ensure the opencode plugin is running with serve.json containing worktree.',
        suggestion: 'Create a new session or restart opencode serve.',
      });
      recordTrace('opencode.session.send', { outcome: 'directory_unknown' });
      return;
    }
    span.setAttribute('opencode.worktree', directory);
    // Synthesize a unique messageID so the client can correlate the
    // prompt with the SSE events that opencode emits for it.
    const messageID = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    span.setAttribute('opencode.message_id', messageID);
    const result = await sendOpencodePrompt(
      info,
      { sessionId, agent, text: message, messageID },
      directory,
      SEND_PROMPT_TIMEOUT_MS,
    );
    if (!result?.ok) {
      const errMsg = result?.error || 'unknown error from opencode serve';
      let cause = result?.cause || 'unknown';
      if (cause === 'unknown') {
        if (errMsg.includes('timed out')) cause = 'timeout';
        else if (errMsg.includes('network error') || errMsg.includes('fetch failed')) cause = 'network';
      }
      logger.error('opencode sendPrompt failed', {
        sessionId,
        worktree: directory,
        servePort: info.port,
        status: result?.status ?? null,
        cause,
        err: errMsg,
      });
      span.setAttribute('opencode.error_cause', cause);
      res.status(502).json({
        error: 'opencode_error',
        message: errMsg,
        cause,
        status: result?.status ?? undefined,
        suggestion: 'Check that the opencode serve child is running. Try `bizar doctor` or restart the plugin.',
      });
      recordTrace('opencode.session.send', { outcome: 'opencode_error', cause });
      return;
    }
    span.setAttribute('opencode.ack_message_id', result.messageId || '');
    res.json({ ok: true, messageId: result.messageId });
    recordTrace('opencode.session.send', { outcome: 'ok' });
  })));

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
  //   - v5.1.0 — span lifecycle is manual (`startSpan` + `span.end()`)
  //     because the response is a long-lived stream. Using `withSpan`
  //     would end the span the instant the handler returned, well
  //     before the actual SSE close. We pin the same tracer for
  //     consistency with the rest of this module.
  // ---------------------------------------------------------------------
  router.get('/opencode-sessions/:id/stream', (req, res) => {
    const sessionId = String(req.params?.id || '');
    const span = tracer.startSpan('opencode.session.stream', {
      attributes: {
        'opencode.session_id': sessionId,
        'http.client_ip': req.ip || req.socket?.remoteAddress || '',
        'http.user_agent': (req.headers && req.headers['user-agent']) || '',
      },
    });
    let spanEnded = false;
    const endSpan = (extraAttrs) => {
      if (spanEnded) return;
      spanEnded = true;
      try {
        if (extraAttrs && typeof extraAttrs === 'object') {
          for (const [k, v] of Object.entries(extraAttrs)) {
            try { span.setAttribute(k, v); } catch { /* ignore */ }
          }
        }
        span.setStatus({ code: 1 /* OK */ });
        span.end();
      } catch {
        /* never throw from OTel helper */
      }
    };
    if (!sessionId) {
      try {
        span.setStatus({ code: 2 /* ERROR */, message: 'missing_session_id' });
        span.end();
      } catch { /* ignore */ }
      return res.status(400).json({ error: 'bad_request', message: 'session id is required' });
    }
    if (activeSubscribers >= MAX_SSE_SUBSCRIBERS) {
      res.status(503).json({
        error: 'too_many_subscribers',
        message: `SSE subscriber cap reached (${MAX_SSE_SUBSCRIBERS}); try again later.`,
      });
      try {
        span.setAttribute('opencode.stream.outcome', 'too_many_subscribers');
        span.setStatus({ code: 2 /* ERROR */, message: 'too_many_subscribers' });
        span.end();
      } catch { /* ignore */ }
      recordTrace('opencode.session.stream', { outcome: 'too_many_subscribers' });
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
      endSpan({ 'opencode.stream.outcome': 'plugin_offline' });
      recordTrace('opencode.session.stream', { outcome: 'plugin_offline' });
      return;
    }

    activeSubscribers += 1;
    span.setAttribute('opencode.stream.active_subscribers', activeSubscribers);

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
    const startTs = Date.now();
    const cleanup = () => {
      if (closed) return;
      closed = true;
      activeSubscribers = Math.max(0, activeSubscribers - 1);
      clearInterval(heartbeat);
      try { controller.abort(); } catch { /* ignore */ }
      if (!res.writableEnded) {
        try { res.end(); } catch { /* ignore */ }
      }
      const lifetimeMs = Date.now() - startTs;
      endSpan({
        'opencode.stream.outcome': closedReason || 'closed',
        'opencode.stream.lifetime_ms': lifetimeMs,
      });
      recordTrace('opencode.session.stream', {
        outcome: closedReason || 'closed',
        lifetime_bucket: lifetimeMs < 1_000 ? '<1s' : lifetimeMs < 60_000 ? '<60s' : '60s+',
      });
    };
    let closedReason = 'client_closed';
    req.on('close', () => {
      closedReason = 'client_closed';
      cleanup();
    });

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
      closedReason = 'upstream_open_failed';
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
          closedReason = 'upstream_bad_status';
          cleanup();
          return;
        }
        await pumpSseStream(r.body, res, sessionId);
        closedReason = 'upstream_eof';
      } catch (err) {
        if (controller.signal.aborted) return; // client disconnected, already cleaned up
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.writableEnded) {
          try {
            res.write(`event: error\ndata: ${JSON.stringify({ error: 'upstream_read_error', message: msg })}\n\n`);
          } catch { /* ignore */ }
        }
        closedReason = 'upstream_read_error';
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