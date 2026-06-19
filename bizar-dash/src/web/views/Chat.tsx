// src/views/Chat.tsx — v3 floating chat: messages, sessions, agent selector, slash autocomplete.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  MessageSquare,
  Send,
  Bot,
  Paperclip,
  Pin,
  Copy,
  RefreshCw,
  Trash2,
  Server,
  Terminal,
  Sparkles,
  Plus,
  X,
  Folder,
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

export function Chat({ snapshot, settings, setActiveTab }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
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

  // Refresh only the sessions list (without reloading messages). Useful
  // after creating or deleting a session.
  const refreshSessions = async () => {
    try {
      const data = await api.get<{ sessions: ChatSession[] }>('/chat/sessions');
      setSessions(data.sessions || []);
    } catch {
      /* best-effort */
    }
  };

  // v3.0.4 — Explicit "create new session" flow. Persists an empty
  // session file on disk via POST /api/chat/sessions, loads it, and
  // resets the composer.
  const onCreateSession = async () => {
    if (creating) return;
    if (!snapshot.activeProject) {
      toast.warning('Pick a project in Overview to scope chat sessions.', 4000);
      return;
    }
    setCreating(true);
    try {
      const created = await api.post<ChatSession>('/chat/sessions', {});
      await refreshSessions();
      setSessionId(created.id);
      setMessages([]);
      setPinned(new Set());
      await loadChat(created.id);
      toast.success(`Session ${created.id} created.`);
      inputRef.current?.focus();
    } catch (err) {
      toast.error(`Create failed: ${(err as Error).message}`);
    } finally {
      setCreating(false);
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

  const onRegenerate = async (messageId: string | number) => {
    try {
      await api.post('/chat/regenerate', { sessionId, messageId });
      toast.success('Regenerating…', 1500);
      // Re-fetch messages so the new one appears
      await loadChat(sessionId || undefined);
    } catch (err) {
      toast.error(`Regenerate failed: ${(err as Error).message}`);
    }
  };

  // Wrapper that captures the messageId from the bubble
  const makeRegenerateHandler = (messageId: string) => () => onRegenerate(messageId);

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

  // Auto-grow the textarea up to 240px based on content.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = 240;
    const next = Math.min(el.scrollHeight, max);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [text]);

  return (
    <div className="view view-chat">
      <header className="view-header">
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
              <span className="chat-sessions-count mono">{sessions.length}</span>
            </div>
            {/* v3.0.4 — Prominent "+ New session" button. The previous icon
                button was too small and silently cleared state without
                persisting a session. This writes a new .jsonl file on
                disk so reloads preserve the conversation. */}
            <button
              type="button"
              className="chat-sessions-new"
              onClick={onCreateSession}
              disabled={creating || !snapshot.activeProject}
              title={snapshot.activeProject ? 'Create new session' : 'Pick a project in Overview first'}
              aria-label="Create new session"
            >
              {creating ? <Spinner size="sm" /> : <Plus size={14} />}
              {creating ? 'Creating…' : 'New session'}
            </button>
            <ul className="chat-sessions-list">
              {sessions.length === 0 && (
                <li className="chat-sessions-empty">
                  <EmptyState
                    icon={<Sparkles size={20} />}
                    title="Create your first session"
                    message={snapshot.activeProject
                      ? 'Start a new conversation to begin chatting with this project.'
                      : 'Pick a project in Overview to scope chat sessions.'}
                    action={snapshot.activeProject ? (
                      <Button variant="primary" size="sm" onClick={onCreateSession} loading={creating}>
                        <Plus size={12} /> New session
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setActiveTab('overview')}>
                        <Folder size={12} /> Open Overview
                      </Button>
                    )}
                  />
                </li>
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
            ) : !snapshot.activeProject ? (
              <EmptyState
                icon={<Folder size={32} />}
                title="No active project"
                message="Pick a project in Overview to scope chat sessions."
                action={
                  <Button variant="primary" onClick={() => setActiveTab('overview')}>
                    <Folder size={14} /> Open Overview
                  </Button>
                }
              />
            ) : messages.length === 0 ? (
              <EmptyState
                icon={<MessageSquare size={28} />}
                title="No messages yet"
                message={
                  <>
                    {sessionId
                      ? `Session ${sessionId} is empty. Type below to start.`
                      : 'Pick a session on the left or create a new one.'}
                    {' '}Press <kbd>/</kbd> for commands, <kbd>Tab</kbd> to autocomplete,
                    <kbd>⌘/Ctrl+Enter</kbd> to send.
                  </>
                }
                action={
                  !sessionId && (
                    <Button variant="primary" onClick={onCreateSession} loading={creating}>
                      <Plus size={14} /> Create session
                    </Button>
                  )
                }
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
                    onRegenerate={makeRegenerateHandler(String(m.ts) || String(originalIdx))}
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
                      className="chat-attachment-remove"
                      aria-label={`Remove ${a}`}
                      title="Remove"
                      onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="chat-composer-toolbar">
              <select
                className="agent-select"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                title="Agent"
                aria-label="Agent"
              >
                {(snapshot.agents || []).map((a) => (
                  <option key={a.name} value={a.name}>
                    @{a.name}
                  </option>
                ))}
                <option value="">(no agent)</option>
              </select>
              <input
                className="model-input"
                type="text"
                placeholder="model (optional)"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                aria-label="Model"
              />
              <button
                type="button"
                className="attach-btn"
                aria-label="Attach files"
                title="Attach files"
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
              <span className="toolbar-spacer" />
              <span className="hint">Enter to send · Shift+Enter newline · / commands</span>
            </div>
            <div className="chat-composer-input">
              <textarea
                ref={inputRef}
                className="chat-input"
                placeholder="Send a message…"
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={sending}
                aria-label="Message"
              />
              <button
                type="button"
                className="send-btn"
                onClick={onSend}
                disabled={sending || !text.trim()}
                aria-label="Send message"
                title="Send (Enter)"
              >
                {sending ? <Spinner size="sm" /> : <Send size={18} />}
              </button>
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
