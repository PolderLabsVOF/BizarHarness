// src/components/chat/SessionList.tsx — sessions sidebar with create + select.

import { useState } from 'react';
import { Plus, Sparkles, Folder, ExternalLink } from 'lucide-react';
import { Button } from '../Button';
import { EmptyState } from './EmptyState';
import { Spinner } from '../Spinner';
import type { ChatSession } from '../../lib/types';

interface Props {
  sessions: ChatSession[];
  opencodeSessions: ChatSession[];
  activeSessionId: string;
  activeProject: { name: string } | null;
  creating: boolean;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
}

export function SessionList({
  sessions,
  opencodeSessions,
  activeSessionId,
  activeProject,
  creating,
  onCreateSession,
  onSelectSession,
}: Props) {
  const [view, setView] = useState<'bizar' | 'all'>('all');

  const displayedSessions = view === 'all'
    ? [...sessions, ...opencodeSessions].sort((a, b) => Number(b.mtime) - Number(a.mtime))
    : sessions;

  const totalOpencode = opencodeSessions.length;

  const handleSelectSession = (s: ChatSession) => {
    if (s.source === 'opencode' && s.opencodeUrl) {
      window.open(s.opencodeUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    onSelectSession(s.id);
  };

  return (
    <div className="chat-sessions">
      <div className="chat-sessions-header">
        <span className="chat-sessions-header-title">Sessions</span>
        <span className="chat-sessions-count">{displayedSessions.length}</span>
      </div>

      {totalOpencode > 0 && (
        <div className="chat-sessions-toggle">
          <button
            type="button"
            className={`chat-sessions-toggle-btn ${view === 'bizar' ? 'active' : ''}`}
            onClick={() => setView('bizar')}
          >
            Bizar
          </button>
          <button
            type="button"
            className={`chat-sessions-toggle-btn ${view === 'all' ? 'active' : ''}`}
            onClick={() => setView('all')}
          >
            All ({totalOpencode} opencode)
          </button>
        </div>
      )}

      <button
        type="button"
        className="chat-sessions-new"
        onClick={onCreateSession}
        disabled={creating || !activeProject}
        title={activeProject ? 'Create new session' : 'Pick a project first'}
        aria-label="Create new session"
      >
        {creating ? <Spinner size="sm" /> : <Plus size={14} />}
        <span>{creating ? 'Creating…' : 'New session'}</span>
      </button>

      {sessions.length === 0 ? (
        <div className="chat-sessions-empty">
          <EmptyState
            icon={<Sparkles size={20} />}
            title={activeProject ? 'No sessions yet' : 'No project'}
            message={
              activeProject
                ? 'Create your first session to start chatting.'
                : 'Pick a project in Overview to scope chat sessions.'
            }
            action={
              activeProject ? (
                <Button variant="primary" size="sm" onClick={onCreateSession} loading={creating}>
                  <Plus size={12} /> New session
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { window.location.hash = '#overview'; }}
                >
                  <Folder size={12} /> Open Overview
                </Button>
              )
            }
          />
        </div>
      ) : (
        <ul className="chat-sessions-list">
          {displayedSessions.map((s) => {
            const isActive = s.source !== 'opencode' && activeSessionId === s.id;
            const isOpencode = s.source === 'opencode';
            return (
              <li
                key={isOpencode ? `oc-${s.id}` : s.id}
                className={`chat-sessions-item ${isActive ? 'active' : ''} ${isOpencode ? 'chat-sessions-item-opencode' : ''}`}
                onClick={() => handleSelectSession(s)}
                title={isOpencode ? `Open in opencode UI: ${s.title || s.id}` : s.id}
              >
                {isOpencode && (
                  <ExternalLink size={10} className="chat-sessions-item-icon" />
                )}
                <span className="chat-sessions-item-id">
                  {s.title || s.id}
                </span>
                <span className="chat-sessions-item-meta">
                  {new Date(Number(s.mtime)).toLocaleDateString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}