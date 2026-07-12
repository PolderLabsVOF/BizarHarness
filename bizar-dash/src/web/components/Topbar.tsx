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
  Shield,
  Activity,
  Radio,
  Coins,
  Brain,
  Stethoscope,
  ClipboardCheck,
  Target,
  Sun,
  Moon,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { ProjectRecord, WsStatus, WsMessage, Settings, DirectoryListing } from '../lib/types';
import { api } from '../lib/api';
import { useModal } from './Modal';
import { FileBrowser } from './FileBrowser';
import { Button } from './Button';

export type TabDef = {
  id: string;
  label: string;
  icon: LucideIcon;
};

export const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'artifacts', label: 'Glyphs', icon: Map },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'background', label: 'Active', icon: Radio },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'mods', label: 'Mods', icon: Puzzle },
  { id: 'schedules', label: 'Schedules', icon: Clock },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'minimax', label: 'Usage', icon: Coins },
  // v5.2.0 — Eval framework UI. Lives next to Doctor (both are
  // operator-quality surfaces) so the "did the last eval pass?"
  // question is one click from the home screen.
  { id: 'eval', label: 'Eval', icon: ClipboardCheck },
  // v6.0.0 — Doctor page. Lives between Overview and Settings so the
  // "is everything healthy?" question is always one click from the
  // home screen and from the settings surface (where an operator
  // typically arrives after something looks off).
  { id: 'doctor', label: 'Doctor', icon: Stethoscope },
  // v6.0.0 — Harness engineering dashboard.
  { id: 'harness', label: 'Harness', icon: Shield },
  // v6.4.0 — F-036 Goal Planner UI. Plain-English → A* plan.
  { id: 'goal-planner', label: 'Goals', icon: Target },
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
  settings?: Settings | null;
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
  /**
   * v3.20.3 — Optional extra tabs (mod views) appended after the built-in
   * tabs. Each entry is the same shape as TabDef with an `id` matching
   * the mod view id (e.g. 'graphify:web').
   */
  extraTabs?: TabDef[];
  /** v6.0.0 — Cline runtime status (in-process core status). */
  clineStatus?: {
    state: 'active' | 'idle' | 'unavailable' | 'unknown';
    label: string;
    detail?: string;
  } | null;
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
  settings,
  rightSlot,
  notificationsSlot,
  showTabs = true,
  extraTabs,
  clineStatus = null,
}: TopbarProps) {
  // v7.0.4 — theme toggle hoisted from views/Overview.tsx so the
  // user can swap light/dark from any view (not only Overview).
  // Persisted to localStorage; falls back to system preference once
  // on first paint, then user choice wins.
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    const stored = window.localStorage?.getItem('bizar.theme');
    if (stored === 'light') return false;
    if (stored === 'dark') return true;
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light') return false;
    if (attr === 'dark') return true;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches === false;
  });
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      try {
        window.localStorage?.setItem('bizar.theme', 'dark');
      } catch {
        /* private mode / quota — non-fatal */
      }
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      try {
        window.localStorage?.setItem('bizar.theme', 'light');
      } catch {
        /* non-fatal */
      }
    }
  }, [isDark]);
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
          settings={settings ?? null}
        />
        <button
          type="button"
          className="topbar-search"
          onClick={onOpenSearch}
          title="Search (Ctrl/Cmd+K)"
          aria-label="Open search"
        >
          <SearchIcon size={14} />
          <span className="muted">Search…</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="topbar-spacer" />
        <div className="topbar-right">
          {notificationsSlot}
          {rightSlot}
          {/* v7.0.4 — theme toggle (hoisted from Overview so it's reachable from any view) */}
          <button
            type="button"
            className="icon-btn topbar-theme-toggle"
            onClick={() => setIsDark((v) => !v)}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            data-testid="topbar-theme-toggle"
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          {clineStatus && (
            <div
              className={cn('cline-status', `cline-${clineStatus.state}`)}
              title={clineStatus.detail || `Cline ${clineStatus.label}`}
              aria-label={`Cline runtime: ${clineStatus.label}`}
            >
              <span className="cline-dot" />
              <span className="cline-label">Cline · {clineStatus.label}</span>
            </div>
          )}
          <div className={cn('ws-status', `ws-${wsStatus}`)} title={`WebSocket: ${wsStatus}`}>
            <span className="ws-dot" />
            <span className="ws-label">{wsStatus}</span>
          </div>
        </div>
      </div>
      {showTabs && (
        <nav className="tabs-row" role="tablist" aria-label="Primary tabs">
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
                {tab.id === 'settings' && active && (
                  <span className="settings-mode-indicator" title="Settings mode active">
                    <Settings2 size={12} />
                  </span>
                )}
              </button>
            );
          })}
          {extraTabs && extraTabs.length > 0 && (
            <>
              <span className="tab-separator" aria-hidden="true" />
              {extraTabs.map((tab) => {
                const Icon = tab.icon;
                const active = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={cn('tab', 'tab-mod', active && 'tab-active')}
                    onClick={() => onTabChange(tab.id)}
                    title={`${tab.label} (mod)`}
                  >
                    <Icon size={14} className="tab-icon" />
                    <span className="tab-label">{tab.label}</span>
                    <span className="tab-badge">mod</span>
                  </button>
                );
              })}
            </>
          )}
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
        <ChevronDown size={12} />
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
