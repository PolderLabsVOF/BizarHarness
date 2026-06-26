// src/components/chat/ChatTopBar.tsx — 48px topbar with project chip + panel toggles.

import { Folder, ChevronDown } from 'lucide-react';

interface Props {
  activeProject: { name: string; path?: string } | null;
  sessionCount: number;
  sessionsOpen: boolean;
  infoOpen: boolean;
  onToggleSessions: () => void;
  onToggleInfo: () => void;
  onOpenOverview: () => void;
}

export function ChatTopBar({
  activeProject,
  sessionCount,
  sessionsOpen,
  infoOpen,
  onToggleSessions,
  onToggleInfo,
  onOpenOverview,
}: Props) {
  return (
    <header className="chat-topbar">
      <button type="button" className="chat-topbar-project" onClick={onOpenOverview}>
        <Folder size={14} />
        <span className="chat-topbar-project-name">{activeProject?.name ?? 'No project'}</span>
        <ChevronDown size={12} />
      </button>
      <div className="chat-topbar-spacer" />
      <button
        type="button"
        className={`chat-topbar-btn ${sessionsOpen ? 'active' : ''}`}
        onClick={onToggleSessions}
        aria-pressed={sessionsOpen}
      >
        Sessions ({sessionCount})
      </button>
      <button
        type="button"
        className={`chat-topbar-btn ${infoOpen ? 'active' : ''}`}
        onClick={onToggleInfo}
        aria-pressed={infoOpen}
      >
        Info
      </button>
    </header>
  );
}