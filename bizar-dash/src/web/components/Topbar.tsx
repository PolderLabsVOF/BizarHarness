// src/components/Topbar.tsx — header with brand, breadcrumb, search,
// notifications slot, WS status.
//
// v8.0 — Minimalist overhaul. Flattened to a single 48px row. The
// tabs row is gone (sidebar carries navigation in sidebar/both
// layouts), the version pill is gone (no glow, no rounded badge),
// and the `showTabs` / `extraTabs` props are removed. The
// ProjectSelector stays but its styling is flattened to a
// breadcrumb-style chip.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Folder,
  ChevronRight,
  Plus,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { ProjectRecord, WsStatus, Settings, DirectoryListing } from '../lib/types';
import { api } from '../lib/api';
import { useModal } from './Modal';
import { FileBrowser } from './FileBrowser';
import { Button } from './Button';

export type TabDef = {
  id: string;
  label: string;
  icon: LucideIcon;
  isMod?: boolean;
  modId?: string;
};

export const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: ChevronRight },
  { id: 'chat', label: 'Chat', icon: ChevronRight },
  { id: 'agents', label: 'Agents', icon: ChevronRight },
  { id: 'artifacts', label: 'Glyphs', icon: ChevronRight },
  { id: 'tasks', label: 'Tasks', icon: ChevronRight },
  { id: 'activity', label: 'Activity', icon: ChevronRight },
  { id: 'background', label: 'Active', icon: ChevronRight },
  { id: 'skills', label: 'Skills', icon: ChevronRight },
  { id: 'memory', label: 'Memory', icon: ChevronRight },
  { id: 'mods', label: 'Mods', icon: ChevronRight },
  { id: 'schedules', label: 'Schedules', icon: ChevronRight },
  { id: 'history', label: 'History', icon: ChevronRight },
  { id: 'minimax', label: 'Usage', icon: ChevronRight },
  { id: 'eval', label: 'Eval', icon: ChevronRight },
  { id: 'doctor', label: 'Doctor', icon: ChevronRight },
  { id: 'harness', label: 'Harness', icon: ChevronRight },
  { id: 'settings', label: 'Settings', icon: ChevronRight },
];

export type TopbarProps = {
  wsStatus: WsStatus;
  activeProject: ProjectRecord | null;
  projects: ProjectRecord[];
  onProjectChange: (id: string) => void;
  onProjectsRefresh: () => void;
  onOpenSearch: () => void;
  settings?: Settings | null;
  rightSlot?: ReactNode;
  /**
   * v3.3.0 — Optional slot for the notifications bell. The host
   * (App.tsx) mounts the Notifications component here so it can
   * subscribe to the same WebSocket the rest of the app uses.
   */
  notificationsSlot?: ReactNode;
};

export function Topbar({
  wsStatus,
  activeProject,
  projects,
  onProjectChange,
  onProjectsRefresh,
  onOpenSearch,
  settings,
  rightSlot,
  notificationsSlot,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand">
          <span className="brand-logo" aria-hidden="true">ᛒ</span>
          <span className="brand-title">Bizar</span>
        </div>
        <span className="topbar-breadcrumb-sep" aria-hidden="true">/</span>
        <ProjectSelector
          activeProject={activeProject}
          projects={projects}
          onChange={onProjectChange}
          onRefresh={onProjectsRefresh}
          settings={settings ?? null}
        />
        <button
          type="button"
          className="topbar-search"
          onClick={onOpenSearch}
          title="Search (Ctrl/Cmd+K)"
          aria-label="Open search"
        >
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
    </header>
  );
}

function ProjectSelector({
  activeProject,
  projects,
  onChange,
  onRefresh,
  settings,
}: {
  activeProject: ProjectRecord | null;
  projects: ProjectRecord[];
  onChange: (id: string) => void;
  onRefresh: () => void;
  settings: Settings | null;
}) {
  const [open, setOpen] = useState(false);
  const modal = useModal();

  useEffect(() => {
    if (!open) return;
    const onClick = () => setOpen(false);
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  const onAdd = () => {
    modal.open({
      title: 'Add project',
      children: (
        <TopbarAddProjectDialog
          settings={settings}
          onAdd={async (path: string, name: string | null) => {
            try {
              await api.post('/projects', { path, name });
              onRefresh();
              setOpen(false);
              modal.close();
            } catch (err) {
              alert(`Add failed: ${(err as Error).message}`);
            }
          }}
        />
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
        </div>
      ),
    });
  };

  return (
    <div className="project-selector" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="project-selector-btn"
        onClick={() => setOpen((v) => !v)}
        title="Switch active project"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Folder size={14} />
        <span className="project-selector-name">
          {activeProject?.name || '(no project)'}
        </span>
        <ChevronRight size={12} />
      </button>
      {open && (
        <div className="project-selector-menu">
          <div className="project-selector-menu-head">
            <span className="muted">{projects.length} project{projects.length === 1 ? '' : 's'}</span>
            <div className="project-selector-menu-actions">
              <button type="button" className="icon-btn" onClick={onRefresh} title="Refresh" aria-label="Refresh projects">
                <RefreshCw size={12} />
              </button>
              <button type="button" className="icon-btn" onClick={onAdd} title="Add project" aria-label="Add project">
                <Plus size={12} />
              </button>
            </div>
          </div>
          <ul className="project-selector-list">
            {projects.length === 0 && (
              <li className="muted project-selector-empty">No projects. Add one to start.</li>
            )}
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={cn('project-selector-item', activeProject?.id === p.id && 'active')}
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                >
                  <span className="project-selector-item-name">{p.name}</span>
                  <span className="project-selector-item-status">{p.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── TopbarAddProjectDialog ───────────────────────────────────────────────────

function TopbarAddProjectDialog({
  settings,
  onAdd,
}: {
  settings: Settings | null;
  onAdd: (path: string, name: string | null) => void;
}) {
  const [path, setPath] = useState(settings?.dashboard?.projectsDirectory ?? '');
  const [name, setName] = useState('');
  const [preflighting, setPreflighting] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!path) return;
    setPreflighting(true);
    setPreflightError(null);
    try {
      // Pre-flight: verify the path still exists
      await api.get<DirectoryListing>('/fs?path=' + encodeURIComponent(path));
      onAdd(path, name || null);
    } catch (err) {
      const apiErr = err as { status?: number; data?: { message?: string } };
      if (apiErr.status === 404) {
        setPreflightError('That folder no longer exists. Pick another.');
      } else {
        setPreflightError(
          apiErr.data?.message ?? (err as Error).message ?? 'Validation failed.',
        );
      }
    } finally {
      setPreflighting(false);
    }
  };

  return (
    <div>
      <label className="field-label">Folder</label>
      <FileBrowser
        value={path}
        onChange={(p) => {
          setPath(p);
          setPreflightError(null);
        }}
        projectsDirectory={settings?.dashboard?.projectsDirectory}
        height={320}
      />
      {preflightError && (
        <p className="field-help" style={{ color: 'var(--error)', marginTop: 4 }}>
          {preflightError}
        </p>
      )}
      <div style={{ marginTop: 'var(--space-3)' }}>
        <label className="field-label" htmlFor="topbar-add-project-name">Name (optional)</label>
        <input
          id="topbar-add-project-name"
          className="input"
          type="text"
          placeholder="My App"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div style={{ marginTop: 'var(--space-3)', display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="primary"
          onClick={handleAdd}
          disabled={!path || preflighting}
        >
          {preflighting ? <span className="btn-spinner" /> : null}
          {preflighting ? 'Checking…' : 'Add'}
        </Button>
      </div>
    </div>
  );
}