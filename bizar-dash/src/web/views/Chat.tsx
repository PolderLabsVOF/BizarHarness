// src/views/Chat.tsx — v3 floating chat: messages, sessions, agent selector, slash autocomplete.
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  MessageSquare,
  Send,
  CornerDownLeft,
  Bot,
  Paperclip,
  Pin,
  Copy,
  RefreshCw,
  Trash2,
  Server,
  Wrench,
  Terminal,
  FileText,
  Sparkles,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { api } from '../lib/api';
import { cn, formatTime } from '../lib/utils';
import type {
  Agent,
  ChatMessage,
  ChatResponse,
  ChatSession,
  McpServer,
  Mod,
  Settings,
  Snapshot,
} from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type SlashCommand = { cmd: string; desc: string; mod?: string };

const BUILTIN_COMMANDS: SlashCommand[] = [
  { cmd: '/plan new <slug>', desc: 'Create a new plan' },
  { cmd: '/plan list', desc: 'List plans' },
  { cmd: '/plan open <slug>', desc: 'Open a plan URL' },
  { cmd: '/plan status <slug> <status>', desc: 'Set plan status' },
  { cmd: '/bizar', desc: 'Show Bizar menu' },
  { cmd: '/audit', desc: 'Run security audit' },
  { cmd: '/explain <q>', desc: 'Read-only code Q&A' },
  { cmd: '/init', desc: 'Initialize .bizar/ in this project' },
  { cmd: '/learn', desc: 'Extract patterns from session' },
  { cmd: '/pr-review', desc: 'PR review' },
  { cmd: '/help', desc: 'Show all slash commands' },
];

