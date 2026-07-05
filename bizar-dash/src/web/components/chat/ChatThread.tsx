// src/components/chat/ChatThread.tsx — message list, welcome screen, loading skeleton.
//
// v4.2.5 — accepts `activeSource` so the loading skeleton can hint
// which stream is loading and the welcome variant for "opencode"
// can differ from the local chat welcome.

import { useEffect, useRef } from 'react';
import { LoadingSkeleton } from './LoadingSkeleton';
import { WelcomeScreen } from './WelcomeScreen';
import { MessageBubble } from './MessageBubble';
import { VirtualList } from '../VirtualList';

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
  /** Which stream currently owns the thread — purely cosmetic, lets
   *  the empty/loading states be slightly more specific. The type
   *  uses `unknown` so we don't pull in a tight coupling; the value
   *  is reflected back into the loading skeleton and welcome screen
   *  via data attributes so CSS can style accordingly. */
  activeSource?: 'bizar' | 'opencode' | null;
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
  activeSource,
  onPickSuggestion,
  onCopy,
  onDelete,
  onTogglePin,
  onRegenerate,
}: Props) {
  const innerRef = useRef<HTMLDivElement>(null);

  // Only auto-scroll when we own the scroll container (i.e. when
  // rendered directly as the message scroller). When embedded
  // inside Chat.tsx's chat-thread-scroll, the parent handles scroll.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
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
  }, [messages]);

  const stream: 'bizar' | 'opencode' = activeSource === 'opencode' ? 'opencode' : 'bizar';

  if (loading) {
    return (
      <div className="chat-thread legacy" ref={innerRef} data-stream={stream}>
        <LoadingSkeleton count={3} />
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className="chat-thread legacy" ref={innerRef} data-stream={stream}>
        <WelcomeScreen
          variant="no-project"
          projectName=""
          onPickSuggestion={onPickSuggestion}
        />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="chat-thread legacy" ref={innerRef} data-stream={stream}>
        <WelcomeScreen
          variant="empty"
          projectName={activeProject.name}
          onPickSuggestion={onPickSuggestion}
        />
      </div>
    );
  }

  return (
    <div className="chat-thread legacy" ref={innerRef}>
      <VirtualList
        items={messages}
        itemHeight={120}
        height={800}
        className="chat-thread-virtual"
        renderItem={(m, i) => (
          <MessageBubble
            message={m}
            pinned={pinned.has(i)}
            onCopy={() => onCopy(m)}
            onDelete={() => onDelete(i)}
            onTogglePin={() => onTogglePin(i)}
            onRegenerate={() => onRegenerate(String(m.ts ?? i))}
          />
        )}
      />
    </div>
  );
}
