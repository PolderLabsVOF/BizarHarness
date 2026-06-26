// src/components/chat/MessageBubble.tsx — user/assistant message with hover actions.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, RefreshCw, Pin, Trash2 } from 'lucide-react';
import { formatTime } from '../../lib/utils';

interface Message {
  role?: string;
  content?: string;
  message?: string;
  agent?: string;
  ts?: string | number;
}

interface Props {
  message: Message;
  pinned: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onRegenerate: () => void;
}

export function MessageBubble({ message, pinned, onCopy, onDelete, onTogglePin, onRegenerate }: Props) {
  const role = (message.role || 'assistant').toLowerCase();
  const ts = message.ts ? formatTime(message.ts) : '';
  const content = message.content || message.message || '';
  const isUser = role === 'user';

  return (
    <article className={`chat-message ${isUser ? 'chat-message-user' : 'chat-message-assistant'} ${pinned ? 'chat-message-pinned' : ''}`}>
      <header className="chat-message-meta">
        <span className="chat-message-role">{role}</span>
        {message.agent && <span className="chat-message-agent">@{message.agent}</span>}
        {ts && <time className="chat-message-time">{ts}</time>}
        {pinned && <span className="chat-message-pin">pinned</span>}
        <div className="chat-message-actions">
          <button type="button" className="chat-msg-action-btn" onClick={onCopy} title="Copy" aria-label="Copy">
            <Copy size={12} />
          </button>
          {!isUser && (
            <button type="button" className="chat-msg-action-btn" onClick={onRegenerate} title="Regenerate" aria-label="Regenerate">
              <RefreshCw size={12} />
            </button>
          )}
          <button type="button" className="chat-msg-action-btn" onClick={onTogglePin} title="Pin" aria-label="Pin">
            <Pin size={12} />
          </button>
          <button type="button" className="chat-msg-action-btn chat-msg-action-btn-danger" onClick={onDelete} title="Delete" aria-label="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </header>
      <div className="chat-message-content markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </article>
  );
}