export function Chat({ snapshot, settings }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string>('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [agent, setAgent] = useState<string>(settings.defaultAgent || 'odin');
  const [model, setModel] = useState<string>(settings.defaultModel || '');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<SlashCommand[]>([]);
  const [pinned, setPinned] = useState<Set<number>>(new Set());
  const [sessionPanelOpen, setSessionPanelOpen] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allCommands: SlashCommand[] = [
    ...BUILTIN_COMMANDS,
    ...(snapshot.mods || []).flatMap((m: Mod) =>
      (m.entry?.command ? [{ cmd: `/${m.id}`, desc: m.description || m.name, mod: m.id }] : []),
    ),
  ];

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
        allCommands.filter((c) => c.cmd.toLowerCase().startsWith(q)).slice(0, 6),
      );
    } else {
      setSuggestions([]);
    }
  }, [text, allCommands.length]);

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
    setSuggestions([]);
    try {
      await api.post('/chat', { message, agent, model, attachments });
      toast.success('Message accepted.');
    } catch (err) {
      setMessages((cur) => cur.filter((m) => m !== optimistic));
      toast.error(`Send failed: ${(err as Error).message}`);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    } else if (e.key === 'Enter' && !e.shiftKey) {
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

  const onAttach = () => fileInputRef.current?.click();

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const next: string[] = [];
    for (let i = 0; i < files.length; i++) {
      // Use webkitRelativePath or just name
      next.push(files[i].name);
    }
    setAttachments((cur) => [...cur, ...next]);
    e.target.value = '';
  };

  const copyMessage = (m: ChatMessage) => {
    const text = m.content || m.message || '';
    navigator.clipboard?.writeText(text).then(
      () => toast.success('Copied.', 1200),
      () => toast.error('Copy failed.'),
    );
  };

  const deleteMessage = (idx: number) => {
    if (!confirm('Delete this message?')) return;
    setMessages((cur) => cur.filter((_, i) => i !== idx));
  };

  const togglePin = (idx: number) => {
    setPinned((cur) => {
      const next = new Set(cur);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Newest at the bottom for chat feel
  const ordered = [...messages].reverse();
  const orderedWithPinned = [
    ...ordered.filter((_, i) => pinned.has(messages.length - 1 - i)),
    ...ordered.filter((_, i) => !pinned.has(messages.length - 1 - i)),
  ];

  return (
    <div className="view view-chat">
      <header className="view-header chat-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <MessageSquare size={18} /> Chat
          </h2>
          <p className="view-subtitle">
            {snapshot.activeProject ? (
              <>Active project: <strong>{snapshot.activeProject.name}</strong></>
            ) : (
              'No active project — pick one in Overview to scope chat sessions.'
            )}
          </p>
        </div>
        <div className="view-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSessionPanelOpen((v) => !v)}
            title="Toggle session panel"
          >
            Sessions ({sessions.length})
          </Button>
          <Button variant="secondary" size="sm" onClick={() => loadChat(sessionId || undefined)}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </header>

      <div className="chat-layout">
        {sessionPanelOpen && (
          <aside className="chat-sessions">
            <div className="chat-sessions-head">
              <span className="muted">Sessions</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="New session"
                title="New session"
                onClick={() => {
                  setSessionId('');
                  setMessages([]);
                }}
              >
                <Sparkles size={12} />
              </button>
            </div>
            <ul className="chat-sessions-list">
              {sessions.length === 0 && (
                <li className="muted">No sessions yet.</li>
              )}
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className={cn('chat-session-item', sessionId === s.id && 'active')}
                  onClick={() => {
                    setSessionId(s.id);
                    loadChat(s.id);
                  }}
                >
                  <span className="chat-session-id">{s.id}</span>
                  <span className="chat-session-meta">{new Date(s.mtime).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <div className="chat-main">
          <div className="chat-list" ref={listRef}>
            {loading ? (
              <div className="view-loading"><Spinner /></div>
            ) : messages.length === 0 ? (
              <EmptyState
                icon={<MessageSquare size={28} />}
                title="No messages yet"
                message="Type something below to start. Press / for commands, Tab to autocomplete, ⌘/Ctrl+Enter to send."
              />
            ) : (
              orderedWithPinned.map((m, idx) => {
                const originalIdx = messages.length - 1 - idx;
                return (
                  <ChatBubble
                    key={`${originalIdx}-${m.ts ?? ''}`}
                    message={m}
                    pinned={pinned.has(originalIdx)}
                    onCopy={() => copyMessage(m)}
                    onDelete={() => deleteMessage(originalIdx)}
                    onTogglePin={() => togglePin(originalIdx)}
                    onRegenerate={() => toast.info('Regenerate is dispatched to the TUI; coming in v3.1.', 2500)}
                  />
                );
              })
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
            {attachments.length > 0 && (
              <div className="chat-attachments">
                {attachments.map((a, i) => (
                  <span key={i} className="chat-attachment-tag">
                    <Paperclip size={10} /> {a}
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="chat-composer-row">
              <select
                className="select select-sm"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                title="Agent"
              >
                {(snapshot.agents || []).map((a) => (
                  <option key={a.name} value={a.name}>
                    @{a.name}
                  </option>
                ))}
                <option value="">(no agent)</option>
              </select>
              <input
                className="input input-sm"
                type="text"
                placeholder="model (optional)"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{ width: 140 }}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label="Attach files"
                title="Attach"
                onClick={onAttach}
              >
                <Paperclip size={14} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={onFiles}
              />
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
              <Button variant="primary" onClick={onSend} disabled={sending || !text.trim()}>
                {sending ? <Spinner size="sm" /> : <Send size={14} />}
                <span>Send</span>
                <CornerDownLeft size={12} className="hint-key" />
              </Button>
            </div>
          </div>
        </div>

        <aside className="chat-info">
          <Card>
            <CardTitle><MessageSquare size={14} /> Session</CardTitle>
            <CardMeta>
              {sessionId ? `id: ${sessionId}` : 'Live (unsaved)'}
            </CardMeta>
            <dl className="env-table">
              <dt>Messages</dt>
              <dd className="mono">{messages.length}</dd>
              <dt>Pinned</dt>
              <dd className="mono">{pinned.size}</dd>
              <dt>Agent</dt>
              <dd className="mono">{agent || '—'}</dd>
              <dt>Model</dt>
              <dd className="mono ellipsis" title={model}>{model || '—'}</dd>
            </dl>
          </Card>
          <Card>
            <CardTitle><Bot size={14} /> Agents in this project</CardTitle>
            <CardMeta>{(snapshot.agents || []).length} configured</CardMeta>
            <ul className="mod-mini-list">
              {(snapshot.agents || []).slice(0, 8).map((a) => (
                <li key={a.name} className="mod-mini" onClick={() => setAgent(a.name)}>
                  <span className="mod-mini-name">@{a.name}</span>
                  <span className="mod-mini-meta">{a.model || a.mode || ''}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardTitle><Server size={14} /> Active MCPs</CardTitle>
            <CardMeta>{(snapshot.mcps || []).length} configured</CardMeta>
            <ul className="mod-mini-list">
              {(snapshot.mcps || []).map((m) => (
                <li key={m.id} className="mod-mini">
                  <span className="mod-mini-name">{m.id}</span>
                  <span className="mod-mini-meta">{m.command}</span>
                  <span className={`mod-mini-pill ${m.enabled ? 'mod-mini-pill-on' : 'mod-mini-pill-off'}`}>
                    {m.enabled ? 'on' : 'off'}
                  </span>
                </li>
              ))}
              {(snapshot.mcps || []).length === 0 && (
                <li className="muted">No MCPs configured.</li>
              )}
            </ul>
          </Card>
          <Card>
            <CardTitle><Terminal size={14} /> Slash commands</CardTitle>
            <CardMeta>{allCommands.length} available</CardMeta>
            <ul className="slash-mini-list">
              {allCommands.slice(0, 10).map((c) => (
                <li key={c.cmd}>
                  <code>{c.cmd}</code>
                  <span className="muted">{c.desc}</span>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  pinned,
  onCopy,
  onDelete,
  onTogglePin,
  onRegenerate,
}: {
  message: ChatMessage;
  pinned: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onRegenerate: () => void;
}) {
  const role = (message.role || 'assistant').toLowerCase();
  const ts = message.ts ? formatTime(message.ts) : '';
  const content = message.content || message.message || '';
  return (
    <div className={cn('chat-msg', `chat-msg-${role}`, pinned && 'chat-msg-pinned')}>
      <div className="chat-msg-meta">
        <span className="chat-msg-role">{role}</span>
        {message.agent && <span className="chat-msg-agent">@{message.agent}</span>}
        {ts && <span className="chat-msg-ts tabular-nums">{ts}</span>}
        {pinned && <span className="chat-msg-pin"><Pin size={10} /> pinned</span>}
        <div className="chat-msg-actions">
          <button type="button" className="icon-btn" aria-label="Copy" title="Copy" onClick={onCopy}>
            <Copy size={12} />
          </button>
          {role !== 'user' && (
            <button type="button" className="icon-btn" aria-label="Regenerate" title="Regenerate" onClick={onRegenerate}>
              <RefreshCw size={12} />
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Pin" title="Pin" onClick={onTogglePin}>
            <Pin size={12} />
          </button>
          <button type="button" className="icon-btn icon-btn-danger" aria-label="Delete" title="Delete" onClick={onDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="chat-msg-body markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
