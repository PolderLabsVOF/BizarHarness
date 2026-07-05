// src/views/Chat.tsx — desktop chat view (v4.2.5 design).
//
// v4.2.5 — chat overhaul:
//   * 3-column grid preserved (rail / thread / info).
//   * Composer goes through `chat.onSend`, which transparently routes
//     to the right backend endpoint based on `activeSource`:
//       - opencode session active → POST /api/opencode-sessions/:id/send
//       - otherwise                → POST /api/chat
//   * "New session" button calls `chat.onCreateSession` which tries
//     POST /api/opencode-sessions/new first (so the new session is a
//     fully-fledged opencode session, scoped to the active worktree),
//     falling back to the local jsonl store when the opencode plugin
//     is offline.
//   * Top-of-thread badge shows the active source ("opencode" or
//     "bizar chat") so the user always knows where messages are going.
//   * Info panel gets session metadata + rename/delete actions.
//
// The page-level grid and CSS classes are unchanged so the rail/info
// widths in the .chat-page grid continue to apply.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, Pencil } from 'lucide-react';
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

export function Chat({
  snapshot,
  settings,
  setActiveTab,
  initialTaskId,
  onClearTaskId,
}: Props) {
  const toast = useToast();
  const modal = useModal();

  const chat = useChat(snapshot, settings, initialTaskId ?? '');
  // Wire toast + modal surfaces to useChat so async ops can surface
  // feedback without each view passing handlers down.
  useEffect(() => {
    chat.setToast({
      error: (msg: string) => toast.error(msg),
      success: (msg: string) => toast.success(msg),
      info: (msg: string) => toast.info(msg),
      warning: (msg: string) => toast.warning(msg),
    });
  }, [chat, toast]);

  // ── Composer state (local) ───────────────────────────────────────────────
  const [text, setText] = useState('');
  const [agent, setAgent] = useState(settings.defaultAgent || 'odin');
  const [model, setModel] = useState(settings.defaultModel || '');
  const [attachments, setAttachments] = useState<string[]>([]);

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
  const handleSend = async () => {
    const msg = text.trim();
    if (!msg) return;
    setText('');
    setQuery('');
    const result = await chat.onSend(msg, agent, model, attachments);
    if (result.ok) chat.jumpToLatest();
  };

  // ── Create session ───────────────────────────────────────────────────────
  const handleCreateSession = async () => {
    if (chat.busy.create) return;
    await chat.onCreateSession();
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

  // ── Rename session (info panel action) ───────────────────────────────────
  const handleRename = (id: string, currentTitle: string) => {
    let next = '';
    modal.open({
      title: 'Rename session',
      children: (
        <input
          id="rename-session-input"
          autoFocus
          defaultValue={currentTitle}
          aria-label="Session title"
          onChange={(e) => {
            next = e.target.value;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              modal.close();
              chat.renameSession(id, next).then((ok) => {
                if (ok) {
                  toast.success('Renamed.');
                }
              });
            }
          }}
          style={{
            width: '100%',
            padding: '8px 10px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text)',
            font: '13px/1.4 var(--font-sans)',
            marginTop: 6,
          }}
        />
      ),
      footer: (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={() => modal.close()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              modal.close();
              chat.renameSession(id, next);
            }}
          >
            Save
          </Button>
        </div>
      ),
    });
  };

  // ── Delete session (info panel action) ───────────────────────────────────
  const handleDeleteSession = (id: string, title: string) => {
    modal.open({
      title: 'Delete session?',
      children: (
        <p style={{ margin: 0 }}>
          Delete <strong>{title}</strong>? Messages on the opencode serve
          will be removed. This cannot be undone.
        </p>
      ),
      footer: (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={() => modal.close()}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              modal.close();
              await chat.deleteSession(id);
            }}
          >
            Delete
          </Button>
        </div>
      ),
    });
  };

  // ── Export transcript ────────────────────────────────────────────────────
  const handleExport = () => {
    const sessionId =
      chat.activeSource === 'opencode'
        ? chat.activeOpencodeSessionId
        : chat.sessionId;
    if (!sessionId) return;
    const msgs =
      chat.activeSource === 'opencode'
        ? chat.opencodeMessages
        : chat.bizarMessages;
    const text = msgs
      .map((m) => {
        const ts = m.ts ?? '';
        const who = (m.role || 'unknown').toUpperCase();
        const c = m.content || m.message || '';
        return `[${ts}] ${who}: ${c}`;
      })
      .join('\n\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sessionId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    const id =
      chat.activeSource === 'opencode'
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

  // The badge in the thread head: "opencode" or "bizar chat".
  const sourceLabel =
    chat.activeSource === 'opencode' ? 'opencode' : 'bizar chat';

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
          creating={chat.busy.create}
          onCreateSession={handleCreateSession}
          onSelectSession={chat.selectBizarSession}
          onSelectOpencodeSession={(s) => chat.loadOpencodeSession(s.id)}
          onRenameSession={handleRename}
          onDeleteSession={(id) => {
            const s = chat.sessions.find((s) => s.id === id) ?? chat.opencodeSessions.find((s) => s.id === id);
            handleDeleteSession(id, s?.title ?? '');
          }}
        />

        {/* ── thread ───────────────────────────────────────────────────── */}
        <section className="chat-thread-section">
          <div className="chat-thread-head">
            <div>
              <div className="chat-thread-title-row">
                <div className="chat-thread-title">
                  {activeSessionDisplay?.title ?? chat.sessionId ?? 'New chat'}
                </div>
                <span
                  className={`chat-source-badge chat-source-${
                    chat.activeSource ?? 'none'
                  }`}
                  title={
                    chat.activeSource === 'opencode'
                      ? 'Messages go to the opencode serve child'
                      : 'Messages go to the local chat store'
                  }
                >
                  {sourceLabel}
                </span>
              </div>
              <div
                className={`chat-thread-sub chat-muted state-${
                  activeSessionDisplay?.state ?? 'idle'
                }`}
              >
                <span className="chat-thread-dot" />
                {threadSubtitle}
              </div>
              {chat.opencodeError && (
                <div className="chat-thread-error" role="alert">
                  {chat.opencodeError}
                </div>
              )}
            </div>
            <div className="chat-thread-actions">
              {activeSessionDisplay && (
                <button
                  className="btn btn-ghost"
                  title="Rename session"
                  type="button"
                  disabled={chat.busy.rename}
                  onClick={() =>
                    handleRename(
                      activeSessionDisplay.id,
                      activeSessionDisplay.title ?? '',
                    )
                  }
                >
                  <Pencil size={12} aria-hidden />{' '}
                  <span className="mono">rename</span>
                </button>
              )}
              {activeSessionDisplay && (
                <button
                  className="btn btn-ghost btn-danger"
                  title="Delete session"
                  type="button"
                  disabled={chat.busy.delete}
                  onClick={() =>
                    handleDeleteSession(
                      activeSessionDisplay.id,
                      activeSessionDisplay.title ?? activeSessionDisplay.id,
                    )
                  }
                >
                  <Trash2 size={12} aria-hidden />{' '}
                  <span className="mono">delete</span>
                </button>
              )}
              <button
                className="btn btn-ghost"
                title="Export transcript"
                type="button"
                onClick={handleExport}
              >
                <span className="mono">export</span>
              </button>
            </div>
          </div>

          <div
            className="chat-thread-scroll"
            ref={chat.listRef}
            onScroll={chat.handleScroll}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Chat message thread"
          >
            <ChatThread
              messages={
                chat.activeSource === 'opencode'
                  ? chat.opencodeMessages
                  : chat.bizarMessages
              }
              loading={chat.loading}
              activeProject={snapshot.activeProject}
              sessionId={
                chat.activeSource === 'opencode'
                  ? chat.activeOpencodeSessionId ?? chat.sessionId
                  : chat.sessionId
              }
              pinned={chat.pinned}
              activeSource={chat.activeSource}
              onPickSuggestion={(t) => setText(t)}
              onCopy={(m) =>
                chat.copyMessage(m as Parameters<typeof chat.copyMessage>[0])
              }
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
            activeSource={chat.activeSource}
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
            aria-label="Attach files to message"
            tabIndex={-1}
          />
        </section>

        {/* ── info panel ──────────────────────────────────────────────── */}
        <ChatInfoPanel
          sessionId={
            chat.activeSource === 'opencode'
              ? chat.activeOpencodeSessionId ?? chat.sessionId
              : chat.sessionId
          }
          messages={
            chat.activeSource === 'opencode'
              ? chat.opencodeMessages
              : chat.bizarMessages
          }
          pinned={chat.pinned}
          agent={agent}
          model={model}
          agents={snapshot.agents || []}
          mcps={snapshot.mcps || []}
          allCommands={allCommands}
          activeSource={chat.activeSource}
          onRename={() => {
            if (activeSessionDisplay) {
              handleRename(
                activeSessionDisplay.id,
                activeSessionDisplay.title ?? '',
              );
            }
          }}
          onDelete={() => {
            if (activeSessionDisplay) {
              handleDeleteSession(
                activeSessionDisplay.id,
                activeSessionDisplay.title ?? activeSessionDisplay.id,
              );
            }
          }}
          onExport={handleExport}
          busy={chat.busy}
        />
      </div>
    </div>
  );
}
