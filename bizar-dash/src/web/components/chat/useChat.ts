// src/components/chat/useChat.ts — shared chat state: messages, sessions, send, polling.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatResponse, ChatSession, Settings, Snapshot } from '../../lib/types';
import { api } from '../../lib/api';

export function useChat(snapshot: Snapshot, settings: Settings, initialTaskId?: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [opencodeSessions, setOpencodeSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [pinned, setPinned] = useState<Set<number>>(new Set());

  const listRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<{ error: (msg: string) => void; success: (msg: string) => void; info: (msg: string) => void } | null>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const loadChat = useCallback(async (sid?: string) => {
    try {
      const url = sid ? `/chat?session=${encodeURIComponent(sid)}` : '/chat?limit=200';
      const data = await api.get<ChatResponse>(url);
      setMessages(data.messages || []);
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
      setMessages(data.messages || []);
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

  const onCreateSession = useCallback(async () => {
    if (!snapshot.activeProject) {
      toastRef.current?.error('Pick a project in Overview to scope chat sessions.');
      return;
    }
    try {
      const created = await api.post<ChatSession>('/chat/sessions', {});
      setSessionId(created.id);
      setMessages([]);
      setPinned(new Set());
      await loadChat(created.id);
      refreshSessions().catch(() => {});
    } catch (err) {
      toastRef.current?.error(`Create failed: ${(err as Error).message}`);
    }
  }, [snapshot.activeProject, loadChat, refreshSessions]);

  const onSend = useCallback(async (message: string, agent: string, model: string, attachments?: string[]) => {
    const optimistic: ChatMessage = {
      role: 'user',
      content: message,
      agent,
      ts: new Date().toISOString(),
    };
    setMessages((cur) => [...cur, optimistic]);
    setSending(true);
    try {
      const response = await api.post<{ messages?: ChatMessage[] }>('/chat', { message, agent, model, attachments: attachments || [] });
      if (response?.messages) {
        for (const msg of response.messages) {
          if (msg.role === 'assistant') {
            setMessages((cur) => {
              const exists = cur.some((m) => m.ts === msg.ts);
              return exists ? cur : [...cur, msg];
            });
          }
        }
      } else {
        toastRef.current?.info('Still processing… the response will appear shortly.');
      }
    } catch (err) {
      setMessages((cur) => cur.filter((m) => m !== optimistic));
      toastRef.current?.error(`Send failed: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }, []);

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
    setMessages((cur) => cur.filter((_, i) => i !== idx));
  }, []);

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

  // Initial load
  useEffect(() => {
    if (initialTaskId) {
      loadTaskChat(initialTaskId);
    } else {
      loadChat();
    }
    refreshOpencodeSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for bizar:setChatTask events
  useEffect(() => {
    const handler = (e: Event) => {
      const taskId = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      if (taskId) loadTaskChat(taskId);
    };
    window.addEventListener('bizar:setChatTask', handler);
    return () => window.removeEventListener('bizar:setChatTask', handler);
  }, [loadTaskChat]);

  // WebSocket for live updates — dynamically imported to avoid SSR issues
  useEffect(() => {
    let closed = false;
    import('../../lib/ws').then(({ Ws }) => {
      if (closed) return;
      const ws = new Ws();
      ws.on((msg) => {
        if (msg.type !== 'chat:message') return;
        const next = msg.message;
        setMessages((cur) => {
          const exists = cur.some((m) => m.ts === next.ts);
          return exists ? cur : [...cur, next];
        });
      });
    });
    return () => { closed = true; };
  }, []);

  return {
    // State
    messages,
    sessions,
    opencodeSessions,
    sessionId,
    setSessionId,
    loading,
    sending,
    pinned,
    listRef,
    // Setters for toast integration
    setToast: (toast: typeof toastRef.current) => { toastRef.current = toast; },
    // Actions
    loadChat,
    loadTaskChat,
    refreshSessions,
    refreshOpencodeSessions,
    onCreateSession,
    onSend,
    onRegenerate,
    deleteMessage,
    togglePin,
    copyMessage,
  };
}