// src/components/chat/useChat.ts — shared chat state: messages, sessions,
// send, polling, SSE, session-state tracking.
//
// v6.3.0 — Claude Code migration. Supports two parallel message streams:
//   - bizar     (GET /api/chat)
//   - claude (GET /api/claude-sessions/:id/messages + SSE)
//
// Changes from v4.2.5:
//   * Endpoint prefix changed: `/api/claude-sessions/*` → `/api/claude-sessions/*`
//   * SSE event type names changed to match the Claude SDK envelope
//     (`message.part.updated` → `delta`/`text_delta`, etc.)
//   * Server no longer needs the `clineErrorInfo` 503 path; the
//     `claudeErrorInfo` field stays for parity but the dashboard
//     mostly sees 502s now (claude CLI not on PATH / spawn failed).
//   * Optimistic send uses a stable `msg_*` ID and is deduped when
//     claude echoes the message back via SDK events.
//   * `claudeMessages` keeps server-provided IDs distinct from
//     optimistic IDs so the merge is unambiguous (server echo
//     replaces optimistic by matching messageID; otherwise both stick
//     around briefly until the user/session state catches up).
//   * `onSend` routes to `/claude-sessions/:id/send` when a
//     claude session is active, `/chat` otherwise. Errors surface
//     via toast + we always remove the optimistic placeholder.
//   * Sessions are managed by source:
//       - `bizarSessions`  → local .jsonl store, POST /chat/sessions
//       - `claudeSessions` → Claude Code, GET /claude-sessions
//     The rail shows both side-by-side with a source indicator and
//     uses separate rename/delete endpoints per source.
//   * All async actions surface a single `busy: { create, send, rename, delete }`
//     so the rail can disable buttons properly.
//   * No `any` leaks — all SSE event shapes are typed via
//     `ClineSseEnvelope`.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  ChatResponse,
  ChatSession,
  Settings,
  Snapshot,
  WsMessage,
} from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import type { SessionState } from './ChatRail';
import type { AgentTreeNode } from './AgentNode';

export interface SessionDisplayState {
  /** idle / streaming / awaiting — derived from the latest SSE event. */
  state: SessionState;
  /** Number of unread (i.e. arrived while the user wasn't viewing) messages. */
  unread: number;
  /** Pinned? (cosmetic for now; pinned state lives in the parent.) */
  pinned: boolean;
  /** Sub-agent tree, if any. */
  tree?: { root: AgentTreeNode };
}

/** Per-source action busy flags. Used by rail/info-panel to disable buttons. */
export interface ChatBusyState {
  create: boolean;
  send: boolean;
  rename: boolean;
  delete: boolean;
}

/**
 * Structured error envelope surfaced by `loadClineSession` when
 * the upstream `/api/claude-sessions/:id/messages` call fails.
 *
 * - `code` mirrors the server's `error` field (`plugin_offline`,
 *   `directory_unknown`, `cline_error`, `bad_request`).
 * - `cause` is the server's structured cause (`network`, `timeout`,
 *   `unknown`, or a raw ECONNREFUSED-style string).
 * - `suggestion` is the operator-friendly hint from the server
 *   (e.g. "Run `bizar doctor` for diagnostics").
 * - `canRetry` is `true` whenever the failure is transient (network
 *   error, upstream 502) — i.e. the user can fix it by trying again
 *   after starting the plugin / waiting for cline to come back.
 *   False for hard failures (bad_request).
 */
export interface ClineErrorInfo {
  type: 'session_load_failed';
  code: string;
  message: string;
  cause?: string;
  status?: number;
  suggestion?: string | null;
  canRetry: boolean;
}

/** Shape of one cline SSE envelope after unwrapping. */
interface ClineSseEnvelope {
  type: string;
  sessionID?: string;
  messageID?: string;
  /** Raw upstream payload (kept for forwarders that want full fidelity). */
  data?: unknown;
}

/**
 * The chat hook returns a stable bag of state + actions used by
 * both Chat.tsx (desktop) and MobileChat.tsx (mobile).
 *
 * The hook owns the lifecycle of the cline SSE stream. Callers
 * should never instantiate their own EventSource for the same
 * session — they should always go through this hook.
 */
