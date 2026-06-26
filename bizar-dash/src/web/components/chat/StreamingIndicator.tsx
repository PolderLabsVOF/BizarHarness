// src/components/chat/StreamingIndicator.tsx — animated typing indicator.

export function StreamingIndicator() {
  return (
    <div className="chat-streaming-indicator" aria-label="Assistant is typing">
      <span /><span /><span />
    </div>
  );
}