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
  const innerRef = useRef<HTMLDivElement>(null);

  // v3.22 — only auto-scroll when we own the scroll container (i.e.
  // when rendered directly as the message scroller). When embedded
  // inside Chat.tsx's chat-thread-scroll, the parent handles scroll.
  // We detect this by checking if our closest scroll ancestor is
  // ourselves; if so, auto-scroll. Otherwise, no-op.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    // If we ARE the scroll container (legacy / mobile path), scroll.
    // If a parent .chat-thread-scroll wraps us, the parent scrolls.
    const isScroller = el.scrollHeight > el.clientHeight && el.matches(':scope');
    // Simpler heuristic: if no `.chat-thread-scroll` ancestor exists,
    // auto-scroll. Otherwise let the parent handle it.
    let p: HTMLElement | null = el.parentElement;
    let wrapped = false;
    while (p) {
      if (p.classList.contains('chat-thread-scroll')) {
        wrapped = true;
        break;
      }
      p = p.parentElement;
    }
    if (!wrapped) el.scrollTop = el.scrollHeight;
    // isScroller is referenced for clarity; suppress unused warning.
    void isScroller;
  }, [messages]);

  if (loading) {
    return (
      <div className="chat-thread legacy" ref={innerRef}>
        <LoadingSkeleton count={3} />
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className="chat-thread legacy" ref={innerRef}>
        <WelcomeScreen variant="no-project" projectName="" onPickSuggestion={onPickSuggestion} />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="chat-thread legacy" ref={innerRef}>
        <WelcomeScreen variant="empty" projectName={activeProject.name} onPickSuggestion={onPickSuggestion} />
      </div>
    );
  }

  return (
    <div className="chat-thread legacy" ref={innerRef}>
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