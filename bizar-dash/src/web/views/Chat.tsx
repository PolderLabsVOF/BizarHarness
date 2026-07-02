// src/views/Chat.tsx — Gemini-inspired dark chat orchestrator (v3.22).
//
// v3.22 — redesigned layout: 3-column grid (rail / thread / info).
// The legacy `.chat-shell / .chat-body / .chat-sessions / .chat-main /
// .chat-info` wrapper classes are still available for MobileChat (which
// uses its own view); this file uses the new `.chat-page` grid.
//
// The `chat-thread` section is a vertical grid (head / scroll / composer).
// The scrollable message list lives inside the legacy `ChatThread`
// component (still wrapped in its own `.chat-thread` div with className
// `legacy` to opt into the original styles — see chat.css).

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatTopBar } from '../components/chat/ChatTopBar';
import { ChatRail } from '../components/chat/ChatRail';
import { ChatThread } from '../components/chat/ChatThread';
import { ChatComposer } from '../components/chat/ChatComposer';
import { ChatInfoPanel } from '../components/chat/ChatInfoPanel';
import { JumpToLatest } from '../components/chat/JumpToLatest';
import { useChat } from '../components/chat/useChat';
import { useSlashCommands } from '../components/chat/useSlashCommands';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { Button } from '../components/Button';
import type { Snapshot, Settings } from '../lib/types';

interface Props {
  snapshot: Snapshot;
  settings: Settings;
  setActiveTab?: (id: string) => void;
  refreshSnapshot?: () => Promise<void>;
  initialTaskId?: string | null;
  onClearTaskId?: () => void;
}

