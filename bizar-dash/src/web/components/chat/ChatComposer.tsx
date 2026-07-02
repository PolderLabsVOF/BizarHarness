// src/components/chat/ChatComposer.tsx — bottom composer pill (v3.22 design).
//
// Replaces FloatingComposer. Visual layout follows the design HTML:
//
//   [agent chip] [model badge] [──── textarea ────] [📎] [✨] [➤]
//
// All wrapped in a single pill (chat-composer-pill) with rounded ends
// and a focus-within accent border. The legacy Composer component
// already provides the textarea, agent chip menu, attachment tags,
// and slash-command suggestion dropdown — the redesign simply nests
// the Composer inside the new pill chrome and adds the hint row
// (⏎ / ⇧⏎ / /) underneath.
//
// Props match the original FloatingComposer EXACTLY (so Chat.tsx +
// MobileChat.tsx don't need any changes).

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
  /** Backward-compat — used to be page-level panel toggles. Ignored in
   *  the redesign (rail + info are always visible). */
  sessionsOpen?: boolean;
  /** Backward-compat — see sessionsOpen. */
  infoOpen?: boolean;
}

export function ChatComposer(props: Props) {
  const { text, sending, onSend } = props;
  const [takingOff, setTakingOff] = useState(false);

  // Wrap onSend with a brief takeoff animation — a small CSS hook on
  // the wrapper pill. We don't animate a specific element here; the
  // pill itself gets the brief `takeoff` class so the send button
  // (the last child of Composer) gets the animation if the design
  // wants it.
  const handleSend = () => {
    if (!text.trim()) return;
    setTakingOff(true);
    onSend();
    window.setTimeout(() => setTakingOff(false), 320);
  };

  return (
    <div className="chat-composer-wrap">
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
      </div>
    </div>
  );
}