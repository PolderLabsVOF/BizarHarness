// src/mobile/views/MobileChat.tsx — enhanced mobile chat with message actions, slash commands.
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Bot, Copy, RefreshCw, Trash2, ChevronDown, Paperclip } from 'lucide-react';
import { api } from '../../lib/api';
import { formatTime } from '../../lib/utils';
import type { ChatMessage, Settings, Snapshot } from '../../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings | null;
};

const SLASH_COMMANDS = [
  { cmd: '/agent', desc: 'Switch agent' },
  { cmd: '/model', desc: 'Set model override' },
  { cmd: '/task', desc: 'Create a task' },
  { cmd: '/plan', desc: 'Create a plan' },
];

export function MobileChat({ snapshot, settings }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState(settings?.defaultAgent || 'odin');
  const [modelOverride, setModelOverride] = useState(settings?.defaultModel || '');
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [retryIdx, setRetryIdx] = useState<number | null>(null);
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

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (message: string, retryAgent?: string, retryModel?: string) => {
    const activeAgent = retryAgent || agent;
    const activeModel = retryModel || modelOverride;
    setSending(true);
    const optimistic: ChatMessage = {
      role: 'user',
      content: message,
      agent: activeAgent,
      ts: new Date().toISOString(),
    };
    setMessages((cur) => [...cur, optimistic]);
    setText('');
    setShowSlashMenu(false);
    try {
      await api.post('/chat', {
        message,
        agent: activeAgent,
        model: activeModel || undefined,
      });
    } catch {
      // optimistic — keep message even on failure
    } finally {
      setSending(false);
    }
  };

  const onSend = () => {
    const message = text.trim();
    if (!message || sending) return;
    sendMessage(message);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
    if (e.key === '/' && text === '') {
      setShowSlashMenu(true);
    }
  };

  const onTextChange = (value: string) => {
    setText(value);
    if (!value.startsWith('/')) {
      setShowSlashMenu(false);
    }
  };

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content).catch(() => {});
  };

  const ordered = [...messages].reverse();

  if (loading) {
    return <div className="mobile-loading"><p>Loading…</p></div>;
  }

  return (
    <div className="mobile-view mobile-view-chat">
      {/* Agent picker topbar */}
      <div className="mobile-chat-topbar">
        <button
          type="button"
          className="mobile-chat-agent-btn"
          onClick={() => setShowAgentPicker((v) => !v)}
        >
          <Bot size={14} />
          <span>@{agent}</span>
          <ChevronDown size={12} />
        </button>
        {modelOverride && (
          <span className="mobile-chat-model-badge mono">{modelOverride}</span>
        )}
      </div>

      {/* Agent picker dropdown */}
      {showAgentPicker && (
        <div className="mobile-chat-agent-picker">
          {(snapshot.agents || []).map((a) => (
            <button
              key={a.name}
              type="button"
              className={`mobile-chat-agent-option ${agent === a.name ? 'active' : ''}`}
              onClick={() => { setAgent(a.name); setShowAgentPicker(false); }}
            >
              <Bot size={12} /> @{a.name}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
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
              {/* Message actions */}
              <div className="mobile-message-actions">
                {isAgent ? (
                  <button type="button" className="mobile-msg-action" onClick={() => {
                    const userMsg = messages[messages.length - 1 - i];
                    if (userMsg) {
                      setRetryIdx(messages.length - 1 - i);
                      setText(userMsg.content || '');
                    }
                  }} title="Retry">
                    <RefreshCw size={12} />
                  </button>
                ) : (
                  <>
                    <button type="button" className="mobile-msg-action" onClick={() => copyMessage(m.content || '')} title="Copy">
                      <Copy size={12} />
                    </button>
                    <button type="button" className="mobile-msg-action" onClick={() => {
                      setMessages((cur) => cur.filter((_, j) => j !== messages.length - 1 - i));
                    }} title="Delete">
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Slash command menu */}
      {showSlashMenu && (
        <div className="mobile-slash-menu">
          {SLASH_COMMANDS.map((sc) => (
            <button
              key={sc.cmd}
              type="button"
              className="mobile-slash-item"
              onClick={() => {
                setText(sc.cmd + ' ');
                setShowSlashMenu(false);
                inputRef.current?.focus();
              }}
            >
              <span className="mono">{sc.cmd}</span>
              <span className="muted">{sc.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Sticky composer */}
      <div className="mobile-chat-composer">
        {modelOverride && (
          <button
            type="button"
            className="mobile-icon-btn"
            onClick={() => setModelOverride('')}
            title="Clear model override"
          >
            <span className="mobile-chat-model-badge mono" style={{ fontSize: 10 }}>✕</span>
          </button>
        )}
        <select
          className="mobile-agent-select"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          aria-label="Agent"
        >
          {(snapshot.agents || []).map((a) => (
            <option key={a.name} value={a.name}>@{a.name}</option>
          ))}
        </select>
        <textarea
          ref={inputRef}
          className="mobile-chat-input"
          placeholder="Message…"
          rows={1}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
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
