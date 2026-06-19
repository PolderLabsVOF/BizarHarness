// src/views/Overview.tsx — v3.4.0 hero textbox takes the focus, no card wrapper.
import { useEffect, useRef, useState } from 'react';
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
  Send,
  Sparkles,
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
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [overview, setOverview] = useState<Overview | null>(
    snapshot.overview ?? null,
  );
  const [loading, setLoading] = useState(!snapshot.overview);
  const [projects, setProjects] = useState<ProjectRecord[]>(snapshot.projects || []);
  const [activeId, setActiveId] = useState<string | null>(
    snapshot.activeProject?.id || null,
  );
  const [mods, setMods] = useState<Mod[]>(snapshot.mods || []);
  const [submitting, setSubmitting] = useState(false);

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

  const onUseCurrentDir = async () => {
    try {
      const data = await api.post<{ projects: ProjectRecord[]; active: string | null }>(
        '/projects/auto-detect',
      );
      setProjects(data.projects || []);
      setActiveId(data.active || null);
      const newActive = data.projects?.find((p) => p.id === data.active);
      toast.success(newActive ? `Active: ${newActive.name}` : 'Projects refreshed.');
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Auto-detect failed: ${(err as Error).message}`);
    }
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
      {/* v3.4.0 — Hero takes the spotlight. No card wrapper. */}
      <div className="overview-hero-noframe">
        <h1>What do you want to do?</h1>
        <p className="overview-hero-subtitle">
          Describe what you want — Odin will split it into tasks, create a plan,
          delegate to background agents, and track progress in real time.
        </p>
        <form
          className="overview-hero-form-noframe"
          onSubmit={async (e) => {
            e.preventDefault();
            const text = (inputRef.current?.value || '').trim();
            if (!text) return;
            setSubmitting(true);
            try {
              const r = await api.post<{ subtasks?: unknown[] }>('/tasks/submit', { title: text });
              toast.success(`Odin split it into ${(r.subtasks?.length || 1)} task(s)`);
              if (inputRef.current) inputRef.current.value = '';
              await refreshSnapshot();
            } catch (err) {
              toast.error(`Failed: ${(err as Error).message}`);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <textarea
            ref={inputRef}
            className="overview-input-hero"
            placeholder="e.g. Implement user authentication with email + password, including registration, login, password reset, and integration tests. Use Bcrypt, JWT tokens, and the existing API style."
            disabled={submitting}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={submitting}
            >
              {submitting ? <Spinner size="sm" /> : <Send size={16} />}
              Submit to Odin
            </Button>
            <span className="muted" style={{ fontSize: 12 }}>
              <Sparkles size={12} style={{ display: 'inline', verticalAlign: -2, color: 'var(--accent)' }} />
              {' '}Odin + 12 specialist agents available
            </span>
          </div>
        </form>

        <div className="overview-quick-actions-row">
          {['Implement feature', 'Fix bug', 'Refactor', 'Investigate', 'Add tests', 'Document', 'Optimize', 'Deploy'].map((action) => (
            <button
              key={action}
              type="button"
              className="overview-quick-chip"
              onClick={() => {
                if (inputRef.current) {
                  inputRef.current.value = action;
                  inputRef.current.focus();
                }
              }}
            >
              {action}
            </button>
          ))}
        </div>
      </div>

      <div className="overview-feed">
        <h2>Recent activity</h2>
        {overview.recentActivity.length === 0 ? (
          <div className="muted" style={{ padding: '24px 0', fontSize: 13 }}>
            No activity yet. Use the chat above or invoke a Bizar command to start a feed.
          </div>
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
      </div>

      {/* v3.4.0 — Below-the-fold: projects + meta (compact) */}
      <Card className="project-picker">
        <CardTitle>
          <Folder size={14} /> Projects
          <Button variant="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={onAddProject}>
            <Plus size={12} /> Add
          </Button>
          <Button variant="ghost" size="sm" onClick={onUseCurrentDir} title="Use the server's working directory">
            <Plus size={12} /> Auto-detect
          </Button>
          <Button variant="ghost" size="sm" onClick={onRefresh} title="Refresh">
            <RefreshCw size={12} />
          </Button>
        </CardTitle>
        <CardMeta>
          {projects.length} project{projects.length === 1 ? '' : 's'} ·
          {' '}{overview.counts.agents} agents ·
          {' '}{overview.counts.sessions} session{overview.counts.sessions === 1 ? '' : 's'}
        </CardMeta>
        {projects.length === 0 ? (
          <EmptyState
            icon={<Folder size={32} />}
            title="No projects yet"
            message="Add a project to start tracking its tasks, plans, and schedules."
            action={
              <div className="empty-state-actions">
                <Button variant="primary" onClick={onUseCurrentDir}>
                  <Plus size={14} /> Use current directory
                </Button>
                <Button variant="secondary" onClick={onAddProject}>
                  Add by path…
                </Button>
              </div>
            }
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
