/**
 * v8/ui/chat/ChatDrawer.tsx — reusable right-side prompt Sheet.
 *
 * Used by:
 *  - v8/views/Chat/ChatView.tsx (the full chat surface)
 *  - v8/views/Agents/AgentsView.tsx (Send-prompt escalation per F-053)
 *  - v8/views/ClaudeSessions/ClaudeSessionDetail.tsx (follow-up send)
 *
 * Accepts an arbitrary `onSubmit(message, opts)` that the parent
 * implements (POST `/api/chat` or POST `/api/cc-agents/:id/send`,
 * etc.). The drawer:
 *   - Resets the textarea when re-opened with a new sessionId.
 *   - Streams via readEventStream() into the local `streaming` state.
 *   - Shows the streaming preview as a translucent assistant bubble
 *     so the user sees tokens arriving in real time.
 *   - Surfaces submit errors via inline error pill (no window.alert).
 */

import { useEffect, useState } from 'react';
import { Send, RefreshCw, X } from 'lucide-react';
import { Sheet, SheetContent } from '../feedback/Sheet.js';
import { Button } from '../controls/Button.js';
import { Textarea } from '../controls/Textarea.js';
import { Stack } from '../primitives/Stack.js';
import { Inline } from '../primitives/Inline.js';
import { readEventStream } from './EventStream.js';
import { MessageBubble, EmptyTranscript } from './MessageBubble.js';
import type { ChatMessage } from '../../data/types.js';

export interface ChatDrawerProps {
  /** Whether the drawer is mounted. Controlled by the parent. */
  open: boolean;
  /** Session id if resuming an existing chat session; else a new session is created on submit. */
  sessionId?: string | null;
  /** Display title in the sheet header. */
  title: string;
  /** Short description for the sheet subheader. */
  description?: string;
  /** Optional agent hint. POSTed as `body.agent` and rendered on the assistant bubble. */
  agent?: string | null;
  /** Submit handler. Receives the user's text + an optional streaming-callback hook. */
  onSubmit: (
    message: string,
    opts: {
      sessionId?: string | null;
      agent?: string | null;
      onStream?: (chunk: string) => void;
      signal: AbortSignal;
    },
  ) => Promise<void>;
  onClose: () => void;
  /** Optional initial transcript (used when resuming a session). */
  messages?: ChatMessage[];
}

export function ChatDrawer({
  open,
  sessionId,
  title,
  description,
  agent,
  onSubmit,
  onClose,
  messages: initialMessages = [],
}: ChatDrawerProps): JSX.Element {
  const [draft, setDraft] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when re-opened against a different session.
  useEffect(() => {
    setMessages(initialMessages);
    setStreaming('');
    setError(null);
    setDraft('');
  }, [sessionId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    setDraft('');
    const userMsg: ChatMessage = {
      id: `local_${Date.now().toString(36)}`,
      ts: new Date().toISOString(),
      role: 'user',
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming('');
    const ctrl = new AbortController();
    try {
      await onSubmit(text, {
        sessionId,
        agent,
        signal: ctrl.signal,
        onStream: (chunk) => {
          setStreaming((cur) => cur + chunk);
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setBusy(false);
      setStreaming('');
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        title={title}
        description={description}
        style={{ width: 'min(560px, 100vw)', padding: 0 }}
        data-testid="chat-drawer"
      >
        <Stack gap={2} style={{ height: '100%', padding: 'var(--space-3)' }}>
          <Inline align="center" justify="between">
            <Inline align="center" gap={2}>
              {agent && <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>{agent}</code>}
            </Inline>
            <Button variant="ghost" onClick={onClose} data-testid="chat-drawer-close">
              <X size={14} aria-hidden /> Close
            </Button>
          </Inline>

          <div
            data-testid="chat-drawer-transcript"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              background: 'var(--surface-0)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3)',
            }}
          >
            {messages.length === 0 && streaming === '' ? (
              <EmptyTranscript>Send a message to start.</EmptyTranscript>
            ) : (
              <Stack gap={1}>
                {messages.map((m) => (
                  <MessageBubble key={m.id} message={m} />
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

          {error && (
            <div
              role="alert"
              data-testid="chat-drawer-error"
              style={{
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                background: 'color-mix(in oklch, var(--danger) 12%, transparent)',
                color: 'var(--danger)',
                fontSize: 'var(--fs-12)',
              }}
            >
              {error}
            </div>
          )}

          <Inline align="end" gap={2}>
            <span style={{ flex: 1, color: 'var(--fg-muted)', fontSize: 'var(--fs-11)' }}>
              Shift+Enter for newline · Enter to send
            </span>
            <Button variant="primary" onClick={() => void submit()} disabled={busy || draft.trim() === ''} data-testid="chat-drawer-send">
              {busy ? <RefreshCw size={14} aria-hidden /> : <Send size={14} aria-hidden />}
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </Inline>

          <Textarea
            value={draft}
            placeholder="Ask Claude anything…"
            rows={4}
            data-testid="chat-drawer-input"
            onChange={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </Stack>
      </SheetContent>
    </Sheet>
  );
}
