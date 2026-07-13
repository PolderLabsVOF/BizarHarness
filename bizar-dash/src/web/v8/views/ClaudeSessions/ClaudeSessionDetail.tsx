/**
 * v8/views/ClaudeSessions/ClaudeSessionDetail.tsx — Sprint S39, v9.3.0.
 *
 * Right-pane content for the ClaudeSessionSheet. Pulls messages
 * from /api/claude-sessions/:id/messages, lets the user send a
 * follow-up via /api/claude-sessions/:id/send. No streaming in
 * this initial cut — the server's SSE endpoint
 * (/api/claude-sessions/:id/stream) is read by the SDK in
 * production, but for the dashboard we treat send as fire-and-
 * refresh so the user sees the new turn after the resume exits.
 */

import { useCallback, useState } from 'react';
import { Send, RefreshCcw } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import type { ChatMessage } from '../../data/types.js';
import { MessageBubble } from '../../ui/chat/MessageBubble.js';

interface MessagesPayload {
  messages: ChatMessage[];
}

export function ClaudeSessionDetail({ sessionId }: { sessionId: string }): JSX.Element {
  const url = `/api/claude-sessions/${sessionId}/messages`;
  const payload = useFetch<MessagesPayload>(url);
  const [draft, setDraft] = useState<string>('');
  const [agent, setAgent] = useState<string>('general');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => { void payload.refetch(); }, [payload]);
  const messages = payload.data?.messages ?? [];

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || !agent.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/claude-sessions/${sessionId}/send`, {
        method: 'POST',
        body: { message: text, agent: agent.trim() },
      });
      setDraft('');
      // The resume spawn is asynchronous; give it a moment then refresh.
      window.setTimeout(() => { refresh(); }, 750);
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={3} style={{ padding: 'var(--space-4)' }} data-testid={`claude-session-detail-${sessionId}`}>
      <Inline align="center" justify="between" gap={2}>
        <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>{sessionId}</strong>
        <Button variant="ghost" onClick={() => void refresh()} data-testid={`claude-session-detail-refresh-${sessionId}`}>
          <RefreshCcw size={14} aria-hidden /> Refresh
        </Button>
      </Inline>

      <Card variant="default">
        <CardBody>
          {payload.loading && messages.length === 0 ? (
            <Skeleton style={{ height: 120 }} />
          ) : messages.length === 0 ? (
            <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>
              No messages yet — start with a follow-up.
            </span>
          ) : (
            <Stack gap={1}>
              {messages.map((m) => (
                <MessageBubble key={m.id || `${m.ts}-${m.role}`} message={m} />
              ))}
            </Stack>
          )}
        </CardBody>
      </Card>

      {error !== null && (
        <span role="alert" data-testid={`claude-session-detail-error-${sessionId}`} style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
          {error}
        </span>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Agent</span>
        <Input
          value={agent}
          data-testid={`claude-session-detail-agent-${sessionId}`}
          onChange={(e) => setAgent((e.target as HTMLInputElement).value)}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Follow-up</span>
        <textarea
          value={draft}
          rows={4}
          data-testid={`claude-session-detail-draft-${sessionId}`}
          onChange={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          style={{
            background: 'var(--surface-0)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2)',
            color: 'var(--fg)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--fs-13)',
            resize: 'vertical',
          }}
        />
      </label>
      <Inline justify="end" gap={2}>
        <Button
          variant="primary"
          onClick={() => void send()}
          disabled={busy || draft.trim() === '' || agent.trim() === ''}
          data-testid={`claude-session-detail-send-${sessionId}`}
        >
          <Send size={14} aria-hidden /> {busy ? 'Sending…' : 'Send'}
        </Button>
      </Inline>
    </Stack>
  );
}