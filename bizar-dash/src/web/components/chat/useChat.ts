// src/components/chat/useChat.ts — shared chat state: messages, sessions, send, polling.
// Supports two parallel message streams: bizar (GET /api/chat) and opencode (GET /api/opencode-sessions/:id/messages + SSE).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatResponse, ChatSession, Settings, Snapshot } from '../../lib/types';
import { api } from '../../lib/api';

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

  const listRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<{ error: (msg: string) => void; success: (msg: string) => void; info: (msg: string) => void } | null>(null);

  // Auto-scroll on new messages (both streams)
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [bizarMessages, opencodeMessages]);

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
  const loadOpencodeSession = useCallback(async (sessionId: string) => {
    // Close any existing opencode SSE
    opencodeEsRef.current?.close();
    opencodeEsRef.current = null;

    try {
      const data = await api.get<{ messages: ChatMessage[] }>(`/opencode-sessions/${encodeURIComponent(sessionId)}/messages`);
      setOpencodeMessages(data.messages || []);
    } catch (err) {
      toastRef.current?.error(`Opencode session load failed: ${(err as Error).message}`);
      setOpencodeMessages([]);
    }

    setActiveOpencodeSessionId(sessionId);
    setActiveSource('opencode');

    // Open SSE — EventSource can't set headers; token goes in query string via urlWithToken
    const tok = api.getToken();
    const baseUrl = tok
      ? `/api/opencode-sessions/${encodeURIComponent(sessionId)}/stream?token=${encodeURIComponent(tok)}`
      : `/api/opencode-sessions/${encodeURIComponent(sessionId)}/stream`;
    const es = new EventSource(baseUrl);
    opencodeEsRef.current = es;

    es.onmessage = (e: MessageEvent) => {
      // Each message is one SSE frame: "event: <type>\ndata: <json>\n\n"
      // Split on newlines to isolate "event: …" and "data: …" lines
      const raw = e.data;
      if (!raw || raw.startsWith(':')) return; // skip heartbeat

      let eventType = '';
      let eventData: string | null = null;

      const lines = raw.split('\n');
      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventType = line.slice(5).trim();
        } else if (line.startsWith('data:')) {
          eventData = line.slice(5).trim();
        }
      }

      if (!eventType || eventData === null) return;

      // Build a ChatMessage from the SSE event
      let role: ChatMessage['role'] = 'assistant';
      if (eventType.startsWith('message.user.')) role = 'user';

      let content: string;
      if (eventType === 'message.part.updated' && eventData !== null) {
        try {
          const parsed = JSON.parse(eventData);
          content = parsed.data?.part?.text ?? JSON.stringify(parsed.data ?? parsed);
        } catch {
          content = eventData;
        }
      } else {
        try {
          const parsed = JSON.parse(eventData);
          content = parsed.data ?? JSON.stringify(parsed);
        } catch {
          content = eventData;
        }
      }

      // Dedup: skip if we already have a message with this id (from SSE echo)
      const msgId = (() => {
        try {
          const parsed = JSON.parse(eventData!);
          return parsed.messageID || parsed.id || null;
        } catch {
          return null;
        }
      })();

      const newMsg: ChatMessage = {
        id: msgId ?? undefined,
        role,
        content,
        ts: new Date().toISOString(),
      };

      setOpencodeMessages((cur) => {
        if (msgId && cur.some((m) => m.id === msgId)) return cur;
        return [...cur, newMsg];
      });
    };

    es.onerror = () => {
      // SSE error — silently close; don't spam the user
      try { es.close(); } catch { /* noop */ }
      opencodeEsRef.current = null;
    };
  }, []);

  // ── Close opencode session ──────────────────────────────────────────────────
  const closeOpencodeSession = useCallback(() => {
    opencodeEsRef.current?.close();
    opencodeEsRef.current = null;
    setOpencodeMessages([]);
    setActiveOpencodeSessionId(null);
    setActiveSource('bizar');
  }, []);

  // ── Select a bizar session ──────────────────────────────────────────────────
  const selectBizarSession = useCallback((sid: string) => {
    closeOpencodeSession();
    setSessionId(sid);
    setActiveSource('bizar');
    loadChat(sid);
  }, [closeOpencodeSession, loadChat]);

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
      await loadChat(created.id);
      refreshSessions().catch(() => {});
    } catch (err) {
      toastRef.current?.error(`Create failed: ${(err as Error).message}`);
    }
  }, [snapshot.activeProject, loadChat, refreshSessions]);

  // ── Send message ────────────────────────────────────────────────────────────
  const onSend = useCallback(async (message: string, agent: string, model: string, attachments?: string[]) => {
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
      try {
        const response = await api.post<{ messages?: ChatMessage[] }>('/chat', { message, agent, model, attachments: attachments || [] });
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
      }
    }
  }, [activeSource, activeOpencodeSessionId]);

  const onRegenerate = useCallback(async (messageId: string) => {
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
  }, [sessionId, loadChat]);

  const deleteMessage = useCallback((idx: number) => {
    if (activeSource === 'opencode') {
      setOpencodeMessages((cur) => cur.filter((_, i) => i !== idx));
    } else {
      setBizarMessages((cur) => cur.filter((_, i) => i !== idx));
    }
  }, [activeSource]);

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
    return () => { closed = true; };
  }, []);

  return {
    // ── State ────────────────────────────────────────────────────────────────
    /**
     * Messages from the active source.
     * Use `activeSource === 'opencode' ? opencodeMessages : bizarMessages`.
     * Kept as `messages` alias for backward compatibility with components
     * that read `chat.messages` directly.
     */
    messages: activeSource === 'opencode' ? opencodeMessages : bizarMessages,
    /** Messages from the bizar chat stream. */
    bizarMessages,
    /** Messages from the opencode session stream. */
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
    /** Which source is currently displayed: 'bizar', 'opencode', or null. */
    activeSource,
    /** The opencode session ID currently selected, or null. */
    activeOpencodeSessionId,
    // ── Setters for toast integration ───────────────────────────────────────
    setToast: (toast: typeof toastRef.current) => { toastRef.current = toast; },
    // ── Actions ─────────────────────────────────────────────────────────────
    loadChat,
    loadTaskChat,
    refreshSessions,
    refreshOpencodeSessions,
    /** Load an opencode session's messages and open its SSE stream. */
    loadOpencodeSession,
    /** Close the opencode SSE and fall back to bizar. */
    closeOpencodeSession,
    /** Select a bizar session (closes any opencode SSE first). */
    selectBizarSession,
    onCreateSession,
    onSend,
    onRegenerate,
    deleteMessage,
    togglePin,
    copyMessage,
  };
}
