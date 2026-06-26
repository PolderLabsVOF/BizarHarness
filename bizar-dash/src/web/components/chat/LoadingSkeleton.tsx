// src/components/chat/LoadingSkeleton.tsx — pulsing skeleton bubbles while loading.

interface Props {
  count?: number;
}

export function LoadingSkeleton({ count = 3 }: Props) {
  return (
    <div className="chat-loading-skeleton" aria-label="Loading messages">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="chat-loading-skeleton-bubble">
          <div className="chat-loading-skeleton-meta" />
          <div className="chat-loading-skeleton-line" />
          <div className="chat-loading-skeleton-line short" />
        </div>
      ))}
    </div>
  );
}