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
  /** The opencode session currently displayed, or null. */
  activeOpencodeSessionId: string | null;
  activeProject: { name: string } | null;
  creating: boolean;
  onCreateSession: () => void;
  /** Called when a bizar session is selected. */
  onSelectSession: (id: string) => void;
  /** Called when an opencode session is selected — renders it in-dash. */
  onSelectOpencodeSession: (s: ChatSession) => void;
}

export function SessionList({
  sessions,
  opencodeSessions,
  activeSessionId,
  activeOpencodeSessionId,
  activeProject,
  creating,
  onCreateSession,
  onSelectSession,
  onSelectOpencodeSession,
}: Props) {
  const [view, setView] = useState<'bizar' | 'all'>('all');
  const [showAll, setShowAll] = useState(false);
  const VISIBLE_LIMIT = 30;

  const allSorted = view === 'all'
    ? [...sessions, ...opencodeSessions].sort((a, b) => Number(b.mtime) - Number(a.mtime))
    : sessions;
  const displayedSessions = showAll ? allSorted : allSorted.slice(0, VISIBLE_LIMIT);

  const totalOpencode = opencodeSessions.length;

  const handleSelectSession = (s: ChatSession) => {
    if (s.source === 'opencode') {
      // Render opencode session in-dash — no window.open redirect
      onSelectOpencodeSession(s);
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
            const isOpencode = s.source === 'opencode';
            const isActive = isOpencode
              ? activeOpencodeSessionId === s.id
              : activeSessionId === s.id;
            return (
              <li
                key={isOpencode ? `oc-${s.id}` : s.id}
                className={`chat-sessions-item ${isActive ? 'active' : ''} ${isOpencode ? 'chat-sessions-item-opencode' : ''}`}
                onClick={() => handleSelectSession(s)}
                title={isOpencode ? `Open in dashboard: ${s.title || s.id}` : s.id}
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

      {allSorted.length > VISIBLE_LIMIT && (
        <button
          type="button"
          className="chat-sessions-show-more"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll
            ? `Show less (${allSorted.length - VISIBLE_LIMIT} hidden)`
            : `Show all ${allSorted.length} sessions`}
        </button>
      )}
    </div>
  );
}
