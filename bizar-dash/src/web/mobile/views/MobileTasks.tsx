// src/mobile/views/MobileTasks.tsx — kanban-style task board with task detail.
import { useEffect, useState } from 'react';
import { CheckSquare, RefreshCw, Plus, Trash2, Archive, X, Clock, MessageSquare, Link2, FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { formatRelative, priorityColors } from '../../lib/utils';
import type { Snapshot, Task } from '../../lib/types';
import { MobileBottomSheet } from '../components/MobileBottomSheet';
import { MobileModal } from '../components/MobileModal';

type Props = {
  snapshot: Snapshot;
  onRefresh: () => Promise<void>;
  selectedTaskId?: string;
  onCloseDetail?: () => void;
  // v3.6.2 — Pipeline: callbacks to open chat or artifact for a task.
  onOpenChat?: (taskId: string) => void;
  onOpenArtifact?: (artifactId: string) => void;
};

const STATUS_ORDER = ['queued', 'doing', 'blocked', 'done'];
const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  doing: 'Doing',
  blocked: 'Blocked',
  done: 'Done',
};
const NEXT_STATUS: Record<string, string> = {
  queued: 'doing',
  doing: 'done',
  blocked: 'queued',
  done: 'queued',
};

export function MobileTasks({ snapshot, onRefresh, selectedTaskId, onCloseDetail, onOpenChat, onOpenArtifact }: Props) {
  const [tasks, setTasks] = useState<Task[]>(snapshot.tasks || []);
  const [loading, setLoading] = useState(!snapshot.tasks);
  const [filter, setFilter] = useState('');
  const [activeStatus, setActiveStatus] = useState<string>('queued');
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  // v3.6.2 — state for the mobile artifact viewer sheet.
  const [artifactTaskId, setArtifactTaskId] = useState<string | null>(null);
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [artifactContent, setArtifactContent] = useState<string>('');
  const [artifactMeta, setArtifactMeta] = useState<{ name?: string; contentType?: string; size?: number } | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'priority'>('updated');

  useEffect(() => {
    if (snapshot.tasks) {
      setTasks(snapshot.tasks);
      setLoading(false);
    }
    if (selectedTaskId) {
      const t = snapshot.tasks?.find((t) => t.id === selectedTaskId);
      if (t) setDetailTask(t);
    }
  }, [snapshot.tasks, selectedTaskId]);

  useEffect(() => {
    if (selectedTaskId) {
      const t = tasks.find((t) => t.id === selectedTaskId);
      if (t) setDetailTask(t);
    }
  }, [selectedTaskId, tasks]);

  const reload = async () => {
    try {
      const data = await api.get<Task[]>('/tasks');
      setTasks(Array.isArray(data) ? data : []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  const moveTask = async (taskId: string, newStatus: string) => {
    setTasks((cur) =>
      cur.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
    );
    if (detailTask?.id === taskId) {
      setDetailTask((t) => t ? { ...t, status: newStatus } : t);
    }
    try {
      await api.patch(`/tasks/${encodeURIComponent(taskId)}/status`, { status: newStatus });
    } catch {
      await reload();
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm('Delete this task?')) return;
    try {
      await api.del(`/tasks/${encodeURIComponent(taskId)}`);
      setTasks((cur) => cur.filter((t) => t.id !== taskId));
      if (detailTask?.id === taskId) setDetailTask(null);
    } catch {
      await reload();
    }
  };

  const archiveTask = async (taskId: string) => {
    try {
      await api.post(`/tasks/${encodeURIComponent(taskId)}/archive`);
      setTasks((cur) => cur.filter((t) => t.id !== taskId));
      if (detailTask?.id === taskId) setDetailTask(null);
    } catch {
      // best-effort
    }
  };

  const filtered = tasks.filter((t) => {
    if (filter.trim()) {
      const q = filter.toLowerCase();
      if (!(t.title || '').toLowerCase().includes(q) && !(t.description || '').toLowerCase().includes(q)) {
        return false;
      }
    }
    if (assigneeFilter.trim()) {
      if (!t.assignee?.toLowerCase().includes(assigneeFilter.toLowerCase())) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'priority': {
        const order = { high: 0, normal: 1, low: 2 };
        return (order[a.priority as keyof typeof order] ?? 1) - (order[b.priority as keyof typeof order] ?? 1);
      }
      case 'created': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case 'updated':
      default:
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
  });

  const activeTasks = sorted.filter((t) => t.status === activeStatus);
  const agents = snapshot.agents || [];

  const createTask = async (title: string, description: string, assignee: string, priority: string) => {
    try {
      const task = await api.post<Task>('/tasks', { title, description, assignee: assignee || null, priority });
      setTasks((cur) => [task, ...cur]);
      setNewTaskOpen(false);
    } catch {
      // best-effort
    }
  };

  // v3.6.2 — Open the artifact viewer for a task's artifact.
  const openTaskArtifact = async (taskId: string) => {
    setArtifactLoading(true);
    setArtifactContent('');
    setArtifactMeta(null);
    setArtifactTaskId(taskId);
    try {
      const artR = await api.get<{ artifacts: { id: string; name?: string; contentType?: string; size?: number }[] }>(
        `/tasks/${encodeURIComponent(taskId)}/artifacts`,
      );
      const ids = (artR.artifacts || []).map((a) => a.id);
      setArtifactIds(ids);
      if (ids.length > 0) {
        const [meta, content] = await Promise.all([
          api.get<{ name?: string; contentType?: string; size?: number }>(`/artifacts/${encodeURIComponent(ids[0])}`),
          fetch(`/api/artifacts/${encodeURIComponent(ids[0])}/content`).then((r) => r.text()),
        ]);
        setArtifactMeta(meta);
        setArtifactContent(content);
      }
    } catch {
      // best-effort
    } finally {
      setArtifactLoading(false);
    }
  };

  if (loading) {
    return <div className="mobile-loading"><p>Loading…</p></div>;
  }

  return (
    <div className="mobile-view mobile-view-tasks">
      {/* Toolbar */}
      <div className="mobile-tasks-toolbar">
        <input
          className="mobile-search-input"
          type="text"
          placeholder="Search tasks…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="button" className="mobile-icon-btn" onClick={() => reload()} aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Filter + Sort row */}
      <div className="mobile-tasks-filters">
        <select
          className="mobile-filter-select"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
        >
          <option value="">All</option>
          <option value="mine">Mine</option>
          {agents.map((a) => (
            <option key={a.name} value={`@${a.name}`}>@{a.name}</option>
          ))}
        </select>
        <select
          className="mobile-filter-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'updated' | 'created' | 'priority')}
        >
          <option value="updated">Updated</option>
          <option value="created">Created</option>
          <option value="priority">Priority</option>
        </select>
      </div>

      {/* Kanban segments */}
      <div className="mobile-kanban-tabs">
        {STATUS_ORDER.map((s) => {
          const count = sorted.filter((t) => t.status === s).length;
          return (
            <button
              key={s}
              type="button"
              className={`mobile-kanban-tab ${activeStatus === s ? 'active' : ''}`}
              onClick={() => setActiveStatus(s)}
            >
              {STATUS_LABELS[s]} ({count})
            </button>
          );
        })}
      </div>

      {/* Task list */}
      <div className="mobile-card-list">
        {activeTasks.length === 0 && (
          <p className="mobile-empty-inline">No tasks</p>
        )}
        {activeTasks.map((t) => (
          <div
            key={t.id}
            className="mobile-task-card"
            onClick={() => setDetailTask(t)}
          >
            <div
              className="priority-dot"
              style={{ background: priorityColors[t.priority] || 'var(--info)' }}
            />
            <div className="task-content">
              <div className="task-title">{t.title}</div>
              <div className="task-meta">
                {t.assignee ? `@${t.assignee}` : 'unassigned'}
                {' · '}
                {formatRelative(t.updatedAt || t.createdAt)}
                {t.dependencies?.length ? ` · ${t.dependencies.length} deps` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* FAB */}
      <button
        type="button"
        className="mobile-fab"
        onClick={() => setNewTaskOpen(true)}
        aria-label="Add task"
      >
        <Plus size={24} />
      </button>

      {/* Task Detail Sheet */}
      <MobileBottomSheet
        open={!!detailTask}
        onClose={() => { setDetailTask(null); onCloseDetail?.(); }}
        title="Task Detail"
        actions={
          detailTask && (
            <div className="mobile-task-detail-actions">
              {detailTask.status !== 'done' && (
                <button
                  type="button"
                  className="mobile-btn"
                  style={{ flex: 1 }}
                  onClick={() => {
                    if (detailTask) moveTask(detailTask.id, NEXT_STATUS[detailTask.status]);
                  }}
                >
                  Move to {STATUS_LABELS[NEXT_STATUS[detailTask.status] || 'queued']}
                </button>
              )}
              <button
                type="button"
                className="mobile-btn mobile-btn-secondary"
                onClick={() => {
                  if (detailTask) archiveTask(detailTask.id);
                }}
              >
                <Archive size={14} /> Archive
              </button>
              {/* v3.6.2 — Pipeline: Chat button */}
              {!!((detailTask.metadata as { sessionId?: string; bgInstanceId?: string })?.sessionId || (detailTask.metadata as { sessionId?: string; bgInstanceId?: string })?.bgInstanceId) && (
                <button
                  type="button"
                  className="mobile-btn mobile-btn-secondary"
                  onClick={() => { onOpenChat?.(detailTask.id); }}
                >
                  <MessageSquare size={14} /> Chat
                </button>
              )}
              {/* v3.6.2 — Pipeline: Artifact button */}
              {!!((detailTask.metadata as { artifactIds?: string[]; artifactId?: string })?.artifactIds?.length || (detailTask.metadata as { artifactIds?: string[]; artifactId?: string })?.artifactId) && (
                <button
                  type="button"
                  className="mobile-btn mobile-btn-secondary"
                  onClick={() => { openTaskArtifact(detailTask.id); }}
                >
                  <FileText size={14} /> Artifact
                </button>
              )}
              <button
                type="button"
                className="mobile-btn mobile-btn-danger"
                onClick={() => {
                  if (detailTask) deleteTask(detailTask.id);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )
        }
      >
        {detailTask && (
          <div className="mobile-task-detail">
            <div className="mobile-task-detail-header">
              <span className={`mobile-task-status-badge status-${detailTask.status}`}>
                {STATUS_LABELS[detailTask.status] || detailTask.status}
              </span>
              <span className={`mobile-task-priority priority-${detailTask.priority}`}>
                {detailTask.priority}
              </span>
            </div>
            <h3 className="mobile-task-detail-title">{detailTask.title}</h3>
            {detailTask.description && (
              <p className="mobile-task-detail-desc">{detailTask.description}</p>
            )}
            <div className="mobile-task-detail-meta">
              {detailTask.assignee && (
                <div className="mobile-task-detail-row">
                  <span>Assignee</span>
                  <span>@{detailTask.assignee}</span>
                </div>
              )}
              {detailTask.dueDate && (
                <div className="mobile-task-detail-row">
                  <span>Due</span>
                  <span>{new Date(detailTask.dueDate).toLocaleDateString()}</span>
                </div>
              )}
              {detailTask.timeSpent != null && (
                <div className="mobile-task-detail-row">
                  <span>Time spent</span>
                  <span>{Math.round(detailTask.timeSpent / 60000)}min</span>
                </div>
              )}
              {detailTask.dependencies?.length ? (
                <div className="mobile-task-detail-row">
                  <span>Dependencies</span>
                  <span>{detailTask.dependencies.length}</span>
                </div>
              ) : null}
              {detailTask.comments?.length ? (
                <div className="mobile-task-detail-row">
                  <span>Comments</span>
                  <span>{detailTask.comments.length}</span>
                </div>
              ) : null}
              <div className="mobile-task-detail-row">
                <span>Created</span>
                <span>{formatRelative(detailTask.createdAt)}</span>
              </div>
              <div className="mobile-task-detail-row">
                <span>Updated</span>
                <span>{formatRelative(detailTask.updatedAt)}</span>
              </div>
            </div>
          </div>
        )}
      </MobileBottomSheet>

      {/* New Task Modal */}
      <NewTaskModal
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        onCreate={createTask}
        agents={agents}
      />

      {/* v3.6.2 — Mobile artifact viewer sheet */}
      <MobileBottomSheet
        open={!!artifactTaskId}
        onClose={() => { setArtifactTaskId(null); setArtifactContent(''); setArtifactMeta(null); }}
        title={artifactMeta?.name || 'Artifact'}
        actions={
          artifactIds.length > 1 ? (
            <div className="mobile-task-detail-actions">
              {artifactIds.map((id, i) => (
                <button
                  key={id}
                  type="button"
                  className="mobile-btn mobile-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => {
                    // Reload for the selected artifact
                    setArtifactLoading(true);
                    Promise.all([
                      api.get<{ name?: string; contentType?: string; size?: number }>(`/artifacts/${encodeURIComponent(id)}`),
                      fetch(`/api/artifacts/${encodeURIComponent(id)}/content`).then((r) => r.text()),
                    ]).then(([meta, content]) => {
                      setArtifactMeta(meta);
                      setArtifactContent(content);
                      setArtifactLoading(false);
                    }).catch(() => setArtifactLoading(false));
                  }}
                >
                  Artifact {i + 1}
                </button>
              ))}
            </div>
          ) : null
        }
      >
        <div className="mobile-artifact-viewer">
          {artifactLoading ? (
            <div className="mobile-loading"><p>Loading artifact…</p></div>
          ) : artifactContent ? (
            <iframe
              srcDoc={artifactContent}
              className="mobile-artifact-iframe"
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
              title={artifactMeta?.name || 'Artifact'}
            />
          ) : (
            <div className="mobile-empty">
              <FileText size={32} />
              <p className="muted">No artifact content available.</p>
            </div>
          )}
        </div>
      </MobileBottomSheet>
    </div>
  );
}

function NewTaskModal({
  open,
  onClose,
  onCreate,
  agents,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string, description: string, assignee: string, priority: string) => void;
  agents: Snapshot['agents'];
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('normal');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate(title.trim(), description.trim(), assignee, priority);
    setTitle('');
    setDescription('');
    setAssignee('');
    setPriority('normal');
  };

  return (
    <MobileModal open={open} onClose={onClose} title="New Task" actions={
      <button type="submit" form="new-task-form" className="mobile-btn" style={{ width: '100%' }}>
        <Plus size={14} /> Create Task
      </button>
    }>
      <form id="new-task-form" onSubmit={handleSubmit} className="mobile-task-form">
        <label className="mobile-field-label">Title *</label>
        <input
          className="mobile-input"
          type="text"
          placeholder="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />
        <label className="mobile-field-label">Description</label>
        <textarea
          className="mobile-input"
          rows={3}
          placeholder="Optional description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label className="mobile-field-label">Assignee</label>
        <select
          className="mobile-input"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          <option value="">Unassigned</option>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>@{a.name}</option>
          ))}
        </select>
        <label className="mobile-field-label">Priority</label>
        <select
          className="mobile-input"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      </form>
    </MobileModal>
  );
}
