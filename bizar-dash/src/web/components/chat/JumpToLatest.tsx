// src/components/chat/JumpToLatest.tsx — floating pill above the composer.
//
// Two visual variants:
//   - streaming (current session is being replied to): pulsing indigo
//     border + 3-dot bounce + green "live" badge
//   - idle: neutral pill + down-arrow icon + "N new" badge
//
// Hidden entirely when the user is already at the bottom of the thread
// (controlled by the parent's `stickToBottom` flag).

import { ArrowDown } from 'lucide-react';

interface Props {
  streaming: boolean;
  newMessageCount: number;
  onClick: () => void;
  /** Optional label override (e.g. "Odin is replying"). */
  streamingLabel?: string;
}

export function JumpToLatest({
  streaming,
  newMessageCount,
  onClick,
  streamingLabel = 'Odin is replying',
}: Props) {
  return (
    <button
      type="button"
      className={`jump-to-latest${streaming ? ' is-streaming' : ''}`}
      onClick={onClick}
      aria-label="Jump to latest message"
      title="Jump to latest (⌘/Ctrl+End)"
    >
      {streaming ? (
        <>
          <span className="jump-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span>{streamingLabel}</span>
          {newMessageCount > 0 && (
            <span className="jump-badge jump-badge-live">live</span>
          )}
        </>
      ) : (
        <>
          <ArrowDown size={14} aria-hidden />
          <span>Jump to latest</span>
          {newMessageCount > 0 && (
            <span className="jump-badge">{newMessageCount} new</span>
          )}
        </>
      )}
    </button>
  );
}