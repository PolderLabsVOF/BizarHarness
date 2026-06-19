// src/mobile/views/MobileTasks.tsx — mobile tasks tab: vertical list grouped by status.
import { useEffect, useState } from 'react';
import { CheckSquare, RefreshCw, Plus, Trash2, Archive } from 'lucide-react';
import { api } from '../../lib/api';
import { formatRelative, priorityColors } from '../../lib/utils';
import type { Snapshot, Task } from '../../lib/types';

type Props = {
  snapshot: Snapshot;
  onRefresh: () => Promise<void>;
};

const STATUS_ORDER = ['queued', 'doing', 'blocked', 'done'];
const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  doing: 'Doing',
  blocked: 'Blocked',
  done: 'Done',
};

export function MobileTasks({ snapshot, onRefresh }: Props) {
  const [tasks, setTasks] = useState<Task[]>(snapshot.tasks || []);
  const [loading, setLoading] = useState(!snapshot.tasks);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (snapshot.tasks) {
      setTasks(snapshot.tasks);
      setLoading(false);
    }
  }, [snapshot.tasks]);

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
    } catch {
      await reload();
    }
  };

  const archiveTask = async (taskId: string) => {
    try {
      await api.post(`/tasks/${encodeURIComponent(taskId)}/archive`);
      setTasks((cur) => cur.filter((t) => t.id !== taskId));
    } catch {
      // best-effort
    }
  };

  const filtered = filter.trim()
    ? tasks.filter((t) =>
        (t.title || '').toLowerCase().includes(filter.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(filter.toLowerCase()),
      )
    : tasks;

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
        />
        <button
          type="button"
          className="mobile-icon-btn"
          onClick={() => reload()}
          aria-label="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Tasks by status */}
      {STATUS_ORDER.map((status) => {
        const group = filtered.filter((t) => t.status === status);
        if (group.length === 0 && filter) return null;
        return (
          <section key={status} className="mobile-section">
            <h3 className="mobile-section-title">
              {STATUS_LABELS[status]} ({group.length})
            </h3>
            {group.length === 0 ? (
              <p className="mobile-empty-inline">No tasks</p>
            ) : (
              <div className="mobile-card-list">
                {group.map((t) => (
                  <div key={t.id} className="mobile-task-card">
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
                      </div>
                    </div>
                    <div className="mobile-task-actions">
                      {status !== 'done' && (
                        <button
                          type="button"
                          className="mobile-icon-btn"
                          onClick={() => moveTask(t.id, 'done')}
                          aria-label="Mark done"
                          title="Done"
                        >
                          <CheckSquare size={16} />
                        </button>
                      )}
                      {status === 'done' && (
                        <button
                          type="button"
                          className="mobile-icon-btn"
                          onClick={() => moveTask(t.id, 'queued')}
                          aria-label="Reopen"
                          title="Reopen"
                        >
                          <RefreshCw size={16} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="mobile-icon-btn mobile-icon-btn-danger"
                        onClick={() => deleteTask(t.id)}
                        aria-label="Delete"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {filtered.length === 0 && (
        <div className="mobile-empty">
          <CheckSquare size={40} />
          <p>No tasks yet.</p>
        </div>
      )}
    </div>
  );
}
