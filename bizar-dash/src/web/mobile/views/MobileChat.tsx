// src/web/mobile/views/MobileChat.tsx — mobile chat (v4.2.5).
//
// v4.2.5 — matches Chat.tsx overhaul: cline session-create via the
// new endpoint, source-routed composer (cline send vs. local chat),
// source indicator badge, rename / delete / export on the info panel,
// and matching busy flags.

import { useEffect, useRef, useState } from 'react';
import { ChatTopBar } from '../../components/chat/ChatTopBar';
import { SessionList } from '../../components/chat/SessionList';
import { ChatThread } from '../../components/chat/ChatThread';
import { FloatingComposer } from '../../components/chat/FloatingComposer';
import { InfoPanel } from '../../components/chat/InfoPanel';
import { useChat } from '../../components/chat/useChat';
import { useSlashCommands } from '../../components/chat/useSlashCommands';
import { useToast } from '../../components/Toast';
import { useModal } from '../../components/Modal';
import { Button } from '../../components/Button';
import type { Snapshot, Settings } from '../../lib/types';

interface Props {
  snapshot: Snapshot;
  settings: Settings;
  setActiveTab?: (id: string) => void;
  initialTaskId?: string | null;
  onClearTaskId?: () => void;
}

export function MobileChat({
  snapshot,
  settings,
  setActiveTab,
  initialTaskId,
  onClearTaskId,
}: Props) {
  const toast = useToast();
  const modal = useModal();

  const chat = useChat(snapshot, settings, initialTaskId ?? '');
  useEffect(() => {
    chat.setToast({
      error: (msg: string) => toast.error(msg),
      success: (msg: string) => toast.success(msg),
      info: (msg: string) => toast.info(msg),
      warning: (msg: string) => toast.warning(msg),
    });
  }, [chat, toast]);

  const [text, setText] = useState('');
  const [agent, setAgent] = useState(settings.defaultAgent || 'odin');
  const [model, setModel] = useState(settings.defaultModel || '');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { allCommands, suggestions, setQuery } = useSlashCommands(snapshot);
  useEffect(() => {
    setQuery(text);
  }, [text, setQuery]);

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

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg) return;
    setText('');
    setQuery('');
    const result = await chat.onSend(msg, agent, model, attachments);
    if (result.ok) chat.jumpToLatest();
  };

  const handleCreateSession = async () => {
    if (chat.busy.create) return;
    await chat.onCreateSession();
    setSessionsOpen(false);
  };

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

  const handleDeleteSession = (id: string, title: string) => {
    modal.open({
      title: 'Delete session?',
      children: (
        <p style={{ margin: 0 }}>
          Delete <strong>{title}</strong>? This cannot be undone.
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

  return (
    <div className="chat-shell">
      <ChatTopBar
        activeProject={snapshot.activeProject}
        sessionCount={chat.sessions.length}
        sessionsOpen={sessionsOpen}
        infoOpen={infoOpen}
        onToggleSessions={() => setSessionsOpen((v) => !v)}
        onToggleInfo={() => setInfoOpen((v) => !v)}
        onOpenOverview={() => setActiveTab?.('overview')}
      />
      <div className="chat-body">
        <aside
          className={`chat-sessions ${!sessionsOpen ? 'chat-sessions-hidden' : ''}`}
        >
          <SessionList
            sessions={chat.sessions}
            clineSessions={chat.clineSessions}
            activeSessionId={chat.sessionId}
            activeClineSessionId={chat.activeClineSessionId}
            activeProject={snapshot.activeProject}
            onCreateSession={handleCreateSession}
            onSelectSession={chat.selectBizarSession}
            onSelectClineSession={(s) => chat.loadClineSession(s.id)}
            creating={chat.busy.create}
          />
        </aside>

        <main className="chat-main">
          <ChatThread
            messages={
              chat.activeSource === 'cline'
                ? chat.clineMessages
                : chat.bizarMessages
            }
            loading={chat.loading}
            activeProject={snapshot.activeProject}
            sessionId={
              chat.activeSource === 'cline'
                ? chat.activeClineSessionId ?? chat.sessionId
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
          <FloatingComposer
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
            sessionsOpen={sessionsOpen}
            infoOpen={infoOpen}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={onFiles}
          />
        </main>

        <aside
          className={`chat-info ${!infoOpen ? 'chat-info-hidden' : ''}`}
        >
          <InfoPanel
            sessionId={
              chat.activeSource === 'cline'
                ? chat.activeClineSessionId ?? chat.sessionId
                : chat.sessionId
            }
            messages={
              chat.activeSource === 'cline'
                ? chat.clineMessages
                : chat.bizarMessages
            }
            pinned={chat.pinned}
            agent={agent}
            model={model}
            agents={snapshot.agents || []}
            mcps={snapshot.mcps || []}
            allCommands={allCommands}
            activeSource={chat.activeSource}
            onDelete={() => {
              const id =
                chat.activeSource === 'cline'
                  ? chat.activeClineSessionId
                  : chat.sessionId;
              if (!id) return;
              handleDeleteSession(id, id);
            }}
          />
        </aside>
      </div>
    </div>
  );
}
