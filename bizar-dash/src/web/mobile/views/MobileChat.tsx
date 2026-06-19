// src/mobile/views/MobileChat.tsx — mobile chat tab: messages + sticky composer.
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Bot } from 'lucide-react';
import { api } from '../../lib/api';
import { formatTime } from '../../lib/utils';
import type { ChatMessage, Settings, Snapshot } from '../../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings | null;
};

export function MobileChat({ snapshot, settings }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState(settings?.defaultAgent || 'odin');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadChat = async () => {
    try {
      const data = await api.get<{ messages: ChatMessage[] }>('/chat?limit=100');
      setMessages(data.messages || []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChat();
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const onSend = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    const optimistic: ChatMessage = {
      role: 'user',
      content: message,
      agent,
      ts: new Date().toISOString(),
    };
    setMessages((cur) => [...cur, optimistic]);
    setText('');
    try {
      await api.post('/chat', { message, agent });
    } catch {
      // optimistic — keep message even on failure
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  // Newest at bottom
  const ordered = [...messages].reverse();

  if (loading) {
    return <div className="mobile-loading"><p>Loading…</p></div>;
  }

  return (
    <div className="mobile-view mobile-view-chat">
      <div className="mobile-messages" ref={listRef}>
        {ordered.length === 0 && (
          <div className="mobile-empty">
            <Bot size={40} />
            <p>No messages yet.</p>
            <p className="muted">Type below to start a conversation.</p>
          </div>
        )}
        {ordered.map((m, i) => {
          const role = (m.role || 'assistant').toLowerCase();
          const isAgent = role !== 'user';
          return (
            <div key={i} className={`mobile-message ${isAgent ? 'from-agent' : 'from-user'}`}>
              <div className="mobile-message-meta">
                <span className="mobile-message-role">{role}</span>
                {m.agent && <span className="mobile-message-agent">@{m.agent}</span>}
                {m.ts && <span className="mobile-message-time">{formatTime(m.ts)}</span>}
              </div>
              <div className="mobile-message-body">
                <ReactMarkdown>{m.content || m.message || ''}</ReactMarkdown>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky composer */}
      <div className="mobile-chat-composer">
        <select
          className="mobile-agent-select"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          aria-label="Agent"
        >
          {(snapshot.agents || []).map((a) => (
            <option key={a.name} value={a.name}>
              @{a.name}
            </option>
          ))}
        </select>
        <textarea
          ref={inputRef}
          className="mobile-chat-input"
          placeholder="Message…"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
          aria-label="Message"
        />
        <button
          type="button"
          className="mobile-send-btn"
          onClick={onSend}
          disabled={sending || !text.trim()}
          aria-label="Send"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
