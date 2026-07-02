// src/components/chat/useChat.ts — shared chat state: messages, sessions, send,
// polling, SSE, session-state tracking.
//
// Supports two parallel message streams:
//   - bizar     (GET /api/chat)
//   - opencode  (GET /api/opencode-sessions/:id/messages + SSE)
//
// v3.22 — extended with per-session state (idle / streaming / awaiting),
// per-session sub-agent tree, per-session unread count, and jump-to-
// latest scroll behavior (stickToBottom + newMessageCount). The export
// shape stays compatible with v3.21; new fields are added.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatResponse, ChatSession, Settings, Snapshot } from '../../lib/types';
import { api } from '../../lib/api';
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

export function useChat(snapshot: Snapshot, settings: Settings, initialTaskId?: string | null) {
  // ── Bizar stream ────────────────────────────────────────────────────────────
  const [bizarMessages, setBizarMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [opencodeSessions, setOpencodeSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [pinned, setPinned] = useState<Set<number>>(new Set());

  // ── Opencode stream ─────────────────────────────────────────────────────────
  const [opencodeMessages, setOpencodeMessages] = useState<ChatMessage[]>([]);
  const [activeSource, setActiveSource] = useState<'bizar' | 'opencode' | null>(null);
  const [activeOpencodeSessionId, setActiveOpencodeSessionId] = useState<string | null>(null);
  const opencodeEsRef = useRef<EventSource | null>(null);

  // ── v3.22 — session-state, unread, tree per session ────────────────────────
  const [sessionStates, setSessionStates] = useState<Record<string, SessionDisplayState>>({});
  const [stickToBottom, setStickToBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<{ error: (msg: string) => void; success: (msg: string) => void; info: (msg: string) => void } | null>(null);

  // Auto-scroll on new messages (both streams) — only when the user is
  // already at the bottom; otherwise count the new messages for the
  // jump-to-latest pill.
  useEffect(() => {
    if (listRef.current) {
      if (stickToBottom) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      } else {
        setNewMessageCount((n) => n + 1);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizarMessages, opencodeMessages]);

  // ── Helpers to mutate per-session state ────────────────────────────────────
  const setSessionDisplayState = useCallback(
    (id: string, patch: Partial<SessionDisplayState>) => {
      setSessionStates((cur) => {
        const prev: SessionDisplayState = cur[id] ?? { state: 'idle', unread: 0, pinned: false };
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

  // ── Load bizar chat ─────────────────────────────────────────────────────────
  const loadChat = useCallback(async (sid?: string) => {
    try {
      const url = sid ? `/chat?session=${encodeURIComponent(sid)}` : '/chat?limit=200';
      const data = await api.get<ChatResponse>(url);
      setBizarMessages(data.messages || []);
      setSessions(data.sessions || []);
    } catch (err) {
      toastRef.current?.error(`Chat load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTaskChat = useCallback(async (taskId: string) => {
    setLoading(true);
    try {
      const data = await api.get<{ sessionId?: string; messages: ChatMessage[] }>(`/tasks/${encodeURIComponent(taskId)}/chat`);
      setBizarMessages(data.messages || []);
      setSessionId(data.sessionId || taskId);
    } catch (err) {
      toastRef.current?.error(`Task chat load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const data = await api.get<{ sessions: ChatSession[] }>('/chat/sessions');
      setSessions(data.sessions || []);
    } catch { /* best-effort */ }
  }, []);

  const refreshOpencodeSessions = useCallback(async () => {
    try {
      const data = await api.get<{ sessions: ChatSession[] }>('/opencode-sessions');
      // Enrich with source marker and opencodeUrl; port is discovered from serve.json
      const enriched: ChatSession[] = (data.sessions || []).map((s) => ({
        ...s,
        source: 'opencode' as const,
        opencodeUrl: `/opencode/session/${s.id}`,
        title: s.title || s.id,
      }));
      setOpencodeSessions(enriched);
    } catch { /* best-effort */ }
  }, []);

  // ── Opencode session: load messages + open SSE ───────────────────────────────
  //
  // v3.22 — SSE parsing rewritten to use the browser's native EventSource
  // event-type dispatch instead of manual line-splitting. EventSource
  // already parses "event: <type>" / "data: <json>" frames and dispatches
  // `addEventListener(type, …)` per named event.
  const loadOpencodeSession = useCallback(async (id: string) => {
    // Close any existing opencode SSE
    opencodeEsRef.current?.close();
    opencodeEsRef.current = null;

    try {
      const data = await api.get<{ messages: ChatMessage[] }>(`/opencode-sessions/${encodeURIComponent(id)}/messages`);
      setOpencodeMessages(data.messages || []);
    } catch (err) {
      toastRef.current?.error(`Opencode session load failed: ${(err as Error).message}`);
      setOpencodeMessages([]);
    }

    setActiveOpencodeSessionId(id);
    setActiveSource('opencode');

    // Build SSE URL with token in query string (EventSource can't set headers).
    const tok = api.getToken();
    const baseUrl = tok
      ? `/api/opencode-sessions/${encodeURIComponent(id)}/stream?token=${encodeURIComponent(tok)}`
      : `/api/opencode-sessions/${encodeURIComponent(id)}/stream`;
    const es = new EventSource(baseUrl);
    opencodeEsRef.current = es;

    // Helper: append a new message to the opencode list (with dedup by id).
    const append = (msg: ChatMessage) => {
      setOpencodeMessages((cur) => {
        if (msg.id && cur.some((m) => m.id === msg.id)) return cur;
        return [...cur, msg];
      });
    };

    // v3.22 — register handlers per named event type. The server sends
    // `message.user.*`, `message.assistant.*`, `message.part.updated`,
    // `session.*`, and a heartbeat (no event name). Each event's data
    // is a JSON-encoded object.
    const parseData = (raw: string | null): unknown => {
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    };

    const userEventNames = ['message.user.created', 'message.user.updated'];
    for (const name of userEventNames) {
      es.addEventListener(name, (e: MessageEvent) => {
        const parsed = parseData(e.data) as { messageID?: string; data?: { content?: string } } | null;
        const content = parsed?.data?.content ?? '';
        append({
          id: parsed?.messageID,
          role: 'user',
          content,
          ts: new Date().toISOString(),
        });
      });
    }

    const assistantEventNames = [
      'message.assistant.created',
      'message.assistant.updated',
    ];
    for (const name of assistantEventNames) {
      es.addEventListener(name, (e: MessageEvent) => {
        const parsed = parseData(e.data) as { messageID?: string; data?: { content?: string } } | null;
        const content = parsed?.data?.content ?? '';
        append({
          id: parsed?.messageID,
          role: 'assistant',
          content,
          ts: new Date().toISOString(),
        });
        markSessionStreaming(id, true);
      });
    }

    es.addEventListener('message.part.updated', (e: MessageEvent) => {
      // Streamed token / chunk. The full message is built from many
      // of these; we append each chunk as its own message for the
      // dashboard's text-only renderer. Dedup by part id.
      const parsed = parseData(e.data) as {
        messageID?: string;
        id?: string;
        data?: { part?: { text?: string } };
      } | null;
      const text = parsed?.data?.part?.text ?? '';
      if (!text) return;
      append({
        id: parsed?.id ?? parsed?.messageID,
        role: 'assistant',
        content: text,
        ts: new Date().toISOString(),
      });
    });

    const idleEventNames = [
      'session.idle',
      'message.assistant.completed',
      'session.completed',
    ];
    for (const name of idleEventNames) {
      es.addEventListener(name, () => {
        markSessionStreaming(id, false);
      });
    }

    const awaitingEventNames = [
      'session.awaiting',
      'session.awaiting_input',
      'message.assistant.awaiting',
    ];
    for (const name of awaitingEventNames) {
      es.addEventListener(name, () => {
        setSessionDisplayState(id, { state: 'awaiting' });
      });
    }

    es.onerror = () => {
      // SSE error — silently close; don't spam the user.
      try {
        es.close();
      } catch {
        /* noop */
      }
      opencodeEsRef.current = null;
    };
  }, [markSessionStreaming, setSessionDisplayState]);

  // ── Close opencode session ──────────────────────────────────────────────────
  const closeOpencodeSession = useCallback(() => {
    opencodeEsRef.current?.close();
    opencodeEsRef.current = null;
    setOpencodeMessages([]);
    setActiveOpencodeSessionId(null);
    setActiveSource('bizar');
  }, []);

  // ── Select a bizar session ──────────────────────────────────────────────────
  const selectBizarSession = useCallback(
    (sid: string) => {
      closeOpencodeSession();
      setSessionId(sid);
      setActiveSource('bizar');
      loadChat(sid);
      // Reset unread for the session being opened.
      setSessionDisplayState(sid, { unread: 0 });
    },
    [closeOpencodeSession, loadChat, setSessionDisplayState],
  );

  // ── Create session ──────────────────────────────────────────────────────────
  const onCreateSession = useCallback(async () => {
    if (!snapshot.activeProject) {
      toastRef.current?.error('Pick a project in Overview to scope chat sessions.');
      return;
    }
    try {
      const created = await api.post<ChatSession>('/chat/sessions', {});
      setSessionId(created.id);
      setBizarMessages([]);
      setPinned(new Set());
      setSessionDisplayState(created.id, { state: 'idle', unread: 0 });
      await loadChat(created.id);
      refreshSessions().catch(() => {});
    } catch (err) {
      toastRef.current?.error(`Create failed: ${(err as Error).message}`);
    }
  }, [snapshot.activeProject, loadChat, refreshSessions, setSessionDisplayState]);

  // ── Send message ────────────────────────────────────────────────────────────
  const onSend = useCallback(
    async (message: string, agent: string, model: string, attachments?: string[]) => {
      if (activeSource === 'opencode' && activeOpencodeSessionId) {
        // Optimistic add
        const optimisticId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const optimistic: ChatMessage = {
          id: optimisticId,
          role: 'user',
          content: message,
          agent,
          ts: new Date().toISOString(),
        };
        setOpencodeMessages((cur) => [...cur, optimistic]);
        setSending(true);
        try {
          const result = await api.post<{ ok: boolean; messageId: string }>(
            `/opencode-sessions/${encodeURIComponent(activeOpencodeSessionId)}/send`,
            { message, agent },
          );
          // SSE echo will dedup on messageId === optimisticId or server-provided id
          void result;
          markSessionStreaming(activeOpencodeSessionId, true);
        } catch (err) {
          // Remove optimistic on failure
          setOpencodeMessages((cur) => cur.filter((m) => m.id !== optimisticId));
          toastRef.current?.error(`Send failed: ${(err as Error).message}`);
        } finally {
          setSending(false);
        }
      } else {
        // Default: send to bizar chat
        const optimistic: ChatMessage = {
          role: 'user',
          content: message,
          agent,
          ts: new Date().toISOString(),
        };
        setBizarMessages((cur) => [...cur, optimistic]);
        setSending(true);
        markSessionStreaming(sessionId, true);
        try {
          const response = await api.post<{ messages?: ChatMessage[] }>('/chat', {
            message,
            agent,
            model,
            attachments: attachments || [],
          });
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
            toastRef.current?.info('Still processing… the response will appear shortly.');
          }
        } catch (err) {
          setBizarMessages((cur) => cur.filter((m) => m !== optimistic));
          toastRef.current?.error(`Send failed: ${(err as Error).message}`);
        } finally {
          setSending(false);
          markSessionStreaming(sessionId, false);
        }
      }
    },
    [activeSource, activeOpencodeSessionId, sessionId, markSessionStreaming],
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
        toastRef.current?.error(`Regenerate failed: ${(err as Error).message}`);
      }
    },
    [sessionId, loadChat],
  );

  const deleteMessage = useCallback(
    (idx: number) => {
      if (activeSource === 'opencode') {
        setOpencodeMessages((cur) => cur.filter((_, i) => i !== idx));
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
    navigator.clipboard?.writeText(text).then(
      () => toastRef.current?.success('Copied.'),
      () => toastRef.current?.error('Copy failed.'),
    );
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

  // ── Session rename / delete (used by the ChatRail row menu) ─────────────────
  const renameSession = useCallback(
    async (id: string, title: string) => {
      try {
        await api.post(`/chat/sessions/${encodeURIComponent(id)}/rename`, { title });
        setSessions((cur) => cur.map((s) => (s.id === id ? { ...s, title } : s)));
        toastRef.current?.success('Renamed.');
      } catch (err) {
        toastRef.current?.error(`Rename failed: ${(err as Error).message}`);
      }
    },
    [],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        await api.del(`/chat/sessions/${encodeURIComponent(id)}`);
        setSessions((cur) => cur.filter((s) => s.id !== id));
        setSessionStates((cur) => {
          const next = { ...cur };
          delete next[id];
          return next;
        });
        if (sessionId === id) {
          setSessionId('');
          setBizarMessages([]);
        }
        toastRef.current?.success('Session deleted.');
      } catch (err) {
        toastRef.current?.error(`Delete failed: ${(err as Error).message}`);
      }
    },
    [sessionId],
  );

  // ── Cleanup SSE on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      opencodeEsRef.current?.close();
      opencodeEsRef.current = null;
    };
  }, []);

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialTaskId) {
      loadTaskChat(initialTaskId);
    } else {
      loadChat();
    }
    refreshOpencodeSessions();
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
      ws.on((msg) => {
        if (msg.type !== 'chat:message') return;
        const next = msg.message;
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
    messages: activeSource === 'opencode' ? opencodeMessages : bizarMessages,
    bizarMessages,
    opencodeMessages,
    sessions,
    opencodeSessions,
    sessionId,
    setSessionId,
    loading,
    sending,
    pinned,
    listRef,
    // ── Opencode state ──────────────────────────────────────────────────────
    activeSource,
    activeOpencodeSessionId,
    // ── v3.22 — per-session display state ──────────────────────────────────
    sessionStates,
    /** Compute the merged display fields for a session — the rail
     *  consumes this to overlay state/unread/tree on the raw
     *  ChatSession list. */
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
    // ── Setters for toast integration ───────────────────────────────────────
    setToast: (toast: typeof toastRef.current) => {
      toastRef.current = toast;
    },
    // ── Actions ─────────────────────────────────────────────────────────────
    loadChat,
    loadTaskChat,
    refreshSessions,
    refreshOpencodeSessions,
    loadOpencodeSession,
    closeOpencodeSession,
    selectBizarSession,
    onCreateSession,
    onSend,
    onRegenerate,
    deleteMessage,
    togglePin,
    copyMessage,
    renameSession,
    deleteSession,
  };
}