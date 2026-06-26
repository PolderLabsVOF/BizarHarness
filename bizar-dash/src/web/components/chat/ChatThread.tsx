// src/components/chat/ChatThread.tsx — message list, welcome screen, loading skeleton.

import { useEffect, useRef } from 'react';
import { LoadingSkeleton } from './LoadingSkeleton';
import { WelcomeScreen } from './WelcomeScreen';
import { MessageBubble } from './MessageBubble';

interface Message {
  role?: string;
  content?: string;
  message?: string;
  agent?: string;
  ts?: string | number;
}

interface Props {
  messages: Message[];
  loading: boolean;
  activeProject: { name: string } | null;
  sessionId: string;
  pinned: Set<number>;
  onPickSuggestion: (text: string) => void;
  onCopy: (m: Message) => void;
  onDelete: (idx: number) => void;
  onTogglePin: (idx: number) => void;
  onRegenerate: (messageId: string) => void;
}

export function ChatThread({
  messages,
  loading,
  activeProject,
  sessionId,
  pinned,
  onPickSuggestion,
  onCopy,
  onDelete,
  onTogglePin,
  onRegenerate,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  if (loading) {
    return (
      <div className="chat-thread" ref={listRef}>
        <LoadingSkeleton count={3} />
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className="chat-thread" ref={listRef}>
        <WelcomeScreen variant="no-project" projectName="" onPickSuggestion={onPickSuggestion} />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="chat-thread" ref={listRef}>
        <WelcomeScreen variant="empty" projectName={activeProject.name} onPickSuggestion={onPickSuggestion} />
      </div>
    );
  }

  return (
    <div className="chat-thread" ref={listRef}>
      {messages.map((m, i) => (
        <MessageBubble
          key={`${i}-${m.ts ?? ''}`}
          message={m}
          pinned={pinned.has(i)}
          onCopy={() => onCopy(m)}
          onDelete={() => onDelete(i)}
          onTogglePin={() => onTogglePin(i)}
          onRegenerate={() => onRegenerate(String(m.ts ?? i))}
        />
      ))}
    </div>
  );
}