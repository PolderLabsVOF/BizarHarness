// src/components/chat/Composer.tsx — textarea + toolbar, used inside FloatingComposer.

import { useRef } from 'react';
import { Send, Paperclip, X, Sparkles } from 'lucide-react';
import { enhancePrompt } from '../../lib/api';
import { AgentChip } from './AgentChip';
import { useAutoGrowTextarea } from './useAutoGrowTextarea';

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
}

export function Composer({
  agent,
  setAgent,
  model,
  setModel,
  text,
  setText,
  sending,
  onSend,
  attachments,
  setAttachments,
  suggestions,
  onPickSuggestion,
  agents,
  onAttach,
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useAutoGrowTextarea(inputRef, text, 200);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    } else if (e.key === 'Tab' && suggestions.length) {
      e.preventDefault();
      const base = suggestions[0].cmd.split(' ')[0];
      setText(`${base} `);
    }
  };

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const names: string[] = [];
    for (let i = 0; i < files.length; i++) names.push(files[i].name);
    setAttachments((cur) => [...cur, ...names]);
    e.target.value = '';
  };

  return (
    <div className="chat-composer">
      {suggestions.length > 0 && (
        <div className="chat-composer-suggestions">
          {suggestions.map((s) => (
            <button
              key={s.cmd}
              type="button"
              className="chat-composer-suggestion"
              onClick={() => {
                const base = s.cmd.split(' ')[0];
                setText(`${base} `);
                inputRef.current?.focus();
              }}
            >
              <span className="mono">{s.cmd}</span>
              <span>{s.desc}</span>
            </button>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="chat-composer-attachments">
          {attachments.map((a, i) => (
            <span key={i} className="chat-composer-attachment-tag">
              <Paperclip size={10} /> {a}
              <button
                type="button"
                className="chat-composer-attachment-remove"
                onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}
                aria-label={`Remove ${a}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="chat-composer-input">
        <AgentChip agent={agent} setAgent={setAgent} agents={agents} />
        <textarea
          ref={inputRef}
          className="chat-composer-textarea"
          placeholder={sending ? 'Sending…' : 'Send a message…'}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
          aria-label="Message"
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={onFiles}
        />
        <button
          type="button"
          className="chat-attach-btn"
          onClick={onAttach}
          title="Attach files"
          aria-label="Attach files"
        >
          <Paperclip size={14} />
        </button>
        <button
          type="button"
          className="chat-attach-btn"
          onClick={async () => {
            if (!text.trim()) return;
            const enhanced = await enhancePrompt(text);
            if (enhanced !== text) setText(enhanced);
          }}
          title="Enhance prompt with AI"
          aria-label="Enhance prompt"
        >
          <Sparkles size={14} />
        </button>
        <button
          type="button"
          className="chat-send-btn"
          onClick={onSend}
          disabled={sending || !text.trim()}
          title="Send (Enter)"
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}