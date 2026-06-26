// src/components/chat/ChatBubble.tsx — renders a single chat message with actions.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pin, Copy, RefreshCw, Trash2 } from 'lucide-react';
import { cn, formatTime } from '../../lib/utils';
import type { ChatMessage } from '../../lib/types';

export type ChatBubbleProps = {
  message: ChatMessage;
  pinned: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onRegenerate: () => void;
};

export function ChatBubble({ message, pinned, onCopy, onDelete, onTogglePin, onRegenerate }: ChatBubbleProps) {
  const role = (message.role || 'assistant').toLowerCase();
  const ts = message.ts ? formatTime(message.ts) : '';
  const content = message.content || message.message || '';

  return (
    <div
      className={cn('chat-msg', `chat-msg-${role}`, pinned && 'chat-msg-pinned')}
      role="region"
      aria-label={`${role} message${message.agent ? ` from @${message.agent}` : ''}`}
    >
      <div className="chat-msg-meta">
        <span className="chat-msg-role">{role}</span>
        {message.agent && <span className="chat-msg-agent">@{message.agent}</span>}
        {ts && <span className="chat-msg-ts tabular-nums">{ts}</span>}
        {pinned && (
          <span className="chat-msg-pin">
            <Pin size={10} /> pinned
          </span>
        )}
        <div className="chat-msg-actions">
          <button type="button" className="icon-btn" aria-label="Copy" title="Copy" onClick={onCopy}>
            <Copy size={12} />
          </button>
          {role !== 'user' && (
            <button type="button" className="icon-btn" aria-label="Regenerate" title="Regenerate" onClick={onRegenerate}>
              <RefreshCw size={12} />
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Pin" title="Pin" onClick={onTogglePin}>
            <Pin size={12} />
          </button>
          <button type="button" className="icon-btn icon-btn-danger" aria-label="Delete" title="Delete" onClick={onDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="chat-msg-body markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}