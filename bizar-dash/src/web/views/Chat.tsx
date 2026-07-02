// src/views/Chat.tsx — Gemini-inspired dark chat orchestrator.
// Composer state (agent, model, text, attachments) is local.
// useChat handles messages, sessions, send, polling.

import { useEffect, useRef, useState } from 'react';
import { ChatTopBar } from '../components/chat/ChatTopBar';
import { SessionList } from '../components/chat/SessionList';
import { ChatThread } from '../components/chat/ChatThread';
import { FloatingComposer } from '../components/chat/FloatingComposer';
import { InfoPanel } from '../components/chat/InfoPanel';
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

  // ── Delegate to useChat: messages, sessions, send, polling ──────────────
  const chat = useChat(snapshot, settings, initialTaskId ?? '');

  // ── Composer state (local) ───────────────────────────────────────────────
  const [text, setText] = useState('');
  const [agent, setAgent] = useState(settings.defaultAgent || 'odin');
  const [model, setModel] = useState(settings.defaultModel || '');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Slash commands ───────────────────────────────────────────────────────
  const { allCommands, suggestions, setQuery } = useSlashCommands(snapshot);

  useEffect(() => { setQuery(text); }, [text, setQuery]);

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
          <Button variant="secondary" size="sm" onClick={() => modal.close()}>Cancel</Button>
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

  // ── Pin / copy are handled directly via chat.* ──────────────────────────

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
      <div className="chat-body">
        <aside className="chat-sessions">
          <SessionList
            sessions={chat.sessions}
            opencodeSessions={chat.opencodeSessions}
            activeSessionId={chat.sessionId}
            activeOpencodeSessionId={chat.activeOpencodeSessionId}
            activeProject={snapshot.activeProject}
            onCreateSession={handleCreateSession}
            onSelectSession={chat.selectBizarSession}
            onSelectOpencodeSession={(s) => chat.loadOpencodeSession(s.id)}
            creating={creating}
          />
        </aside>

        <main className="chat-main">
          <ChatThread
            messages={chat.activeSource === 'opencode' ? chat.opencodeMessages : chat.bizarMessages}
            loading={chat.loading}
            activeProject={snapshot.activeProject}
            sessionId={chat.activeSource === 'opencode' ? (chat.activeOpencodeSessionId ?? chat.sessionId) : chat.sessionId}
            pinned={chat.pinned}
            onPickSuggestion={(t) => setText(t)}
            onCopy={(m) => chat.copyMessage(m as Parameters<typeof chat.copyMessage>[0])}
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
            onSend={handleSend}
            attachments={attachments}
            setAttachments={setAttachments}
            suggestions={suggestions}
            onPickSuggestion={(cmd) => setText(`${cmd.split(' ')[0]} `)}
            agents={snapshot.agents || []}
            onAttach={onAttach}
            sessionsOpen={true}
            infoOpen={true}
          />
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={onFiles} />
        </main>

        <aside className="chat-info">
          <InfoPanel
            sessionId={chat.activeSource === 'opencode' ? (chat.activeOpencodeSessionId ?? chat.sessionId) : chat.sessionId}
            messages={chat.activeSource === 'opencode' ? chat.opencodeMessages : chat.bizarMessages}
            pinned={chat.pinned}
            agent={agent}
            model={model}
            agents={snapshot.agents || []}
            mcps={snapshot.mcps || []}
            allCommands={allCommands}
          />
        </aside>
      </div>
    </div>
  );
}