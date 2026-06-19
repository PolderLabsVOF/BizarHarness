// src/views/Overview.tsx — system overview: project picker + counts + activity.
import { useEffect, useState } from 'react';
import {
  Bot,
  CheckSquare,
  Folder,
  LayoutDashboard,
  Map,
  MessageSquare,
  RefreshCw,
  PlayCircle,
  ShieldCheck,
  FileText,
  Zap,
  Plus,
  Trash2,
  Power,
  Search as SearchIcon,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { api } from '../lib/api';
import { formatRelative, formatTime } from '../lib/utils';
import type { Overview, Settings, Snapshot, ActivityItem, ProjectRecord, Mod } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

export function Overview({
  snapshot,
  settings,
  setActiveTab,
  refreshSnapshot,
}: Props) {
  const toast = useToast();
  const modal = useModal();
  const [overview, setOverview] = useState<Overview | null>(
    snapshot.overview ?? null,
  );
  const [loading, setLoading] = useState(!snapshot.overview);
  const [projects, setProjects] = useState<ProjectRecord[]>(snapshot.projects || []);
  const [activeId, setActiveId] = useState<string | null>(
    snapshot.activeProject?.id || null,
  );
  const [mods, setMods] = useState<Mod[]>(snapshot.mods || []);

  useEffect(() => {
    if (snapshot.overview) {
      setOverview(snapshot.overview);
      setLoading(false);
    }
    setProjects(snapshot.projects || []);
    setActiveId(snapshot.activeProject?.id || null);
    setMods(snapshot.mods || []);
  }, [snapshot.overview, snapshot.projects, snapshot.activeProject, snapshot.mods]);

  const onRefresh = async () => {
    toast.info('Refreshing…', 1500);
    await refreshSnapshot();
    try {
      const data = await api.get<{ projects: ProjectRecord[]; active: string | null }>('/projects');
      setProjects(data.projects || []);
      setActiveId(data.active || null);
    } catch { /* ignore */ }
  };

  const onAddProject = () => {
    let pathEl: HTMLInputElement | null = null;
    let nameEl: HTMLInputElement | null = null;
    modal.open({
      title: 'Add project',
      children: (
        <div>
          <label className="field-label">Path (absolute)</label>
          <input
            ref={(el) => (pathEl = el)}
            className="input"
            type="text"
            placeholder="/home/user/projects/myapp"
            autoFocus
          />
          <label className="field-label" style={{ marginTop: 12 }}>Name (optional)</label>
          <input
            ref={(el) => (nameEl = el)}
            className="input"
            type="text"
            placeholder="My App"
          />
        </div>
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const path = (pathEl?.value || '').trim();
              const name = (nameEl?.value || '').trim() || null;
              if (!path) {
                toast.warning('Path is required.');
                return;
              }
              try {
                const r = await api.post<ProjectRecord>('/projects', { path, name });
                setProjects((cur) => [...cur.filter((p) => p.id !== r.id), r]);
                toast.success('Project added.');
                modal.close();
              } catch (err) {
                toast.error(`Add failed: ${(err as Error).message}`);
              }
            }}
          >
            Add
          </Button>
        </div>
      ),
    });
  };

  const onActivate = async (id: string) => {
    try {
      await api.post(`/projects/${encodeURIComponent(id)}/activate`);
      setActiveId(id);
      toast.success('Project activated.');
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Activate failed: ${(err as Error).message}`);
    }
  };

  const onRemove = async (id: string) => {
    if (!confirm(`Remove project "${id}" from the registry?`)) return;
    try {
      await api.del(`/projects/${encodeURIComponent(id)}`);
      setProjects((cur) => cur.filter((p) => p.id !== id));
      if (activeId === id) setActiveId(null);
      toast.success('Project removed.');
    } catch (err) {
      toast.error(`Remove failed: ${(err as Error).message}`);
    }
  };

  if (loading || !overview) {
    return (
      <div className="view-loading">
        <Spinner size="lg" />
        <p>Loading overview…</p>
      </div>
    );
  }

  return (
    <div className="view view-overview">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <LayoutDashboard size={18} />
            System Overview
          </h2>
          <p className="view-subtitle">
            {projects.length} project{projects.length === 1 ? '' : 's'} ·
            {' '}{overview.counts.agents} agents ·
            {' '}{overview.counts.sessions} session{overview.counts.sessions === 1 ? '' : 's'}
          </p>
        </div>
        <div className="view-actions">
          <Button variant="secondary" size="sm" onClick={onAddProject}>
            <Plus size={14} /> Add project
          </Button>
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </header>

      <Card className="project-picker">
        <CardTitle>
          <Folder size={14} /> Projects
        </CardTitle>
        <CardMeta>
          Click "Open" to switch the active project. Per-project data lives in
          {' '}<code>~/.config/opencode/projects/&lt;id&gt;/</code>.
        </CardMeta>
        {projects.length === 0 ? (
          <EmptyState
            icon={<Folder size={32} />}
            title="No projects yet"
            message="Add a project to start tracking its tasks, plans, and schedules."
          />
        ) : (
          <div className="project-grid">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                active={activeId === p.id}
                onOpen={() => onActivate(p.id)}
                onRemove={() => onRemove(p.id)}
              />
            ))}
          </div>
        )}
      </Card>

      <div className="overview-cols">
        <Card>
          <CardTitle>
            <Zap size={14} /> Recent activity
          </CardTitle>
          <CardMeta>Last 30 events</CardMeta>
          {overview.recentActivity.length === 0 ? (
            <EmptyState
              icon={<FileText size={28} />}
              title="No activity yet"
              message="Use the chat or invoke a Bizar command to start a feed."
            />
          ) : (
            <ul className="activity-list">
              {overview.recentActivity.slice(0, 30).map((it, idx) => (
                <li key={idx} className="activity-item">
                  <span className="activity-ts tabular-nums">
                    {formatRelative(it.ts)}
                  </span>
                  <span className="activity-kind">{it.kind}</span>
                  <span className="activity-msg">{formatActivity(it)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Mods</CardTitle>
          <CardMeta>Extensions installed under <code>~/.config/bizar/mods/</code></CardMeta>
          {mods.length === 0 ? (
            <div className="muted">No mods installed.</div>
          ) : (
            <ul className="mod-mini-list">
              {mods.map((m) => (
                <li key={m.id} className="mod-mini">
                  <span className="mod-mini-name">{m.name}</span>
                  <span className="mod-mini-meta">v{m.version} · {m.type}</span>
                  <span className={`mod-mini-pill ${m.enabled ? 'mod-mini-pill-on' : 'mod-mini-pill-off'}`}>
                    {m.enabled ? 'on' : 'off'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Environment</CardTitle>
          <CardMeta>Runtime + paths</CardMeta>
          <dl className="env-table">
            <dt>Node</dt>
            <dd className="mono">{overview.versions.node}</dd>
            <dt>Platform</dt>
            <dd className="mono">{overview.versions.platform}</dd>
            <dt>Project root</dt>
            <dd className="mono ellipsis" title={overview.versions.projectRoot}>
              {overview.versions.projectRoot}
            </dd>
            <dt>Bizar root</dt>
            <dd className="mono ellipsis" title={overview.versions.bizarRoot}>
              {overview.versions.bizarRoot}
            </dd>
            <dt>Generated</dt>
            <dd className="mono tabular-nums">
              {formatTime(overview.generatedAt)}
            </dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  active,
  onOpen,
  onRemove,
}: {
  project: ProjectRecord;
  active: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const statusColor = {
    active: 'status-on',
    inactive: 'status-neutral',
    error: 'status-error',
  }[project.status] || 'status-neutral';
  return (
    <div className={`project-card ${active ? 'project-card-active' : ''}`}>
      <div className="project-card-head">
        <span className={`project-card-status ${statusColor}`}>
          {project.status}
        </span>
        <div className="project-card-name">{project.name}</div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Remove project"
          title="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="project-card-path mono ellipsis" title={project.path}>
        {project.path}
      </div>
      <div className="project-card-meta">
        {project.lastAccessed && (
          <span className="muted">Last opened {formatRelative(project.lastAccessed)}</span>
        )}
      </div>
      <div className="project-card-actions">
        <Button variant={active ? 'ghost' : 'primary'} size="sm" onClick={onOpen}>
          {active ? <><Power size={12} /> Active</> : <>Open</>}
        </Button>
      </div>
    </div>
  );
}

function formatActivity(it: ActivityItem): string {
  if (typeof it.message === 'string') return it.message;
  if (typeof it.prompt === 'string') return it.prompt;
  if (typeof it.slug === 'string') {
    const title = typeof it.title === 'string' ? ` title=${it.title}` : '';
    return `slug=${it.slug}${title}`;
  }
  if (typeof it.name === 'string') return `name=${it.name}`;
  return JSON.stringify(it);
}
