// src/mobile/MobileTopbar.tsx — compact top bar with search, notifications, project selector.
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Snapshot } from '../lib/types';
import { api } from '../lib/api';
import { MobileNotifications } from './views/MobileNotifications';
import { MobileBottomSheet } from './components/MobileBottomSheet';

type Props = {
  activeTab: string;
  snapshot: Snapshot | null;
  onSearch: () => void;
  onNavigate: (type: string, id: string) => void;
};

const TAB_LABELS: Record<string, string> = {
  activity: 'Activity',
  chat: 'Chat',
  tasks: 'Tasks',
  settings: 'Settings',
  more: 'More',
  plans: 'Plans',
  agents: 'Agents',
  skills: 'Skills',
  mods: 'Mods',
  schedules: 'Schedules',
  history: 'History',
  config: 'Config',
  'plan-detail': 'Plan',
  'agent-detail': 'Agent',
  'task-detail': 'Task',
};

export function MobileTopbar({ activeTab, snapshot, onSearch, onNavigate }: Props) {
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);

  const handleProjectSelect = async (projectId: string) => {
    try {
      await api.post(`/projects/${encodeURIComponent(projectId)}/activate`);
      setProjectSheetOpen(false);
      // Force reload by navigating to activity
      window.location.reload();
    } catch {
      // best-effort
    }
  };

  return (
    <header className="mobile-topbar">
      <div className="mobile-topbar-left">
        <span className="mobile-logo">ᛒ</span>
        {snapshot?.activeProject && (
          <button
            type="button"
            className="mobile-project-btn"
            onClick={() => setProjectSheetOpen(true)}
            aria-label="Select project"
          >
            <span className="mobile-project-name">{snapshot.activeProject.name}</span>
            <ChevronDown size={14} />
          </button>
        )}
        <span className="mobile-title">{TAB_LABELS[activeTab] || 'Bizar'}</span>
      </div>

      <div className="mobile-topbar-right">
        <button
          type="button"
          className="mobile-icon-btn"
          onClick={onSearch}
          aria-label="Search"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </button>

        <MobileNotifications onSelect={(link) => { if (link) onNavigate('notification', link); }} />

        {snapshot?.activeProject && (
          <MobileBottomSheet
            open={projectSheetOpen}
            onClose={() => setProjectSheetOpen(false)}
            title="Projects"
          >
            <div className="mobile-project-list">
              {(snapshot.projects || []).map((p) => (
                <div
                  key={p.id}
                  className={`mobile-project-item ${p.id === snapshot.activeProject?.id ? 'active' : ''}`}
                  onClick={() => handleProjectSelect(p.id)}
                >
                  <div className="mobile-project-status" data-status={p.status} />
                  <div className="mobile-project-info">
                    <span className="mobile-project-item-name">{p.name}</span>
                    <span className="mobile-project-item-path">{p.path}</span>
                  </div>
                  {p.id === snapshot.activeProject?.id && (
                    <span className="mobile-active-badge">active</span>
                  )}
                </div>
              ))}
            </div>
          </MobileBottomSheet>
        )}
      </div>
    </header>
  );
}
