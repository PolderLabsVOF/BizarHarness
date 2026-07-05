// src/components/chat/ChatComposer.tsx — bottom composer pill (v4.2.5).
//
// v4.2.5 — small refinement: the pill's border picks up the
// activeSource color (opencode → accent border; bizar → neutral),
// so the user has visual confirmation that their next message will
// land in the right backend.

import { useState } from 'react';
import { Composer } from './Composer';

interface Props {
  agent: string;
  setAgent: (a: string) => void;
  model: string;
  setModel: (m: string) => void;
  text: string;
  setText: (t: string) => void;
  sending: boolean;
  onSend: () => void;
  attachments: string[];
  setAttachments: (a: string[] | ((prev: string[]) => string[])) => void;
  suggestions: Array<{ cmd: string; desc: string }>;
  onPickSuggestion: (cmd: string) => void;
  agents: Array<{ name: string }>;
  onAttach: () => void;
  /** Which stream will receive the next message. */
  activeSource?: 'bizar' | 'opencode' | null;
  /** Backward-compat — used to be page-level panel toggles. Ignored. */
  sessionsOpen?: boolean;
  /** Backward-compat — see sessionsOpen. */
  infoOpen?: boolean;
}

export function ChatComposer(props: Props) {
  const { text, sending, onSend, activeSource } = props;
  const [takingOff, setTakingOff] = useState(false);

  const handleSend = () => {
    if (!text.trim() || sending) return;
    setTakingOff(true);
    onSend();
    window.setTimeout(() => setTakingOff(false), 320);
  };

  return (
    <div
      className={`chat-composer-wrap chat-composer-source-${activeSource ?? 'none'}`}
    >
      <div className={`chat-composer-pill${takingOff ? ' takeoff' : ''}`}>
        <Composer {...props} onSend={handleSend} />
      </div>
      <div className="chat-composer-hint chat-muted">
        <span>
          <kbd>⏎</kbd> send
        </span>
        <span>
          <kbd>⇧⏎</kbd> newline
        </span>
        <span>
          <kbd>/</kbd> commands
        </span>
        {activeSource === 'opencode' && (
          <span className="chat-composer-source-hint">→ opencode</span>
        )}
        {activeSource === 'bizar' && (
          <span className="chat-composer-source-hint">→ bizar chat</span>
        )}
        {sending && <span className="chat-composer-source-hint">sending…</span>}
      </div>
    </div>
  );
}