export function Chat({ snapshot, settings, setActiveTab, initialTaskId, onClearTaskId }: Props) {
  const toast = useToast();
  const modal = useModal();

  const chat = useChat(snapshot, settings, initialTaskId ?? '');

  // ── Composer state (local) ───────────────────────────────────────────────
  const [text, setText] = useState('');
  const [agent, setAgent] = useState(settings.defaultAgent || 'odin');
  const [model, setModel] = useState(settings.defaultModel || '');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Slash commands ───────────────────────────────────────────────────────
  const { allCommands, suggestions, setQuery } = useSlashCommands(snapshot);

  useEffect(() => {
    setQuery(text);
  }, [text, setQuery]);

  // ── File attach ──────────────────────────────────────────────────────────
  const onAttach = () => fileInputRef.current?.click();

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const next: string[] = [];
    for (let i = 0; i < files.length; i++) next.push(files[i].name);
    setAttachments((cur) => {
      const newNames = next.filter((n) => !cur.includes(n));
      return [...cur, ...newNames];
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = () => {
    const msg = text.trim();
    if (!msg) return;
    setText('');
    setQuery('');
    chat.onSend(msg, agent, model, attachments);
    chat.jumpToLatest();
  };

  // ── Create session ───────────────────────────────────────────────────────
  const handleCreateSession = async () => {
    if (creating) return;
    if (!snapshot.activeProject) {
      toast.warning('Pick a project in Overview to scope chat sessions.', 4000);
      return;
    }
    setCreating(true);
    try {
      const created = await fetch('/chat/sessions', { method: 'POST' }).then((r) => r.json());
      chat.loadChat(created.id);
      toast.success(`Session ${created.id} created.`);
    } catch (err) {
      toast.error(`Create failed: ${(err as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  // ── Delete message (via modal) ───────────────────────────────────────────
  const handleDelete = (idx: number) => {
    modal.open({
      title: 'Delete message?',
      children: <p style={{ margin: 0 }}>This action cannot be undone.</p>,
      footer: (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={() => modal.close()}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              modal.close();
              chat.deleteMessage(idx);
            }}
          >
            Delete
          </Button>
        </div>
      ),
    });
  };

  // ── Derived: sessions with display state overlaid ────────────────────────
  const displaySessions = useMemo(
    () => chat.sessions.map((s) => chat.getSessionDisplay(s)),
    [chat.sessions, chat.getSessionDisplay],
  );
  const displayOpencodeSessions = useMemo(
    () => chat.opencodeSessions.map((s) => chat.getSessionDisplay(s)),
    [chat.opencodeSessions, chat.getSessionDisplay],
  );

  // ── Current session for the thread head subtitle ────────────────────────
  const activeSessionDisplay = useMemo(() => {
    const id = chat.activeSource === 'opencode'
      ? chat.activeOpencodeSessionId ?? ''
      : chat.sessionId;
    if (!id) return null;
    return (
      displaySessions.find((s) => s.id === id) ??
      displayOpencodeSessions.find((s) => s.id === id) ??
      null
    );
  }, [
    chat.activeSource,
    chat.activeOpencodeSessionId,
    chat.sessionId,
    displaySessions,
    displayOpencodeSessions,
  ]);

  const threadSubtitle = (() => {
    const base = `${agent || 'Odin'} · ${snapshot.activeProject?.name ?? 'no project'}`;
    const state = activeSessionDisplay?.state ?? 'idle';
    if (state === 'streaming') return `Replying · ${base}`;
    if (state === 'awaiting') return `Your turn · ${base}`;
    return `${base} · idle`;
  })();

  return (
    <div className="chat-shell">
      <ChatTopBar
        activeProject={snapshot.activeProject}
        sessionCount={chat.sessions.length}
        sessionsOpen={true}
        infoOpen={true}
        onToggleSessions={() => {}}
        onToggleInfo={() => {}}
        onOpenOverview={() => setActiveTab?.('overview')}
      />
      <div className="chat-page">
        {/* ── rail ──────────────────────────────────────────────────────── */}
        <ChatRail
          sessions={displaySessions}
          opencodeSessions={displayOpencodeSessions}
          activeSessionId={chat.sessionId}
          activeOpencodeSessionId={chat.activeOpencodeSessionId}
          activeProject={snapshot.activeProject}
          creating={creating}
          onCreateSession={handleCreateSession}
          onSelectSession={chat.selectBizarSession}
          onSelectOpencodeSession={(s) => chat.loadOpencodeSession(s.id)}
          onRenameSession={(id, title) => chat.renameSession(id, title)}
          onDeleteSession={(id) => chat.deleteSession(id)}
        />

        {/* ── thread ───────────────────────────────────────────────────── */}
        <section className="chat-thread-section">
          <div className="chat-thread-head">
            <div>
              <div className="chat-thread-title">
                {activeSessionDisplay?.title ?? chat.sessionId ?? 'New chat'}
              </div>
              <div
                className={`chat-thread-sub chat-muted state-${activeSessionDisplay?.state ?? 'idle'}`}
              >
                <span className="chat-thread-dot" />
                {threadSubtitle}
              </div>
            </div>
            <div className="chat-thread-actions">
              <button className="btn btn-ghost" title="Rename" type="button">
                <span className="mono">rename</span>
              </button>
            </div>
          </div>

          <div className="chat-thread-scroll" ref={chat.listRef} onScroll={chat.handleScroll}>
            <ChatThread
              messages={chat.activeSource === 'opencode' ? chat.opencodeMessages : chat.bizarMessages}
              loading={chat.loading}
              activeProject={snapshot.activeProject}
              sessionId={
                chat.activeSource === 'opencode'
                  ? (chat.activeOpencodeSessionId ?? chat.sessionId)
                  : chat.sessionId
              }
              pinned={chat.pinned}
              onPickSuggestion={(t) => setText(t)}
              onCopy={(m) => chat.copyMessage(m as Parameters<typeof chat.copyMessage>[0])}
              onDelete={handleDelete}
              onTogglePin={chat.togglePin}
              onRegenerate={chat.onRegenerate}
            />
          </div>

          {!chat.stickToBottom && (
            <JumpToLatest
              streaming={activeSessionDisplay?.state === 'streaming'}
              newMessageCount={chat.newMessageCount}
              onClick={chat.jumpToLatest}
            />
          )}

          <ChatComposer
            agent={agent}
            setAgent={setAgent}
            model={model}
            setModel={setModel}
            text={text}
            setText={setText}
            sending={chat.sending}
            onSend={handleSend}
            attachments={attachments}
            setAttachments={setAttachments}
            suggestions={suggestions}
            onPickSuggestion={(cmd) => setText(`${cmd.split(' ')[0]} `)}
            agents={snapshot.agents || []}
            onAttach={onAttach}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={onFiles}
          />
        </section>

        {/* ── info panel ──────────────────────────────────────────────── */}
        <ChatInfoPanel
          sessionId={
            chat.activeSource === 'opencode'
              ? (chat.activeOpencodeSessionId ?? chat.sessionId)
              : chat.sessionId
          }
          messages={chat.activeSource === 'opencode' ? chat.opencodeMessages : chat.bizarMessages}
          pinned={chat.pinned}
          agent={agent}
          model={model}
          agents={snapshot.agents || []}
          mcps={snapshot.mcps || []}
          allCommands={allCommands}
        />
      </div>
    </div>
  );
}