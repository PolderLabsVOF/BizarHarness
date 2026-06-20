// src/components/Topbar.tsx — header with brand, project selector, search, tabs, ws status.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  Bot,
  Map,
  Folder,
  CheckSquare,
  Settings2,
  Sliders,
  Puzzle,
  Clock,
  History as HistoryIcon,
  Search as SearchIcon,
  ChevronDown,
  Plus,
  RefreshCw,
  Power,
  Sparkles,
  Activity,
  Cloud,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { ProjectRecord, WsStatus, WsMessage } from '../lib/types';
import { api } from '../lib/api';

export type TabDef = {
  id: string;
  label: string;
  icon: LucideIcon;
};

export const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'providers', label: 'Providers', icon: Cloud },
  { id: 'plans', label: 'Plans', icon: Map },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'mods', label: 'Mods', icon: Puzzle },
  { id: 'schedules', label: 'Schedules', icon: Clock },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'config', label: 'Config', icon: Settings2 },
  { id: 'settings', label: 'Settings', icon: Sliders },
];

export type TopbarProps = {
  activeTab: string;
  onTabChange: (id: string) => void;
  wsStatus: WsStatus;
  version: string;
  activeProject: ProjectRecord | null;
  projects: ProjectRecord[];
  onProjectChange: (id: string) => void;
  onProjectsRefresh: () => void;
  onOpenSearch: () => void;
  rightSlot?: ReactNode;
  /**
   * v3.3.0 — Optional slot for the notifications bell. The host
   * (App.tsx) mounts the Notifications component here so it can
   * subscribe to the same WebSocket the rest of the app uses.
   */
  notificationsSlot?: ReactNode;
  /**
   * Whether to render the tabs row. In sidebar/both layouts the sidebar
   * carries navigation, so we hide this row to keep the topbar slim.
   */
  showTabs?: boolean;
};

export function Topbar({
  activeTab,
  onTabChange,
  wsStatus,
  version,
  activeProject,
  projects,
  onProjectChange,
  onProjectsRefresh,
  onOpenSearch,
  rightSlot,
  notificationsSlot,
  showTabs = true,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand">
          <span className="brand-logo" aria-hidden="true">ᛒ</span>
          <span className="brand-title">Bizar</span>
          <span className="brand-version">{version}</span>
        </div>
        <ProjectSelector
          activeProject={activeProject}
          projects={projects}
          onChange={onProjectChange}
          onRefresh={onProjectsRefresh}
        />
        <button
          type="button"
          className="topbar-search"
          onClick={onOpenSearch}
          title="Search (Ctrl/Cmd+K)"
        >
          <SearchIcon size={14} />
          <span className="muted">Search…</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="topbar-spacer" />
        <div className="topbar-right">
          {notificationsSlot}
          {rightSlot}
          <div className={cn('ws-status', `ws-${wsStatus}`)} title={`WebSocket: ${wsStatus}`}>
            <span className="ws-dot" />
            <span className="ws-label">{wsStatus}</span>
          </div>
        </div>
      </div>
      {showTabs && (
        <nav className="tabs-row" role="tablist">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn('tab', active && 'tab-active')}
                onClick={() => onTabChange(tab.id)}
                title={tab.label}
              >
                <Icon size={14} className="tab-icon" />
                <span className="tab-label">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}

function ProjectSelector({
  activeProject,
  projects,
  onChange,
  onRefresh,
}: {
  activeProject: ProjectRecord | null;
  projects: ProjectRecord[];
  onChange: (id: string) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onClick = () => setOpen(false);
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  const onAdd = async () => {
    const path = (prompt('Project path:') || '').trim();
    if (!path) return;
    try {
      await api.post('/projects', { path });
      onRefresh();
    } catch (err) {
      alert(`Add failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="project-selector" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="project-selector-btn"
        onClick={() => setOpen((v) => !v)}
        title="Switch active project"
      >
        <Folder size={14} />
        <span className="project-selector-name">
          {activeProject?.name || '(no project)'}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="project-selector-menu">
          <div className="project-selector-menu-head">
            <span className="muted">{projects.length} project{projects.length === 1 ? '' : 's'}</span>
            <div className="project-selector-menu-actions">
              <button type="button" className="icon-btn" onClick={onRefresh} title="Refresh">
                <RefreshCw size={12} />
              </button>
              <button type="button" className="icon-btn" onClick={onAdd} title="Add project">
                <Plus size={12} />
              </button>
            </div>
          </div>
          <ul className="project-selector-list">
            {projects.length === 0 && (
              <li className="muted project-selector-empty">No projects. Add one to start.</li>
            )}
            {projects.map((p) => (
              <li
                key={p.id}
                className={cn('project-selector-item', activeProject?.id === p.id && 'active')}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
              >
                <span className="project-selector-item-name">{p.name}</span>
                <span className="project-selector-item-status">{p.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
