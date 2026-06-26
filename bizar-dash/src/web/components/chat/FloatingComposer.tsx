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
}

export function FloatingComposer(props: Props) {
  return (
    <div className="chat-composer-wrap">
      <div className="chat-composer-pill">
        <Composer {...props} />
      </div>
    </div>
  );
}