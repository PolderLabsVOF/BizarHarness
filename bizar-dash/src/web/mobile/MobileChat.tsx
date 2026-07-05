// src/web/mobile/MobileChat.tsx — mobile chat UI without info/sessions sidebars.
// No OCR capture, no clipper, no sessions panel — pure chat thread.
import { useEffect, useRef, useState } from 'react';
import { ChatTopBar } from '../components/chat/ChatTopBar';
import { ChatThread } from '../components/chat/ChatThread';
import { FloatingComposer } from '../components/chat/FloatingComposer';
import { useChat } from '../components/chat/useChat';
import { useSlashCommands } from '../components/chat/useSlashCommands';
import { useToast } from '../components/Toast';
import type { Snapshot, Settings } from '../lib/types';

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

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { suggestions, setQuery } = useSlashCommands(snapshot);
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

  return (
    <div className="chat-shell">
      <ChatTopBar
        activeProject={snapshot.activeProject}
        sessionCount={chat.sessions.length}
        sessionsOpen={false}
        infoOpen={false}
        onToggleSessions={() => undefined}
        onToggleInfo={() => undefined}
        onOpenOverview={() => setActiveTab?.('overview')}
      />
      <div className="chat-body">
        <main className="chat-main">
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
            onDelete={() => undefined}
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
            sessionsOpen={false}
            infoOpen={false}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={onFiles}
          />
        </main>
      </div>
    </div>
  );
}
