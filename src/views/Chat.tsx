// src/views/Chat.tsx — chat history + send box + slash suggestions.
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessageSquare, Send, RefreshCw, Eraser, CornerDownLeft } from 'lucide-react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn, formatTime } from '../lib/utils';
import type { ChatMessage, ChatResponse, Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type SlashCommand = { cmd: string; desc: string };

const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/plan new <slug>', desc: 'Create a new plan' },
  { cmd: '/plan list', desc: 'List plans' },
  { cmd: '/plan open <slug>', desc: 'Open a plan URL' },
  { cmd: '/plan status <slug> <status>', desc: 'Set plan status' },
  { cmd: '/visual-plan on|off', desc: 'Toggle visual plan mode' },
  { cmd: '/bizar', desc: 'Show Bizar menu / launch dashboard' },
  { cmd: '/audit', desc: 'Run security audit' },
  { cmd: '/explain <q>', desc: 'Read-only code Q&A' },
  { cmd: '/init', desc: 'Initialize .bizar/ in this project' },
  { cmd: '/learn', desc: 'Extract patterns from session' },
  { cmd: '/pr-review', desc: 'PR review with @mimir + @forseti' },
  { cmd: '/help', desc: 'Show all slash commands' },
];

export function Chat(_: Props) {
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<{ id: string; mtime: number }[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string>('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<SlashCommand[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadChat = async (sid?: string) => {
    try {
      const url = sid ? `/chat?session=${encodeURIComponent(sid)}` : '/chat?limit=200';
      const data = await api.get<ChatResponse>(url);
      setMessages(data.messages || []);
      setSessions(data.sessions || []);
    } catch (err) {
      toast.error(`Chat load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Slash-command suggestions
  useEffect(() => {
    if (text.startsWith('/') && !text.includes(' ')) {
      const q = text.toLowerCase();
      setSuggestions(
        SLASH_COMMANDS.filter((c) => c.cmd.toLowerCase().startsWith(q)).slice(
          0,
          6,
        ),
      );
    } else {
      setSuggestions([]);
    }
  }, [text]);

  const onSend = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    const optimistic: ChatMessage = {
      role: 'user',
      content: message,
      ts: new Date().toISOString(),
    };
    setMessages((cur) => [...cur, optimistic]);
    setText('');
    setSuggestions([]);
    try {
      await api.post('/chat', { message });
      toast.success('Message accepted. Open the TUI to dispatch.');
    } catch (err) {
      setMessages((cur) => cur.filter((m) => m !== optimistic));
      toast.error(`Send failed: ${(err as Error).message}`);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    } else if (e.key === 'Tab' && suggestions.length) {
      e.preventDefault();
      const first = suggestions[0];
      const base = first.cmd.split(' ')[0];
      setText(`${base} `);
      setSuggestions([]);
    }
  };

  // Sort newest at the bottom for chat feel
  const ordered = [...messages].reverse();

  return (
    <div className="view view-chat">
      <header className="view-header chat-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <MessageSquare size={18} /> Chat
          </h2>
          <p className="view-subtitle">
            Conversation history. Press Enter to send, Shift+Enter for newline.
          </p>
        </div>
        <div className="view-actions">
          <select
            className="select select-sm"
            value={sessionId}
            onChange={(e) => {
              const sid = e.target.value;
              setSessionId(sid);
              loadChat(sid || undefined);
            }}
          >
            <option value="">All sessions ({sessions.length})</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id.slice(0, 28)}… ·{' '}
                {new Date(s.mtime).toLocaleDateString()}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadChat(sessionId || undefined)}
          >
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMessages([])}>
            <Eraser size={14} /> Clear view
          </Button>
        </div>
      </header>

      <div className="chat-container">
        <div className="chat-list" ref={listRef}>
          {loading ? (
            <div className="view-loading">
              <Spinner />
            </div>
          ) : ordered.length === 0 ? (
            <EmptyState
              icon={<MessageSquare size={28} />}
              title="No messages yet"
              message="Type something below to start."
            />
          ) : (
            ordered.map((m, idx) => <ChatBubble key={idx} message={m} />)
          )}
        </div>

        <div className="chat-composer">
          {suggestions.length > 0 && (
            <div className="chat-suggestions">
              {suggestions.map((s) => (
                <button
                  type="button"
                  key={s.cmd}
                  className="chat-suggestion"
                  onClick={() => {
                    const base = s.cmd.split(' ')[0];
                    setText(`${base} `);
                    inputRef.current?.focus();
                  }}
                >
                  <span className="mono">{s.cmd}</span>
                  <span className="chat-suggestion-desc">{s.desc}</span>
                </button>
              ))}
            </div>
          )}
          <div className="chat-composer-row">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder="Send a message… (Enter to send, Shift+Enter for newline, / for commands)"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending}
            />
            <Button
              variant="primary"
              onClick={onSend}
              disabled={sending || !text.trim()}
            >
              {sending ? <Spinner size="sm" /> : <Send size={14} />}{' '}
              <span>Send</span>{' '}
              <CornerDownLeft size={12} className="hint-key" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const role = (message.role || 'assistant').toLowerCase();
  const ts = message.ts ? formatTime(message.ts) : '';
  const content = message.content || message.message || '';
  return (
    <div className={cn('chat-msg', `chat-msg-${role}`)}>
      <div className="chat-msg-meta">
        <span className="chat-msg-role">{role}</span>
        {message.agent && <span className="chat-msg-agent">{message.agent}</span>}
        {ts && <span className="chat-msg-ts tabular-nums">{ts}</span>}
      </div>
      <div className="chat-msg-body markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
