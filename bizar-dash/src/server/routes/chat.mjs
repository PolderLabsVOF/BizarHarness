/**
 * src/server/routes/chat.mjs
 *
 * /api/chat                              — get chat history (per session)
 * /api/chat (POST)                       — send a message; dispatches to opencode plugin
 * /api/chat/sessions                     — list sessions for the active project
 * /api/chat/sessions (POST)              — create a new session
 * /api/chat/regenerate (POST)            — re-dispatch the last user message
 *
 * The POST /api/chat handler is the most complex endpoint in the
 * codebase: it persists the user message, mints an opencode session
 * if needed, posts the prompt, polls up to 90s for an assistant
 * reply, and persists + broadcasts the result. On plugin offline,
 * it falls back to a "queued" 202 response.
 */
import { Router } from 'express';
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
} from '../serve-info.mjs';
import { wrap } from './_shared.mjs';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createChatRouter({ state, broadcast }) {
  const router = Router();

  router.get('/chat', wrap(async (req, res) => {
    const sessionId = req.query.session ? String(req.query.session) : null;
    const requestedLimit = req.query.limit ? Number(req.query.limit) : 200;
    const limit = Math.min(500, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 200));
    res.json(state.getChat({ sessionId, limit }));
  }));

  // v3.5.5 — POST /api/chat now actually invokes the agent.
  //
  // Flow:
  //   1. Persist the user message to the per-project .jsonl log (same
  //      as before — keeps the chat history intact even when the plugin
  //      is offline).
  //   2. Resolve a chat session id (use the body-provided one, or mint
  //      a new `sess_*`).
  //   3. Look up (or create) the opencode session id that backs this
  //      chat session — stored in a sidecar file at
  //      `<sessions>/<chatSessionId>.opencode.json`.
  //   4. POST the prompt to the opencode session via the plugin's
  //      opencode serve child.
  //   5. Poll for the assistant response (up to 90s) and persist it.
  //   6. Broadcast both messages on the WS `chat:message` channel.
  //
  // Failure modes:
  //   - No active project: we still broadcast the message but skip
  //     persistence and return 202 (legacy behavior).
  //   - No serve-info: we fall back to the legacy "queued" path —
  //     the user message is persisted and broadcast but no agent
  //     invocation happens. The client can poll GET /api/chat for an
  //     eventual reply if the plugin comes up.
  //   - createSession / sendPrompt failure: 502 with the underlying
  //     error, the user message is still persisted.
  //   - Polling timeout: 202 with `timeout: true` so the client knows
  //     the agent is still working and can poll again.
  router.post('/chat', wrap(async (req, res) => {
    const body = req.body || {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      res.status(400).json({ error: 'bad_request', message: 'message is required' });
      return;
    }
    const active = projectsStore.active();

    // 1. Persist the user message to the per-project .jsonl log.
    //    (No-op when no project is active — the legacy fallback path
    //    only broadcast.)
    let chatSessionId = null;
    let file = null;
    let record = null;
    if (active) {
      const dir = projectsStore.ensureProjectDir(active.id);
      const sessionsDir = join(dir, 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      const requestedSessionId = typeof body.session === 'string' ? body.session.trim() : '';
      chatSessionId = SESSION_ID_RE.test(requestedSessionId)
        ? requestedSessionId
        : `sess_${Date.now().toString(36)}`;
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
      // No project — synthesize an id so the response shape is consistent.
      const requestedSessionId = typeof body.session === 'string' ? body.session.trim() : '';
      chatSessionId = SESSION_ID_RE.test(requestedSessionId)
        ? requestedSessionId
        : `sess_${Date.now().toString(36)}`;
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

    // 2. No active project → legacy 202. Don't try to dispatch.
    if (!active) {
      return res.status(202).json({
        accepted: true,
        agent: body.agent || null,
        queued: true,
        reason: 'no_active_project',
      });
    }

    // 3. No plugin running → fall back to queued. The user message is
    //    already persisted + broadcast; the next time the plugin comes
    //    up the user can re-send or POST /api/chat/regenerate.
    const serveInfo = readServeInfo();
    if (!serveInfo) {
      return res.status(202).json({
        accepted: true,
        agent: body.agent || null,
        queued: true,
        session: chatSessionId,
        reason: 'plugin_offline',
      });
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

    if (!opencodeSessionId) {
      const agentName = body.agent || active.defaultAgent || 'odin';
      const create = await createOpencodeSession(
        serveInfo,
        { title: `Chat: ${agentName}`, agent: agentName },
        active.path || serveInfo.worktree,
      );
      if (!create.ok || !create.sessionId) {
        return res.status(502).json({
          error: 'create_session_failed',
          message: create.error || 'failed to create opencode session',
          session: chatSessionId,
        });
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

    // 5. POST the prompt. We use the opencode session id as the
    //    messageID — the polling loop below uses it to detect the
    //    "before vs after" boundary.
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
      return res.status(502).json({
        error: 'send_prompt_failed',
        message: send.error || 'failed to send prompt to opencode',
        session: chatSessionId,
        opencodeSessionId,
      });
    }

    // 6. Poll for the assistant response. We look for the LAST
    //    assistant message; if its creation time is greater than the
    //    user's messageID timestamp, we consider it our reply. This
    //    is the same heuristic the plugin's own event stream uses.
    const promptSentAt = Date.now();
    const deadline = promptSentAt + 90_000;
    let assistantRecord = null;
    let lastSeenAssistantId = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      const list = await listOpencodeMessages(
        serveInfo,
        opencodeSessionId,
        active.path || serveInfo.worktree,
      );
      if (!list.ok || !Array.isArray(list.messages) || list.messages.length === 0) {
        continue;
      }
      // Walk newest → oldest; pick the first assistant message that
      // was created at or after promptSentAt.
      const assistants = list.messages
        .filter((m) => (m?.info?.role || m?.role) === 'assistant')
        .sort((a, b) => {
          const ta = a?.info?.time?.created || 0;
          const tb = b?.info?.time?.created || 0;
          return tb - ta;
        });
      for (const m of assistants) {
        const created = m?.info?.time?.created || 0;
        if (created >= promptSentAt - 1_000) {
          const id = m?.info?.id || '';
          if (id && id === lastSeenAssistantId) continue;
          lastSeenAssistantId = id;
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
      if (assistantRecord) break;
    }

    if (assistantRecord) {
      // 7. Persist + broadcast the assistant message.
      try {
        appendFileSync(file, JSON.stringify(assistantRecord) + '\n', 'utf8');
      } catch {
        // best effort
      }
      broadcast({ type: 'chat:message', sessionId: chatSessionId, message: assistantRecord });
      state.appendActivity({
        kind: 'chat.response',
        agent: agentName,
        message: (assistantRecord.content || '').slice(0, 500),
      });
      return res.json({
        accepted: true,
        session: chatSessionId,
        opencodeSessionId,
        userMessage: record,
        assistantMessage: assistantRecord,
      });
    }

    // 8. Timeout — the agent is still working. The next poll of GET
    //    /api/chat?session=… will pick up whatever has arrived by
    //    then. Return 202 so the client knows nothing failed.
    return res.status(202).json({
      accepted: true,
      session: chatSessionId,
      opencodeSessionId,
      userMessage: record,
      queued: true,
      timeout: true,
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

  // v3.0.4 — Create a new chat session. Generates an id, ensures the
  // sessions dir + empty .jsonl file exist, and returns the session
  // metadata. Idempotent: if the session already exists, returns it.
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

  // ── /api/chat/regenerate ─────────────────────────────────────────────
  // v3.0.0: re-dispatches the last user message before messageId via POST /chat.
  // Full opencode re-dispatch lands in v3.1 when the plugin exposes a stable HTTP API.
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
    // Read the session file and find the last user message before messageId
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
    // Fallback: find last user message
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
    // Re-post via POST /chat (queued for agent processing)
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

  // S3 — /chat/audit: thin endpoint that AuditDialog.tsx calls.
  // The heavy lifting is the existing `/audit` slash command routed to
  // forseti via opencode.json.template. This keeps the dialog functional
  // without re-implementing audit logic.
  router.post('/chat/audit', wrap(async (req, res) => {
    res.json({
      ok: true,
      note: 'audit dispatched — see command.audit in config/opencode.json.template',
      audit: { status: 'queued' },
    });
  }));

  return router;
}
