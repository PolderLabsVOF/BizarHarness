/**
 * v8/views/Chat/ChatView.tsx — Sprint S38, v9.3.0.
 *
 * Three-pane chat surface: session list (left) · transcript (center) ·
 * composer (bottom). Backed by `/api/chat` + `/api/chat/sessions` +
 * `/api/chat/regenerate` + `/api/chat/audit`. Live deltas arrive via
 * the `chat:delta` / `chat:message` WS events added in S37.
 *
 * No window.confirm / window.prompt. Session creation uses an inline
 * `+` button that POSTs and selects the new session on success.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquarePlus, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Textarea } from '../../ui/controls/Textarea.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import { MessageBubble, EmptyTranscript } from '../../ui/chat/MessageBubble.js';
import { readEventStream } from '../../ui/chat/EventStream.js';
import type { ChatMessage, ChatSession, WsMessage } from '../../data/types.js';

interface ChatPayload {
  messages: ChatMessage[];
  sessions: Array<{ id: string; file: string; mtime: number; size: number }>;
}

interface SessionsPayload {
  sessions: Array<{ id: string; title?: string; updatedAt?: number; messageCount?: number; agent?: string | null }>;
}

function fmtRel(ts: number | undefined): string {
  if (!ts) return '';
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

export function ChatView(): JSX.Element {
  const payload = useFetch<ChatPayload>('/api/chat');
  const sessionsPayload = useFetch<SessionsPayload>('/api/chat/sessions');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<string>('');
  const [draft, setDraft] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Seed active session from the first row in the response.
  useEffect(() => {
    if (activeId === null && payload.data?.sessions.length) {
      setActiveId(payload.data.sessions[0].id);
    }
  }, [payload.data, activeId]);

  // Seed transcript from payload when active session changes.
  useEffect(() => {
    if (!payload.data || activeId === null) {
      setTranscript([]);
      return;
    }
    setTranscript(payload.data.messages.filter((m) => payload.data?.sessions.find((s) => s.id === activeId) !== undefined));
  }, [payload.data, activeId]);

  const sessions = useMemo<ChatSession[]>(() => {
    return (payload.data?.sessions ?? []).map((s) => ({
      id: s.id,
      messageCount: s.size > 0 ? Math.floor(s.size / 200) : 0,
    }));
  }, [payload.data]);

  const onChange = useCallback((msg: WsMessage) => {
    if (msg.type === 'chat:message' && msg.message) {
      // A new persisted turn arrived for the active session; refresh the transcript.
      void payload.refetch();
    }
  }, [payload]);
  useWsMessage('chat:message', onChange);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    setDraft('');
    const optimistic: ChatMessage = {
      id: `local_${Date.now().toString(36)}`,
      ts: new Date().toISOString(),
      role: 'user',
      content: text,
    };
    setTranscript((prev) => [...prev, optimistic]);
    setStreaming('');
    const ctrl = new AbortController();
    try {
      await readEventStream(
        '/api/chat',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: text, session: activeId ?? undefined }),
        },
        {
          signal: ctrl.signal,
          onChunk: (chunk) => setStreaming((cur) => cur + chunk),
          onEvent: (event, data) => {
            if (event === 'session') {
              try {
                const parsed = JSON.parse(data) as { session?: string };
                if (parsed.session) setActiveId(parsed.session);
              } catch { /* swallow */ }
            } else if (event === 'error') {
              setError(data);
            }
          },
          onDone: () => setStreaming(''),
          onError: (err) => setError(err.message),
        },
      );
      // After stream completes the persisted turn is in the JSONL log;
      // pull a fresh transcript.
      void payload.refetch();
      void sessionsPayload.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStreaming('');
    }
  };

  const createSession = async (): Promise<void> => {
    setError(null);
    try {
      const res = await fetchJson<{ session?: ChatSession }>(
        '/api/chat/sessions',
        { method: 'POST', body: {} },
      );
      if (res.session?.id) {
        setActiveId(res.session.id);
        void payload.refetch();
        void sessionsPayload.refetch();
      }
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const regenerate = async (msg: ChatMessage): Promise<void> => {
    setError(null);
    try {
      await fetchJson('/api/chat/regenerate', { method: 'POST', body: { messageId: msg.id, session: activeId } });
      void payload.refetch();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const audit = async (): Promise<void> => {
    setError(null);
    try {
      await fetchJson('/api/chat/audit', { method: 'POST', body: { session: activeId } });
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const dropSession = (id: string): void => {
    // Inline confirm row pattern from F-061. No window.confirm.
    setConfirmDeleteId((cur) => (cur === id ? null : id));
  };

  return (
    <Stack gap={4} data-testid="chat-view">
      <ViewHeader
        title="Chat"
        description="Multi-turn Claude Code sessions for the active project. Streams over WebSocket."
        actions={
          <Inline gap={2} align="center">
            {error !== null && (
              <span role="alert" data-testid="chat-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
                {error}
              </span>
            )}
            <Button variant="ghost" onClick={() => void payload.refetch()} data-testid="chat-refresh">
              <RefreshCw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="ghost" onClick={() => void audit()} data-testid="chat-audit">
              <ShieldCheck size={14} aria-hidden /> Audit
            </Button>
            <Button variant="primary" onClick={() => void createSession()} data-testid="chat-create-session">
              <MessageSquarePlus size={14} aria-hidden /> New session
            </Button>
          </Inline>
        }
      />
      <Inline align="stretch" gap={3} wrap={false} style={{ minHeight: 480 }}>
        {/* Session list */}
        <Card variant="default" style={{ width: 260, flexShrink: 0 }}>
          <CardBody>
            <Stack gap={2}>
              <strong style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                Sessions ({sessions.length})
              </strong>
              {payload.loading && sessions.length === 0 ? (
                <Skeleton style={{ height: 32 }} />
              ) : sessions.length === 0 ? (
                <EmptyState
                  icon={<MessageSquarePlus size={28} aria-hidden />}
                  title="No sessions"
                  description="Create one to start chatting."
                />
              ) : (
                sessions.map((s) => {
                  const isActive = s.id === activeId;
                  const isConfirmingDelete = confirmDeleteId === s.id;
                  return (
                    <div
                      key={s.id}
                      data-testid={`chat-session-${s.id}`}
                      style={{
                        padding: 'var(--space-2)',
                        borderRadius: 'var(--radius-sm)',
                        border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                        background: isActive ? 'color-mix(in oklch, var(--accent) 12%, transparent)' : 'var(--surface-0)',
                        cursor: 'pointer',
                      }}
                      onClick={() => { if (!isConfirmingDelete) setActiveId(s.id); }}
                    >
                      <Inline align="center" justify="between" gap={2}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>
                          {s.id}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); dropSession(s.id); }}
                          data-testid={`chat-session-delete-${s.id}`}
                          aria-label={`Delete session ${s.id}`}
                          style={{
                            background: 'transparent',
                            border: 0,
                            color: 'var(--fg-muted)',
                            cursor: 'pointer',
                            fontSize: 'var(--fs-11)',
                          }}
                        >
                          ×
                        </button>
                      </Inline>
                      {s.messageCount !== undefined && (
                        <div style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                          {s.messageCount} messages
                        </div>
                      )}
                      {isConfirmingDelete && (
                        <Inline gap={1} style={{ marginTop: 'var(--space-1)' }}>
                          <Button
                            variant="danger"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            data-testid={`chat-session-confirm-delete-${s.id}`}
                          >
                            Confirm delete
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            data-testid={`chat-session-cancel-delete-${s.id}`}
                          >
                            Cancel
                          </Button>
                        </Inline>
                      )}
                    </div>
                  );
                })
              )}
            </Stack>
          </CardBody>
        </Card>

        {/* Transcript + composer */}
        <Card variant="default" style={{ flex: 1, minWidth: 0 }}>
          <CardBody>
            <Stack gap={2} style={{ height: '100%' }}>
              <div
                data-testid="chat-transcript"
                style={{
                  flex: 1,
                  minHeight: 320,
                  overflowY: 'auto',
                  padding: 'var(--space-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-0)',
                }}
              >
                {payload.loading && transcript.length === 0 ? (
                  <Skeleton style={{ height: 200 }} />
                ) : transcript.length === 0 && streaming === '' ? (
                  <EmptyTranscript />
                ) : (
                  <Stack gap={1}>
                    {transcript.map((m) => (
                      <MessageBubble key={m.id} message={m} onRegenerate={(msg) => void regenerate(msg)} />
                    ))}
                    {streaming !== '' && (
                      <MessageBubble
                        message={{
                          id: 'streaming',
                          ts: new Date().toISOString(),
                          role: 'assistant',
                          content: streaming,
                        }}
                      />
                    )}
                  </Stack>
                )}
              </div>
              <Inline align="end" gap={2}>
                <span style={{ flex: 1, color: 'var(--fg-muted)', fontSize: 'var(--fs-11)' }}>
                  Enter to send · Shift+Enter newline
                </span>
                <Button variant="primary" onClick={() => void send()} disabled={busy || draft.trim() === ''} data-testid="chat-send">
                  <Send size={14} aria-hidden /> {busy ? 'Sending…' : 'Send'}
                </Button>
              </Inline>
              <Textarea
                value={draft}
                placeholder="Ask Claude anything…"
                rows={4}
                data-testid="chat-input"
                onChange={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
            </Stack>
          </CardBody>
        </Card>
      </Inline>
    </Stack>
  );
}