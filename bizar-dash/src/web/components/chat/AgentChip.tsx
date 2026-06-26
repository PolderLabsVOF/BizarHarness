// src/components/chat/AgentChip.tsx — custom popover agent picker, replaces <select>.

import { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown } from 'lucide-react';

interface Props {
  agent: string;
  setAgent: (a: string) => void;
  agents: Array<{ name: string }>;
}

export function AgentChip({ agent, setAgent, agents }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = agent || 'no agent';
  const display = current.startsWith('@') ? current.slice(1) : current;

  return (
    <div className="chat-agent-chip" ref={ref}>
      <button
        type="button"
        className="chat-agent-chip-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Bot size={14} />
        <span>{display}</span>
        <ChevronDown size={12} className={open ? 'rotated' : ''} />
      </button>
      {open && (
        <div className="chat-agent-chip-menu" role="listbox">
          <button
            type="button"
            role="option"
            aria-selected={!agent}
            onClick={() => { setAgent(''); setOpen(false); }}
          >
            <span>no agent</span>
          </button>
          {agents.map((a) => (
            <button
              key={a.name}
              type="button"
              role="option"
              aria-selected={agent === a.name}
              onClick={() => { setAgent(a.name); setOpen(false); }}
            >
              <span>@{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}