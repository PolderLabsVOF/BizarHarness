// src/components/chat/StreamingIndicator.tsx — phase indicator in the message meta row.
//
// Phase-driven label + 3-dot bounce. The dot animation duration
// shortens as the message progresses (think → stream → commit), so
// the visual rhythm matches the streaming cadence.
//
// The named export `StreamingIndicator` keeps its signature backward-
// compatible: argumentless → defaults to "think" phase (legacy
// dot-bounce used by WelcomeScreen + the old MessageBubble).

import type { StreamingPhase } from './MessageBlock';

interface Props {
  /** Streaming phase. Defaults to 'think' for the legacy
   *  argumentless call site. */
  phase?: StreamingPhase;
}

const LABELS: Record<Exclude<StreamingPhase, 'idle'>, string> = {
  think: 'thinking',
  stream: 'streaming tokens',
  commit: 'committing',
};

export function StreamingIndicator({ phase = 'think' }: Props) {
  const label = phase === 'idle' ? null : LABELS[phase];
  return (
    <span className={`msg-stream-indicator phase-${phase}`}>
      {label && <span className="msg-stream-label">{label}</span>}
      <span className="msg-stream-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}