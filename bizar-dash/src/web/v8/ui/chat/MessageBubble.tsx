/**
 * v8/ui/chat/MessageBubble.tsx — single chat message surface.
 *
 * Renders a single message from `/api/chat?session=…` as either a
 * user / assistant / system / tool bubble. Uses the existing
 * `react-markdown` dependency for assistant content (the only place
 * where markdown formatting is needed) and renders plain text for the
 * other roles.
 *
 * Tones (per v8 design):
 *   - user:    right-aligned, accent background
 *   - assistant: left-aligned, surface-1 background, markdown rendered
 *   - system:  centered, fg-muted, no nesting
 *   - tool:    left-aligned, surface-2 background, mono font
 */

import { memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '../../data/types.js';

export interface MessageBubbleProps {
  message: ChatMessage;
  /** Regenerate handler, wired by the chat view. */
  onRegenerate?: (message: ChatMessage) => void;
}

const ROLE_TONE: Record<ChatMessage['role'], 'user' | 'assistant' | 'system' | 'tool'> = {
  user: 'user',
  assistant: 'assistant',
  system: 'system',
  tool: 'tool',
};

const roleLabel = (role: ChatMessage['role']): string => {
  switch (role) {
    case 'user': return 'You';
    case 'assistant': return 'Claude';
    case 'system': return 'System';
    case 'tool': return 'Tool';
  }
};

const fmtTs = (iso: string): string => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleTimeString();
};

export const MessageBubble = memo(function MessageBubble({ message, onRegenerate }: MessageBubbleProps): JSX.Element {
  const tone = ROLE_TONE[message.role] ?? 'assistant';
  const ts = fmtTs(message.ts);
  const isAssistant = message.role === 'assistant';
  return (
    <div
      data-testid={`chat-bubble-${tone}`}
      data-message-id={message.id}
      style={{
        display: 'flex',
        flexDirection: tone === 'user' ? 'row-reverse' : 'row',
        gap: 'var(--space-2)',
        alignItems: 'flex-start',
        padding: 'var(--space-2) 0',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: 'var(--radius-pill)',
          background:
            tone === 'user'
              ? 'var(--accent)'
              : tone === 'tool'
                ? 'var(--surface-2)'
                : 'var(--surface-1)',
          color: tone === 'user' ? 'var(--accent-fg)' : 'var(--fg)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--fs-11)',
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {roleLabel(message.role).slice(0, 2)}
      </div>
      <div
        style={{
          maxWidth: 'min(560px, 100%)',
          padding: 'var(--space-3)',
          borderRadius: 'var(--radius-md)',
          background:
            tone === 'user'
              ? 'var(--surface-1)'
              : tone === 'tool'
                ? 'var(--surface-2)'
                : 'var(--surface-0)',
          border:
            tone === 'user'
              ? '1px solid var(--accent)'
              : '1px solid var(--border)',
          fontSize: 'var(--fs-13)',
          lineHeight: 1.45,
          wordBreak: 'break-word',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
          <strong style={{ fontSize: 'var(--fs-12)' }}>{roleLabel(message.role)}</strong>
          {message.agent && message.role !== 'user' && (
            <code style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
              {message.agent}
            </code>
          )}
          {ts && (
            <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-11)' }}>{ts}</span>
          )}
        </div>
        {isAssistant ? (
          <div className="chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
        )}
        {isAssistant && onRegenerate && (
          <button
            type="button"
            onClick={() => onRegenerate(message)}
            data-testid={`chat-regenerate-${message.id}`}
            style={{
              marginTop: 'var(--space-2)',
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--fg-muted)',
              fontSize: 'var(--fs-11)',
              cursor: 'pointer',
            }}
          >
            Regenerate
          </button>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <ul style={{ marginTop: 'var(--space-2)', marginBottom: 0, paddingLeft: 'var(--space-4)', fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
            {message.attachments.map((a, i) => (
              <li key={i}>
                {a.kind ?? 'attachment'}: {a.name ?? a.url ?? '(unnamed)'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

export function EmptyTranscript({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <div
      data-testid="chat-transcript-empty"
      style={{
        textAlign: 'center',
        color: 'var(--fg-muted)',
        fontSize: 'var(--fs-13)',
        padding: 'var(--space-5)',
      }}
    >
      {children ?? 'No messages yet. Send the first message to start a session.'}
    </div>
  );
}
