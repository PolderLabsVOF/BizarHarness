// src/mobile/views/MobileChat.tsx — enhanced mobile chat with message actions, slash commands.
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Bot, Copy, RefreshCw, Trash2, ChevronDown } from 'lucide-react';
import { api } from '../../lib/api';
import { formatTime } from '../../lib/utils';
import type { ChatMessage, Settings, Snapshot } from '../../lib/types';
import { Ws } from '../../lib/ws';

type Props = {
  snapshot: Snapshot;
  settings: Settings | null;
  // v3.6.2 — Optional taskId to load a specific task's chat session.
  initialTaskId?: string | null;
  onClearTaskId?: () => void;
};

// v3.6.2 — Response from GET /api/tasks/:id/chat
type TaskChatSession = {
  sessionId?: string;
  messages: ChatMessage[];
};

const SLASH_COMMANDS = [
  { cmd: '/agent', desc: 'Switch agent' },
  { cmd: '/model', desc: 'Set model override' },
  { cmd: '/task', desc: 'Create a task' },
  { cmd: '/plan', desc: 'Create a plan' },
];

export function MobileChat({ snapshot, settings, initialTaskId, onClearTaskId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState(settings?.defaultAgent || 'odin');
  const [modelOverride, setModelOverride] = useState(settings?.defaultModel || '');
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [wsEpoch, setWsEpoch] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeTaskIdRef = useRef(initialTaskId ?? null);
  const didInitRef = useRef(false);

  const loadChat = useCallback(async () => {
    try {
      const data = await api.get<{ messages: ChatMessage[] }>('/chat?limit=100');
      setMessages(data.messages || []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  // v3.6.2 — Load chat messages for a specific task's opencode session.
  const loadTaskChat = useCallback(async (taskId: string) => {
    setLoading(true);
    try {
      const data = await api.get<TaskChatSession>(`/tasks/${encodeURIComponent(taskId)}/chat`);
      setMessages(data.messages || []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCurrentChat = useCallback(async () => {
    if (activeTaskIdRef.current) {
      await loadTaskChat(activeTaskIdRef.current);
      return;
    }
    await loadChat();
  }, [loadChat, loadTaskChat]);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    loadCurrentChat().finally(() => onClearTaskId?.());
  }, [loadCurrentChat, onClearTaskId]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const reconnect = () => {
      setWsEpoch((cur) => cur + 1);
      loadCurrentChat().catch(() => undefined);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') reconnect();
    };

    window.addEventListener('online', reconnect);
    window.addEventListener('pageshow', reconnect);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('online', reconnect);
      window.removeEventListener('pageshow', reconnect);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loadCurrentChat]);

  useEffect(() => {
    const ws = new Ws();
    const offMessage = ws.on((msg) => {
      if (msg.type !== 'chat:message') return;
      const next = msg.message;
      setMessages((cur) => {
        const exists = cur.some((item) => item.ts === next.ts && (item.content || item.message) === (next.content || next.message));
        return exists ? cur : [...cur, next];
      });
    });

    return () => {
      offMessage();
      ws.close();
    };
  }, [wsEpoch]);

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
      const response = await api.post<{ messages?: ChatMessage[] }>('/chat', {
        message,
        agent: activeAgent,
        model: activeModel || undefined,
      });
      if (response?.messages) {
        setMessages((cur) => {
          const nextMessages = [...cur];
          for (const next of response.messages || []) {
            if (next.role !== 'assistant') continue;
            const exists = nextMessages.some((item) => item.ts === next.ts && (item.content || item.message) === (next.content || next.message));
            if (!exists) nextMessages.push(next);
          }
          return nextMessages;
        });
      }
    } catch {
      // optimistic — keep message even on failure
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
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
            aria-expanded={showAgentPicker}
            aria-controls="mobile-chat-agent-picker"
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
          <div className="mobile-chat-agent-picker" id="mobile-chat-agent-picker">
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
        {messages.length === 0 && (
          <div className="mobile-empty">
            <Bot size={40} />
            <p>No messages yet.</p>
            <p className="muted">Type below to start a conversation.</p>
          </div>
        )}
        {messages.map((m, i) => {
          const role = (m.role || 'assistant').toLowerCase();
          const isAgent = role !== 'user';
          const content = m.content || m.message || '';
          return (
            <div key={m.ts || `${role}-${i}`} className={`mobile-message ${isAgent ? 'from-agent' : 'from-user'}`}>
              <div className="mobile-message-meta">
                <span className="mobile-message-role">{role}</span>
                {m.agent && <span className="mobile-message-agent">@{m.agent}</span>}
                {m.ts && <span className="mobile-message-time">{formatTime(m.ts)}</span>}
              </div>
              <div className="mobile-message-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
              {/* Message actions */}
              <div className="mobile-message-actions">
                {isAgent ? (
                  <button type="button" className="mobile-msg-action" onClick={() => {
                    const userMsg = messages.slice(0, i).reverse().find((entry) => (entry.role || '').toLowerCase() === 'user');
                    if (userMsg) {
                      setText(userMsg.content || '');
                      inputRef.current?.focus();
                    }
                  }} title="Retry">
                    <RefreshCw size={12} />
                  </button>
                ) : (
                  <>
                    <button type="button" className="mobile-msg-action" onClick={() => copyMessage(content)} title="Copy">
                      <Copy size={12} />
                    </button>
                    <button type="button" className="mobile-msg-action" onClick={() => {
                      setMessages((cur) => cur.filter((_, j) => j !== i));
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
          enterKeyHint="send"
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
