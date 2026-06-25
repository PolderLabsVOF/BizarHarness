// src/views/Overview.tsx — v3.7.0 activity cards + SSE stream.
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
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Puzzle,
  Clock,
  FolderSearch,
  EyeOff,
  Eye,
  X,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { FileBrowser } from '../components/FileBrowser';
import { api } from '../lib/api';
import { formatRelative, formatTime } from '../lib/utils';
import type { Overview, Settings, Snapshot, ActivityItem, ProjectRecord, Mod, ScanResult, DirectoryListing } from '../lib/types';
import { cn } from '../lib/utils';

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
  // v3.7.0 — Live activity feed via SSE
  const [activityItems, setActivityItems] = useState<ActivityItem[]>(
    snapshot.overview?.recentActivity ?? [],
  );
  const [activityExpanded, setActivityExpanded] = useState(false);
  // v3.15.0 — Hidden event keys are stored server-side; we just track
  // the set in client state. Hiding does NOT delete — see Settings →
  // Activity Log for the full feed.
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  // v3.15.0 — Load hidden set once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get<{ hidden: string[] }>('/activity/hidden');
        if (!cancelled) setHiddenKeys(new Set(r.hidden || []));
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // v3.15.0 — Helper: stable key per activity item
  const itemKey = (it: ActivityItem, idx: number): string => {
    const k = `${it.kind || ''}|${it.ts || ''}|${(it.slug as string) || (it.title as string) || ''}|${idx}`;
    // hash to a short key (matches server-side activityKey derivation)
    let h = 0;
    for (let i = 0; i < k.length; i++) h = ((h << 5) - h + k.charCodeAt(i)) | 0;
    return Math.abs(h).toString(16).padStart(8, '0').slice(0, 16);
  };

  const onHide = async (key: string) => {
    const next = new Set(hiddenKeys);
    next.add(key);
    setHiddenKeys(next);
    try {
      await api.post('/activity/hide', { keys: [key] });
    } catch (err) {
      // rollback on failure
      const rollback = new Set(hiddenKeys);
      setHiddenKeys(rollback);
      toast.error(`Hide failed: ${(err as Error).message}`);
    }
  };

  const onClearAll = async () => {
    if (!confirm('Hide every recent activity item from the overview? The full log stays in Settings → Activity Log.')) return;
    const all = activityItems.map((it, idx) => itemKey(it, idx));
    const next = new Set(hiddenKeys);
    all.forEach((k) => next.add(k));
    setHiddenKeys(next);
    try {
      await api.post('/activity/hide', { keys: all });
      toast.success(`Hidden ${all.length} item(s). Restore them in Settings → Activity Log.`);
    } catch (err) {
      toast.error(`Clear failed: ${(err as Error).message}`);
    }
  };

  const onRestoreAll = async () => {
    setHiddenKeys(new Set());
    try {
      await api.del('/activity/hide');
      toast.success('All hidden activity restored to the overview.');
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`);
    }
  };

  // v3.7.0 — Sync initial snapshot data
  useEffect(() => {
    if (snapshot.overview) {
      setOverview(snapshot.overview);
      setActivityItems(snapshot.overview.recentActivity ?? []);
      setLoading(false);
    }
    setProjects(snapshot.projects || []);
    setActiveId(snapshot.activeProject?.id || null);
    setMods(snapshot.mods || []);
  }, [snapshot.overview, snapshot.projects, snapshot.activeProject, snapshot.mods]);

  // v3.7.0 — Subscribe to SSE activity stream
  // v3.6.0 — Append ?token=… for auth. EventSource can't set custom
  // headers, so the server accepts the token via query string too.
  useEffect(() => {
    let es: EventSource;
    try {
      const tok = api.getToken();
      const url = tok
        ? `/api/activity/stream?token=${encodeURIComponent(tok)}`
        : '/api/activity/stream';
      es = new EventSource(url);
      es.addEventListener('snapshot', (e) => {
        try {
          const parsed = JSON.parse((e as MessageEvent).data) as { events: ActivityItem[]; generatedAt?: string };
          setActivityItems(Array.isArray(parsed.events) ? parsed.events.slice(0, 50) : []);
        } catch { /* ignore parse errors */ }
      });
      es.addEventListener('activity', (e) => {
        try {
          const entry = JSON.parse((e as MessageEvent).data) as ActivityItem;
          setActivityItems((cur) => [entry, ...cur].slice(0, 50));
        } catch { /* ignore parse errors */ }
      });
    } catch { /* SSE not available — fallback to snapshot data */ }
    return () => { try { es?.close(); } catch { /* ignore */ } };
  }, []);

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
    modal.open({
      title: 'Add project',
      children: (
        <AddProjectDialog
          settings={settings}
          onAdd={async (path: string, name: string | null) => {
            try {
              const r = await api.post<ProjectRecord>('/projects', { path, name });
              setProjects((cur) => [...cur.filter((p) => p.id !== r.id), r]);
              toast.success('Project added.');
              modal.close();
            } catch (err) {
              toast.error(`Add failed: ${(err as Error).message}`);
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
        <div className="overview-feed-head">
          <h2>Recent activity</h2>
          <div className="overview-feed-head-actions">
            {hiddenKeys.size > 0 && (
              <Button variant="ghost" size="sm" onClick={onRestoreAll} title="Restore hidden items to this overview">
                <Eye size={12} /> Show {hiddenKeys.size} hidden
              </Button>
            )}
            {activityItems.length > 8 && (
              <Button variant="ghost" size="sm" onClick={() => setActivityExpanded((v) => !v)}>
                {activityExpanded ? 'Show less' : 'Show all'}
              </Button>
            )}
            {activityItems.length > 0 && (
              <Button variant="ghost" size="sm" onClick={onClearAll} title="Hide every item from the overview (full log kept)">
                <EyeOff size={12} /> Hide all
              </Button>
            )}
          </div>
        </div>
        {hiddenKeys.size > 0 && (
          <div className="activity-hidden-banner" role="status">
            <span>
              <EyeOff size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
              {hiddenKeys.size} item{hiddenKeys.size === 1 ? '' : 's'} hidden from the overview.
            </span>
            <Button variant="ghost" size="sm" onClick={onRestoreAll}>
              <Eye size={12} /> Show them again
            </Button>
          </div>
        )}
        {activityItems.length === 0 ? (
          <div className="muted" style={{ padding: '24px 0', fontSize: 13 }}>
            No activity yet. Use the chat above or invoke a Bizar command to start a feed.
          </div>
        ) : (
          <div className={cn('activity-feed-list-wrap', !activityExpanded && 'activity-feed-list-wrap-collapsed')}>
            <div className="activity-feed-list">
              {activityItems.slice(0, 30).map((it, idx) => {
                const k = itemKey(it, idx);
                if (hiddenKeys.has(k)) return null;
                return (
                  <ActivityFeedItem
                    key={`${it.ts}-${idx}`}
                    item={it}
                    activityKey={k}
                    onNavigate={setActiveTab}
                    onHide={onHide}
                  />
                );
              })}
            </div>
            {!activityExpanded && activityItems.length > 8 && <div className="activity-feed-fade" aria-hidden="true" />}
          </div>
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
          {settings?.dashboard?.projectsDirectory && (
            <Button
              variant="ghost"
              size="sm"
              title={`Scan ${settings.dashboard.projectsDirectory} for projects`}
              onClick={async () => {
                try {
                  const r = await api.post<ScanResult>('/projects/scan');
                  if (r.error) {
                    toast.error(r.error);
                  } else {
                    toast.success(`Added ${r.added.length}, skipped ${r.skipped}.`);
                  }
                  await refreshSnapshot();
                  const data = await api.get<{ projects: ProjectRecord[]; active: string | null }>('/projects');
                  setProjects(data.projects || []);
                  setActiveId(data.active || null);
                } catch (err) {
                  toast.error(`Scan failed: ${(err as Error).message}`);
                }
              }}
            >
              <FolderSearch size={12} /> Scan
            </Button>
          )}
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

// ─── AddProjectDialog ─────────────────────────────────────────────────────────

/**
 * Pre-flight approach: before POST /projects we verify the selected path
 * still exists (GET /fs?path=...). This avoids the ugly 404 toast when a
 * directory is deleted between selection and submit.
 */
function AddProjectDialog({
  settings,
  onAdd,
}: {
  settings: Settings;
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
      // Path is valid — proceed with the POST
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
        <label className="field-label" htmlFor="add-project-name">Name (optional)</label>
        <input
          id="add-project-name"
          className="input"
          type="text"
          placeholder="My App"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="field-help" style={{ marginTop: 4 }}>
          Display name for this project. Defaults to the folder name.
        </p>
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

function sentenceCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function humanizeKind(kind: string): string {
  const normalized = (kind || 'activity').trim().toLowerCase().replace(/[:_]/g, '.');
  const [scopeRaw, actionRaw = 'updated'] = normalized.split('.');
  const scopeMap: Record<string, string> = {
    settings: 'Settings',
    task: 'Task',
    tasks: 'Task',
    agent: 'Agent',
    agents: 'Agent',
    plan: 'Plan',
    plans: 'Plan',
    bg: 'Background job',
    background: 'Background job',
    session: 'Session',
    mod: 'Mod',
    mods: 'Mod',
    provider: 'Provider',
    providers: 'Provider',
  };
  const actionMap: Record<string, string> = {
    create: 'created', created: 'created',
    add: 'added', added: 'added',
    update: 'updated', updated: 'updated',
    delegate: 'delegated', delegated: 'delegated',
    invoke: 'invoked', invoked: 'invoked',
    restart: 'restarted', restarted: 'restarted',
    delete: 'deleted', deleted: 'deleted',
    remove: 'removed', removed: 'removed',
    archive: 'archived', archived: 'archived',
    restore: 'restored', restored: 'restored',
    complete: 'completed', completed: 'completed',
    fail: 'failed', failed: 'failed',
    error: 'errored', stuck: 'marked stuck',
  };
  const scope = scopeMap[scopeRaw] || sentenceCase(scopeRaw.replace(/-/g, ' '));
  const action = actionMap[actionRaw] || actionRaw.replace(/-/g, ' ');
  return `${scope} ${action}`.trim();
}

function firstString(it: ActivityItem, keys: string[]): string {
  for (const key of keys) {
    const value = it[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function formatActivitySummary(it: ActivityItem): string {
  const direct = firstString(it, ['message', 'text', 'prompt', 'title', 'name']);
  if (direct) return direct;
  const parts: string[] = [];
  const slug = firstString(it, ['slug']);
  const agent = firstString(it, ['agent', 'author']);
  const status = firstString(it, ['status']);
  if (slug) parts.push(`Plan ${slug}`);
  if (agent) parts.push(agent);
  if (status) parts.push(status);
  return parts.length ? parts.join(' · ') : 'No additional details.';
}

// v3.7.0 — Format a timestamp as a relative string ("2m ago", "1h ago")
function formatRelativeTime(ts: string): string {
  return formatRelative(ts);
}

// v3.7.0 — Get severity color token from kind or status field
function activitySeverity(it: ActivityItem): 'error' | 'warning' | 'success' | 'info' {
  const k = ((it.kind as string) || '').toLowerCase();
  const s = ((it.status as string) || '').toLowerCase();
  if (k.includes('error') || s === 'error' || s === 'failure') return 'error';
  if (k.includes('warn') || s === 'blocked') return 'warning';
  if (k.includes('done') || k.includes('success') || s === 'done') return 'success';
  return 'info';
}

// v3.7.0 — Map activity kind to icon
function activityIcon(kind: string) {
  const k = kind.toLowerCase();
  if (k === 'task') return CheckSquare;
  if (k === 'agent') return Bot;
  if (k === 'plan') return Map;
  if (k.includes('bg') || k.includes('background') || k.includes('job')) return Zap;
  if (k === 'mod') return Puzzle;
  if (k === 'skill') return Sparkles;
  if (k.includes('error') || k.includes('failure')) return AlertOctagon;
  if (k.includes('warn')) return AlertTriangle;
  return Activity;
}

// v3.7.0 — Navigate to the relevant tab when a card is clicked
function activityNavTarget(kind: string): string | null {
  const k = kind.toLowerCase();
  if (k === 'task') return 'tasks';
  if (k === 'agent') return 'agents';
  if (k === 'plan') return 'plans';
  if (k.includes('bg') || k.includes('background')) return 'activity';
  if (k === 'mod') return 'mods';
  if (k === 'skill') return 'skills';
  return null;
}

// v3.7.0 — Activity card component
function ActivityFeedItem({
  item,
  activityKey,
  onNavigate,
  onHide,
}: {
  item: ActivityItem;
  activityKey: string;
  onNavigate: (tab: string) => void;
  onHide: (key: string) => void;
}) {
  const severity = activitySeverity(item);
  const Icon = activityIcon(item.kind || '');
  const title = humanizeKind(item.kind || 'activity');
  const msg = formatActivitySummary(item);
  const navTarget = activityNavTarget(item.kind || '');

  const accentColor =
    severity === 'error' ? 'var(--error)' :
    severity === 'warning' ? 'var(--warning)' :
    severity === 'success' ? 'var(--success)' :
    'var(--accent)';

  return (
    <div className={cn('activity-feed-row', `activity-feed-row-${severity}`)}>
      <button
        type="button"
        className="activity-feed-row-main"
        onClick={() => { if (navTarget) onNavigate(navTarget); }}
        title={navTarget ? `Open ${navTarget}` : title}
      >
        <div className="activity-feed-icon" style={{ color: accentColor }}>
          <Icon size={14} />
        </div>
        <div className="activity-feed-body">
          <div className="activity-feed-title-row">
            <div className="activity-feed-title">{title}</div>
            <div className="activity-feed-time text-xs muted tabular-nums">{formatRelativeTime(item.ts)}</div>
          </div>
          <div className="activity-feed-summary text-sm">{msg}</div>
        </div>
      </button>
      <button
        type="button"
        className="activity-feed-hide-btn"
        onClick={() => onHide(activityKey)}
        title="Hide this from the overview (kept in Settings → Activity Log)"
        aria-label="Hide from overview"
      >
        <X size={12} />
      </button>
    </div>
  );
}