export function useChat(snapshot: Snapshot, settings: Settings, initialTaskId?: string | null) {
  // ── Bizar stream ────────────────────────────────────────────────────────────
  const [bizarMessages, setBizarMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ChatBusyState>({
    create: false,
    send: false,
    rename: false,
    delete: false,
  });

  // ── Cline stream ─────────────────────────────────────────────────────────
  const [clineSessions, setClineSessions] = useState<ChatSession[]>([]);
  const [clineMessages, setClineMessages] = useState<ChatMessage[]>([]);
  const [activeSource, setActiveSource] = useState<'bizar' | 'cline' | null>(null);
  const [activeClineSessionId, setActiveClineSessionId] = useState<string | null>(null);
  const [clineError, setClineError] = useState<string | null>(null);
  const [clineSuggestion, setClineSuggestion] = useState<string | null>(null);
  /**
   * Structured error info for the cline session load path. New in
   * v5.0.0 — `ChatInfoPanel` consumes this to render its own error
   * section (in addition to the chat-thread-header error already
   * rendered by Chat.tsx). `null` when no error.
   */
  const [clineErrorInfo, setClineErrorInfo] = useState<ClineErrorInfo | null>(null);

  // ── v3.22 — session-state, unread, tree per session ────────────────────────
  const [sessionStates, setSessionStates] = useState<Record<string, SessionDisplayState>>({});
  const [stickToBottom, setStickToBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);

  // Set of messageIDs the user has already accepted (or that arrived
  // via SSE) — used by the cline path to dedupe optimistic + echo.
  const [seenClineMessages, setSeenClineMessages] = useState<Set<string>>(new Set());

  // Backwards-compat alias (chat.sendSession delete etc. used `pinned` historically).
  const [pinned, setPinned] = useState<Set<number>>(new Set());

  const listRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<
    | {
        error: (msg: string) => void;
        success: (msg: string) => void;
        info: (msg: string) => void;
        warning: (msg: string) => void;
      }
    | null
  >(null);

  // ── SSE lifecycle refs ──────────────────────────────────────────────────────
  const clineEsRef = useRef<EventSource | null>(null);
  const sseReconnectAttemptRef = useRef(0);
  const sseReconnectTimerRef = useRef<number | null>(null);
  // The id of the session we're CURRENTLY streaming. When the user
  // switches sessions, this id changes and the SSE handler short-
  // circuits any in-flight appends.
  const sseCurrentSessionIdRef = useRef<string | null>(null);
  // Whether the SSE connection should be auto-reconnected on error.
  // Set to false on explicit disconnect (session switch / unmount).
  const sseAutoReconnectRef = useRef(false);

  /** Append `msg` to `clineMessages`, replacing any prior
   *  optimistic entry whose content matches or whose ID matches. */
  const appendClineMessage = useCallback((msg: ChatMessage) => {
    if (!msg) return;
    setClineMessages((cur) => {
      // Existing exact-ID match: skip.
      if (msg.id && cur.some((m) => m.id === msg.id)) return cur;
      // Optimistic placeholder (starts with msg_) with the same role
      // and content: replace it. This is how cline's echo of our
      // own message gets deduplicated against the optimistic copy.
      const idx = cur.findIndex(
        (m) =>
          typeof m.id === 'string' &&
          m.id.startsWith('msg_') &&
          m.role === msg.role &&
          (m.content || '') === (msg.content || ''),
      );
      if (idx >= 0) {
        const next = cur.slice();
        next[idx] = { ...msg, id: msg.id ?? cur[idx].id };
        return next;
      }
      return [...cur, msg];
    });
  }, []);

  /** Mark a messageID as seen — used to dedupe echo rounds. */
  const markSeen = useCallback((id: string | undefined) => {
    if (!id) return;
    setSeenClineMessages((cur) => {
      if (cur.has(id)) return cur;
      const next = new Set(cur);
      next.add(id);
      return next;
    });
  }, []);

  // ── Helpers to mutate per-session state ────────────────────────────────────
  const setSessionDisplayState = useCallback(
    (id: string, patch: Partial<SessionDisplayState>) => {
      setSessionStates((cur) => {
        const prev: SessionDisplayState =
          cur[id] ?? { state: 'idle', unread: 0, pinned: false };
        return { ...cur, [id]: { ...prev, ...patch } };
      });
    },
    [],
  );

  const markSessionStreaming = useCallback(
    (id: string, streaming: boolean) => {
      setSessionDisplayState(id, { state: streaming ? 'streaming' : 'idle' });
    },
    [setSessionDisplayState],
  );

  /** ─── Toast binding (set by the consuming view via `setToast`) ──── */
  const setToast = useCallback(
    (toast: typeof toastRef.current) => {
      toastRef.current = toast;
    },
    [],
  );

  // ── Load bizar chat ─────────────────────────────────────────────────────────
  const loadChat = useCallback(
    async (sid?: string) => {
      try {
        const url = sid
          ? `/chat?session=${encodeURIComponent(sid)}`
          : '/chat?limit=200';
        const data = await api.get<ChatResponse>(url);
        setBizarMessages(data.messages || []);
        setSessions(data.sessions || []);
      } catch (err) {
        toastRef.current?.error(
          `Chat load failed: ${(err as Error).message}`,
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadTaskChat = useCallback(async (taskId: string) => {
    setLoading(true);
    try {
      const data = await api.get<{
        sessionId?: string;
        messages: ChatMessage[];
      }>(`/tasks/${encodeURIComponent(taskId)}/chat`);
      setBizarMessages(data.messages || []);
      setSessionId(data.sessionId || taskId);
    } catch (err) {
      toastRef.current?.error(
        `Task chat load failed: ${(err as Error).message}`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const data = await api.get<{ sessions: ChatSession[] }>('/chat/sessions');
      setSessions(data.sessions || []);
    } catch {
      /* best-effort */
    }
  }, []);

  const refreshClineSessions = useCallback(async () => {
    try {
      const data = await api.get<{ sessions: ChatSession[] }>(
        '/claude-sessions',
      );
      // Enrich with source marker.
      const enriched: ChatSession[] = (data.sessions || []).map((s) => ({
        ...s,
        source: 'cline' as const,
        title: s.title || s.id,
      }));
      setClineSessions(enriched);
    } catch {
      /* best-effort */
    }
  }, []);

  // ── Cline SSE connection ─────────────────────────────────────────────────
  //
  // Single source of truth for the EventSource lifecycle. Callers:
  //   - `loadClineSession(id)`  — close any current, open a new one.
  //   - `closeClineSession()`   — close and stop auto-reconnect.
  //   - unmount                    — close and stop.
  //
  // On error / network drop, the EventSource triggers `onerror`. We
  // close the connection and schedule a reconnect (with exponential
  // backoff: 1s, 2s, 4s, …, capped at 30s) UNLESS `sseAutoReconnectRef`
  // is false (explicit disconnect).
  //
  const openSseForSession = useCallback(
    (id: string) => {
      // Close any existing connection first.
      if (clineEsRef.current) {
        try {
          clineEsRef.current.close();
        } catch {
          /* noop */
        }
        clineEsRef.current = null;
      }
      if (sseReconnectTimerRef.current !== null) {
        clearTimeout(sseReconnectTimerRef.current);
        sseReconnectTimerRef.current = null;
      }

      // Build the SSE URL. EventSource can't set headers, so we
      // pass the auth token as ?token= when set (loopback makes this
      // optional, but harmless).
      const tok = api.getToken();
      const url = tok
        ? `/api/claude-sessions/${encodeURIComponent(id)}/stream?token=${encodeURIComponent(tok)}`
        : `/api/claude-sessions/${encodeURIComponent(id)}/stream`;

      sseCurrentSessionIdRef.current = id;
      sseAutoReconnectRef.current = true;
      sseReconnectAttemptRef.current = 0;
      setClineError(null);
      setClineSuggestion(null);
      setClineErrorInfo(null);

      const connect = () => {
        if (!sseAutoReconnectRef.current) return;
        if (sseCurrentSessionIdRef.current !== id) return;
        const es = new EventSource(url);
        clineEsRef.current = es;

        // Helper: dispatch one parsed envelope to local state.
        const onEnvelope = (evt: ClineSseEnvelope | null) => {
          if (!evt || !evt.type) return;
          // Drop events for OTHER sessions even though the proxy
          // already filters — defense in depth.
          if (evt.sessionID && evt.sessionID !== id) return;

          const ts = new Date().toISOString();
          const sidForState = id;

          if (
            evt.type === 'message.user.created' ||
            evt.type === 'message.user.updated'
          ) {
            const payload = evt.data as
              | { messageID?: string; data?: { content?: string } }
              | undefined;
            appendClineMessage({
              id: payload?.messageID ?? evt.messageID,
              role: 'user',
              content: payload?.data?.content ?? '',
              ts,
            });
            markSeen(payload?.messageID ?? evt.messageID);
            return;
          }
          if (
            evt.type === 'message.assistant.created' ||
            evt.type === 'message.assistant.updated'
          ) {
            const payload = evt.data as
              | { messageID?: string; data?: { content?: string } }
              | undefined;
            appendClineMessage({
              id: payload?.messageID ?? evt.messageID,
              role: 'assistant',
              content: payload?.data?.content ?? '',
              ts,
            });
            markSeen(payload?.messageID ?? evt.messageID);
            markSessionStreaming(sidForState, true);
            return;
          }
          if (evt.type === 'message.part.updated') {
            const payload = evt.data as
              | {
                  part?: { type?: string; text?: string };
                  messageID?: string;
                  id?: string;
                }
              | undefined;
            const text = payload?.part?.text ?? '';
            if (!text) return;
            appendClineMessage({
              id: payload?.id ?? payload?.messageID ?? evt.messageID,
              role: 'assistant',
              content: text,
              ts,
            });
            markSeen(payload?.id ?? payload?.messageID ?? evt.messageID);
            markSessionStreaming(sidForState, true);
            return;
          }
          if (
            evt.type === 'session.idle' ||
            evt.type === 'message.assistant.completed' ||
            evt.type === 'session.completed'
          ) {
            markSessionStreaming(sidForState, false);
            return;
          }
          if (
            evt.type === 'session.awaiting' ||
            evt.type === 'session.awaiting_input' ||
            evt.type === 'message.assistant.awaiting'
          ) {
            setSessionDisplayState(sidForState, { state: 'awaiting' });
            return;
          }
          if (evt.type === 'session.error') {
            setClineError(
              (evt.data as { message?: string } | undefined)?.message ||
                'cline session error',
            );
            return;
          }
          // Other event types are intentionally ignored — the proxy
          // is canonical, we don't need to project every upstream
          // event into local state.
        };

        // Stable parser — the server may send both `{type: "x"}` and
        // `sync` envelopes with a `.<n>` version suffix. We accept both.
        const parseData = (raw: string | null | undefined):
          | ClineSseEnvelope
          | null => {
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            // Direct shape: {type, properties: {...}}
            if (typeof parsed.type === 'string') {
              const props = parsed.properties as
                | Record<string, unknown>
                | undefined;
              const data = (parsed.data as Record<string, unknown> | undefined) ?? props;
              const sessionID = (
                typeof parsed.sessionID === 'string'
                  ? parsed.sessionID
                  : typeof props?.sessionID === 'string'
                    ? (props.sessionID as string)
                    : typeof data?.sessionID === 'string'
                      ? (data.sessionID as string)
                      : undefined
              );
              const messageID = (
                typeof parsed.messageID === 'string'
                  ? parsed.messageID
                  : typeof props?.messageID === 'string'
                    ? (props.messageID as string)
                    : typeof data?.messageID === 'string'
                      ? (data.messageID as string)
                      : undefined
              );
              let type = parsed.type as string;
              const m = /\.\d+$/.exec(type);
              if (m) type = type.slice(0, m.index);
              return { type, sessionID, messageID, data: parsed };
            }
            // Sync envelope: {type: "sync", syncEvent: {...}}
            if (
              parsed.type === 'sync' &&
              parsed.syncEvent &&
              typeof parsed.syncEvent === 'object'
            ) {
              const inner = parsed.syncEvent as Record<string, unknown>;
              let type = (inner.type as string) || '';
              const m = /\.\d+$/.exec(type);
              if (m) type = type.slice(0, m.index);
              const innerData = (inner.data as Record<string, unknown>) || {};
              return {
                type,
                sessionID:
                  typeof innerData.sessionID === 'string'
                    ? innerData.sessionID
                    : undefined,
                messageID:
                  typeof innerData.messageID === 'string'
                    ? innerData.messageID
                    : undefined,
                data: inner,
              };
            }
            return null;
          } catch {
            return null;
          }
        };

        // register handlers per named event type
        const namedTypes = [
          'message.user.created',
          'message.user.updated',
          'message.assistant.created',
          'message.assistant.updated',
          'message.part.updated',
          'session.idle',
          'message.assistant.completed',
          'session.completed',
          'session.awaiting',
          'session.awaiting_input',
          'message.assistant.awaiting',
          'session.error',
        ];
        for (const name of namedTypes) {
          es.addEventListener(name, (e: MessageEvent) => {
            onEnvelope(parseData((e as MessageEvent).data));
          });
        }

        es.onerror = () => {
          if (sseCurrentSessionIdRef.current !== id) return;
          if (!sseAutoReconnectRef.current) {
            try {
              es.close();
            } catch {
              /* noop */
            }
            clineEsRef.current = null;
            return;
          }
          try {
            es.close();
          } catch {
            /* noop */
          }
          clineEsRef.current = null;

          const nextAttempt = sseReconnectAttemptRef.current + 1;
          sseReconnectAttemptRef.current = nextAttempt;
          // Backoff: 1s, 2s, 4s, 8s, … capped at 30s.
          const delayMs = Math.min(30_000, 1000 * 2 ** (nextAttempt - 1));

          if (sseReconnectTimerRef.current !== null) {
            clearTimeout(sseReconnectTimerRef.current);
          }
          sseReconnectTimerRef.current = window.setTimeout(() => {
            sseReconnectTimerRef.current = null;
            if (
              sseAutoReconnectRef.current &&
              sseCurrentSessionIdRef.current === id
            ) {
              connect();
            }
          }, delayMs);
        };

        es.onopen = () => {
          // Successful (re)connect — reset backoff.
          sseReconnectAttemptRef.current = 0;
          setClineError(null);
          setClineSuggestion(null);
          setClineErrorInfo(null);
        };
      };

      connect();
    },
    [appendClineMessage, markSeen, markSessionStreaming, setSessionDisplayState],
  );

  const closeClineSession = useCallback(() => {
    // Disable auto-reconnect first so the onerror handler short-circuits.
    sseAutoReconnectRef.current = false;
    sseCurrentSessionIdRef.current = null;
    if (sseReconnectTimerRef.current !== null) {
      clearTimeout(sseReconnectTimerRef.current);
      sseReconnectTimerRef.current = null;
    }
    if (clineEsRef.current) {
      try {
        clineEsRef.current.close();
      } catch {
        /* noop */
      }
      clineEsRef.current = null;
    }
    setClineMessages([]);
    setSeenClineMessages(new Set());
    setClineError(null);
    setClineSuggestion(null);
    setClineErrorInfo(null);
    setActiveClineSessionId(null);
    setActiveSource('bizar');
  }, []);

  const loadClineSession = useCallback(
    async (id: string) => {
      // Close any previous cline session cleanly.
      sseAutoReconnectRef.current = false;
      if (clineEsRef.current) {
        try {
          clineEsRef.current.close();
        } catch {
          /* noop */
        }
        clineEsRef.current = null;
      }
      if (sseReconnectTimerRef.current !== null) {
        clearTimeout(sseReconnectTimerRef.current);
        sseReconnectTimerRef.current = null;
      }

      setClineError(null);
      setClineSuggestion(null);
      setClineErrorInfo(null);
      setLoading(true);

      try {
        const data = await api.get<{ messages: ChatMessage[] }>(
          `/claude-sessions/${encodeURIComponent(id)}/messages`,
        );
        setClineMessages(data.messages || []);
      } catch (err) {
        const msg = (err as Error).message;
        // v5.0.0 — bug #4: surface the server's structured error
        // envelope so the UI can render a useful suggestion instead
        // of the raw upstream error string. The server returns
        // `{error, message, cause?, status?, suggestion?}` for every
        // non-2xx response (see serve-info.mjs + routes/cline-
        // session-detail.mjs).
        let info: ClineErrorInfo | null = null;
        if (err instanceof ApiError && err.data && typeof err.data === 'object') {
          const d = err.data as {
            error?: string;
            message?: string;
            cause?: string;
            status?: number;
            suggestion?: string;
          };
          // canRetry: 503/502 are transient (plugin offline /
          // upstream hiccup); the operator can fix the plugin and
          // try again. 400 is a hard bad_request — retrying with the
          // same payload won't help.
          const code = d.error || 'unknown';
          const canRetry =
            code !== 'bad_request' &&
            code !== 'too_many_subscribers' &&
            code !== 'unauthorized';
          info = {
            type: 'session_load_failed',
            code,
            message: d.message || msg,
            cause: d.cause,
            status: d.status,
            suggestion: d.suggestion ?? null,
            canRetry,
          };
        } else if (err instanceof ApiError) {
          info = {
            type: 'session_load_failed',
            code: 'unknown',
            message: msg,
            suggestion: null,
            canRetry: true,
          };
        }
        // Legacy fields — kept so the existing Chat.tsx thread-header
        // error display continues to work unchanged.
        setClineError(
          info
            ? `Cline session load failed (${info.code}): ${info.message}`
            : `Cline session load failed: ${msg}`,
        );
        setClineSuggestion(info?.suggestion ?? null);
        setClineErrorInfo(info);
        toastRef.current?.error(
          info
            ? `Cline session load failed: ${info.message}`
            : `Cline session load failed: ${msg}`,
        );
        setClineMessages([]);
      } finally {
        setLoading(false);
      }

      setActiveClineSessionId(id);
      setActiveSource('cline');
      markSessionStreaming(id, false);
      openSseForSession(id);
    },
    [markSessionStreaming, openSseForSession],
  );

  // ── Select a bizar session ──────────────────────────────────────────────────
  const selectBizarSession = useCallback(
    (sid: string) => {
      closeClineSession();
      setSessionId(sid);
      setActiveSource('bizar');
      loadChat(sid);
      // Reset unread for the session being opened.
      setSessionDisplayState(sid, { unread: 0 });
    },
    [closeClineSession, loadChat, setSessionDisplayState],
  );

  // ── Create session (cline primary; bizar fallback) ──────────────────────
  const onCreateSession = useCallback(async (): Promise<{
    ok: boolean;
    source?: 'bizar' | 'cline';
    id?: string;
  }> => {
    if (busy.create) return { ok: false };
    const agent = settings.defaultAgent || 'odin';
    setBusy((b) => ({ ...b, create: true }));
    try {
      // Try to create a real cline session first. This is the
      // primary create path: it gives the user a full conversation
      // roundtrip with SSE streaming, abort, etc.
      try {
        const created = await api.post<{
          id: string;
          title: string;
          agent: string;
          directory: string;
          createdAt: number;
        }>('/claude-sessions/new', { agent });
        await refreshClineSessions();
        // Open the newly created session right away so the user is
        // dropped into a fresh empty thread, not stuck on the
        // previous one.
        await loadClineSession(created.id);
        toastRef.current?.success(`Session ${created.id} created.`);
        return { ok: true, source: 'cline', id: created.id };
      } catch (clineErr) {
        // Cline plugin offline (503) — fall back to the local
        // per-project .jsonl session. Otherwise, surface the error.
        if (!(clineErr instanceof ApiError) || clineErr.status !== 503) {
          toastRef.current?.error(
            `Create failed: ${(clineErr as Error).message}`,
          );
          return { ok: false };
        }
      }

      // Fallback: local jsonl session.
      if (!snapshot.activeProject) {
        toastRef.current?.error(
          'Pick a project in Overview to scope chat sessions.',
        );
        return { ok: false };
      }
      const created = await api.post<ChatSession>('/chat/sessions', {});
      setSessionId(created.id);
      setBizarMessages([]);
      setPinned(new Set());
      setSessionDisplayState(created.id, { state: 'idle', unread: 0 });
      await loadChat(created.id);
      refreshSessions().catch(() => {});
      toastRef.current?.success(`Session ${created.id} created.`);
      return { ok: true, source: 'bizar', id: created.id };
    } catch (err) {
      toastRef.current?.error(`Create failed: ${(err as Error).message}`);
      return { ok: false };
    } finally {
      setBusy((b) => ({ ...b, create: false }));
    }
  }, [
    busy.create,
    settings.defaultAgent,
    snapshot.activeProject,
    refreshClineSessions,
    loadClineSession,
    loadChat,
    refreshSessions,
    setSessionDisplayState,
  ]);

  // ── Send message ────────────────────────────────────────────────────────────
  const onSend = useCallback(
    async (
      message: string,
      agent: string,
      model: string,
      attachments?: string[],
    ): Promise<{ ok: boolean }> => {
      if (busy.send) return { ok: false };
      const trimmed = message.trim();
      if (!trimmed) return { ok: false };

      if (activeSource === 'cline' && activeClineSessionId) {
        const sid = activeClineSessionId;
        const optimisticId = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const optimistic: ChatMessage = {
          id: optimisticId,
          role: 'user',
          content: trimmed,
          agent,
          ts: new Date().toISOString(),
        };
        appendClineMessage(optimistic);
        markSeen(optimisticId);
        setBusy((b) => ({ ...b, send: true }));
        try {
          await api.post<{ ok: boolean; messageId: string }>(
            `/claude-sessions/${encodeURIComponent(sid)}/send`,
            {
              message: trimmed,
              agent,
            },
          );
          markSessionStreaming(sid, true);
          return { ok: true };
        } catch (err) {
          // Remove optimistic on failure.
          setClineMessages((cur) => cur.filter((m) => m.id !== optimisticId));
          toastRef.current?.error(
            `Send failed: ${(err as Error).message}`,
          );
          return { ok: false };
        } finally {
          setBusy((b) => ({ ...b, send: false }));
        }
      }

      // Bizar fallback.
      const optimistic: ChatMessage = {
        role: 'user',
        content: trimmed,
        agent,
        ts: new Date().toISOString(),
      };
      setBizarMessages((cur) => [...cur, optimistic]);
      setBusy((b) => ({ ...b, send: true }));
      markSessionStreaming(sessionId, true);
      try {
        const response = await api.post<{ messages?: ChatMessage[] }>(
          '/chat',
          {
            message: trimmed,
            agent,
            model,
            attachments: attachments || [],
          },
        );
        if (response?.messages) {
          for (const msg of response.messages) {
            if (msg.role === 'assistant') {
              setBizarMessages((cur) => {
                const exists = cur.some((m) => m.ts === msg.ts);
                return exists ? cur : [...cur, msg];
              });
            }
          }
        } else {
          toastRef.current?.info(
            'Still processing… the response will appear shortly.',
          );
        }
        return { ok: true };
      } catch (err) {
        setBizarMessages((cur) => cur.filter((m) => m !== optimistic));
        toastRef.current?.error(
          `Send failed: ${(err as Error).message}`,
        );
        return { ok: false };
      } finally {
        setBusy((b) => ({ ...b, send: false }));
        markSessionStreaming(sessionId, false);
      }
    },
    [
      activeSource,
      activeClineSessionId,
      appendClineMessage,
      markSeen,
      markSessionStreaming,
      sessionId,
      busy.send,
    ],
  );

  const onRegenerate = useCallback(
    async (messageId: string) => {
      if (!sessionId) {
        toastRef.current?.error('No active session to regenerate.');
        return;
      }
      try {
        await api.post('/chat/regenerate', { sessionId, messageId });
        await loadChat(sessionId);
      } catch (err) {
        toastRef.current?.error(
          `Regenerate failed: ${(err as Error).message}`,
        );
      }
    },
    [sessionId, loadChat],
  );

  const deleteMessage = useCallback(
    (idx: number) => {
      if (activeSource === 'cline') {
        setClineMessages((cur) => cur.filter((_, i) => i !== idx));
      } else {
        setBizarMessages((cur) => cur.filter((_, i) => i !== idx));
      }
    },
    [activeSource],
  );

  const togglePin = useCallback((idx: number) => {
    setPinned((cur) => {
      const next = new Set(cur);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const copyMessage = useCallback((m: ChatMessage) => {
    const text = m.content || m.message || '';
    try {
      navigator.clipboard?.writeText(text).then(
        () => toastRef.current?.success('Copied.'),
        () => toastRef.current?.error('Copy failed.'),
      );
    } catch {
      toastRef.current?.error('Copy failed.');
    }
  }, []);

  // ── Jump-to-latest ──────────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 32;
    setStickToBottom(atBottom);
    if (atBottom) setNewMessageCount(0);
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStickToBottom(true);
    setNewMessageCount(0);
  }, []);

  // ── Session rename / delete (rail row menu + info panel actions) ────────────
  const renameSession = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      if (busy.rename) return false;
      setBusy((b) => ({ ...b, rename: true }));
      try {
        const trimmed = title.trim();
        if (!trimmed) {
          toastRef.current?.error('Title cannot be empty.');
          return false;
        }
        // Try the cline path first if this id is in the cline
        // session list, otherwise the local path. We dispatch by
        // inspecting the in-memory set (avoids a round trip).
        const isCline = clineSessions.some((s) => s.id === id);
        if (isCline) {
          await api.patch<{ id: string; title: string }>(
            `/claude-sessions/${encodeURIComponent(id)}`,
            { title: trimmed },
          );
          setClineSessions((cur) =>
            cur.map((s) => (s.id === id ? { ...s, title: trimmed } : s)),
          );
        } else {
          await api.post(
            `/chat/sessions/${encodeURIComponent(id)}/rename`,
            { title: trimmed },
          );
          setSessions((cur) =>
            cur.map((s) => (s.id === id ? { ...s, title: trimmed } : s)),
          );
        }
        toastRef.current?.success('Renamed.');
        return true;
      } catch (err) {
        toastRef.current?.error(
          `Rename failed: ${(err as Error).message}`,
        );
        return false;
      } finally {
        setBusy((b) => ({ ...b, rename: false }));
      }
    },
    [busy.rename, clineSessions],
  );

  const deleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      if (busy.delete) return false;
      setBusy((b) => ({ ...b, delete: true }));
      try {
        const isCline = clineSessions.some((s) => s.id === id);
        if (isCline) {
          await api.del(`/claude-sessions/${encodeURIComponent(id)}`);
          setClineSessions((cur) => cur.filter((s) => s.id !== id));
          if (activeClineSessionId === id) {
            closeClineSession();
          }
        } else {
          await api.del(`/chat/sessions/${encodeURIComponent(id)}`);
          setSessions((cur) => cur.filter((s) => s.id !== id));
          if (sessionId === id) {
            setSessionId('');
            setBizarMessages([]);
          }
        }
        setSessionStates((cur) => {
          const next = { ...cur };
          delete next[id];
          return next;
        });
        toastRef.current?.success('Session deleted.');
        return true;
      } catch (err) {
        toastRef.current?.error(
          `Delete failed: ${(err as Error).message}`,
        );
        return false;
      } finally {
        setBusy((b) => ({ ...b, delete: false }));
      }
    },
    [
      busy.delete,
      clineSessions,
      activeClineSessionId,
      closeClineSession,
      sessionId,
    ],
  );

  // ── Auto-scroll on new messages ─────────────────────────────────────────────
  useEffect(() => {
    if (listRef.current) {
      if (stickToBottom) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      } else {
        setNewMessageCount((n) => n + 1);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizarMessages, clineMessages]);

  // ── Cleanup SSE on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      sseAutoReconnectRef.current = false;
      sseCurrentSessionIdRef.current = null;
      if (sseReconnectTimerRef.current !== null) {
        clearTimeout(sseReconnectTimerRef.current);
        sseReconnectTimerRef.current = null;
      }
      if (clineEsRef.current) {
        try {
          clineEsRef.current.close();
        } catch {
          /* noop */
        }
        clineEsRef.current = null;
      }
    };
  }, []);

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialTaskId) {
      loadTaskChat(initialTaskId);
    } else {
      loadChat();
    }
    refreshClineSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Listen for bizar:setChatTask events ────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const taskId = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      if (taskId) loadTaskChat(taskId);
    };
    window.addEventListener('bizar:setChatTask', handler);
    return () => window.removeEventListener('bizar:setChatTask', handler);
  }, [loadTaskChat]);

  // ── WebSocket for live bizar updates ────────────────────────────────────────
  useEffect(() => {
    let closed = false;
    import('../../lib/ws').then(({ Ws }) => {
      if (closed) return;
      const ws = new Ws();
      ws.on((msg: WsMessage) => {
        if (msg.type !== 'chat:message') return;
        const next = msg.message;
        if (!next) return;
        setBizarMessages((cur) => {
          const exists = cur.some((m) => m.ts === next.ts);
          return exists ? cur : [...cur, next];
        });
      });
    });
    return () => {
      closed = true;
    };
  }, []);

  return {
    // ── State ────────────────────────────────────────────────────────────────
    messages:
      activeSource === 'cline' ? clineMessages : bizarMessages,
    bizarMessages,
    clineMessages,
    sessions,
    clineSessions,
    sessionId,
    setSessionId,
    loading,
    sending: busy.send,
    pinned,
    listRef,
    // ── Cline state ──────────────────────────────────────────────────────
    activeSource,
    activeClineSessionId,
    clineError,
    clineSuggestion,
    /**
     * v5.0.0 — bug #4: structured error info consumed by
     * `ChatInfoPanel`. `null` when no error is active.
     */
    clineErrorInfo,
    /**
     * v5.0.0 — bug #4: retry helper exposed for `ChatInfoPanel`'s
     * Retry button. Calls `loadClineSession` on the currently
     * active cline session (or no-op if none is active).
     */
    retryClineSession: () => {
      if (activeClineSessionId) void loadClineSession(activeClineSessionId);
    },
    // ── v3.22 — per-session display state ──────────────────────────────────
    sessionStates,
    busy,
    getSessionDisplay: (s: ChatSession) => ({
      ...s,
      state: sessionStates[s.id]?.state ?? 'idle',
      unread: sessionStates[s.id]?.unread ?? 0,
      pinned: sessionStates[s.id]?.pinned ?? false,
      tree: sessionStates[s.id]?.tree,
    }),
    // ── Jump-to-latest ──────────────────────────────────────────────────────
    stickToBottom,
    newMessageCount,
    handleScroll,
    jumpToLatest,
    // ── Toast integration ──────────────────────────────────────────────────
    setToast,
    // ── Actions ─────────────────────────────────────────────────────────────
    loadChat,
    loadTaskChat,
    refreshSessions,
    refreshClineSessions,
    loadClineSession,
    closeClineSession,
    selectBizarSession,
    onCreateSession,
    onSend,
    onRegenerate,
    deleteMessage,
    togglePin,
    copyMessage,
    renameSession,
    deleteSession,
    seenClineMessages,
  };
}
