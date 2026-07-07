// src/components/chat/FloatingComposer.tsx — sticky bottom wrapper for the composer pill.

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
  sessionsOpen: boolean;
  infoOpen: boolean;
  /** Which stream will receive the next message — propagates the
   *  pill border color and a small "→ cline" hint. */
  activeSource?: 'bizar' | 'cline' | null;
}

export function FloatingComposer(props: Props) {
  const { activeSource } = props;
  return (
    <div
      className={`chat-composer-wrap chat-composer-source-${activeSource ?? 'none'} legacy`}
    >
      <div className="chat-composer-pill">
        <Composer {...props} />
      </div>
    </div>
  );
}