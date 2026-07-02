// src/web/components/tasks/BacklogPanel.tsx — v3.22
// Backlog panel: lists parked tasks, promote individually or all-at-once.
import { useEffect, useState } from 'react';
import {
  ArrowUp,
  Trash2,
  Sparkles,
  RefreshCw,
  Inbox,
} from 'lucide-react';
import { Button } from '../Button';
import { useToast } from '../Toast';
import { api } from '../../lib/api';
import { formatRelative } from '../../lib/utils';
import type { Task, Agent } from '../../lib/types';

type BacklogItemProps = {
  task: Task;
  agents: Agent[];
  onPromote: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: Task) => void;
  onRefresh: () => Promise<void>;
};

function BacklogItem({ task, agents, onPromote, onDelete, onEdit, onRefresh }: BacklogItemProps) {
  const toast = useToast();

  const handlePromote = async () => {
    try {
      await api.post(`/tasks/${encodeURIComponent(task.id)}/promote`);
      toast.success('Promoted to queued.', 1500);
      onPromote(task.id);
    } catch (err) {
      toast.error(`Promote failed: ${(err as Error).message}`);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this task?')) return;
    try {
      await api.del(`/tasks/${encodeURIComponent(task.id)}`);
      toast.success('Deleted.', 1500);
      onDelete(task.id);
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const priorityDot: Record<string, string> = {
    high: 'var(--warning)',
    normal: 'var(--info)',
    low: 'var(--muted)',
  };

  return (
    <div className="backlog-item" data-task-id={task.id}>
      <div className="backlog-item-head">
        <span
          className="priority-dot"
          style={{ background: priorityDot[task.priority] || 'var(--info)' }}
        />
        <span className="backlog-item-title">{task.title}</span>
        {task.assignee && (
          <span className="backlog-item-badge">@{task.assignee}</span>
        )}
        {task.tags?.length > 0 && (
          <span className="backlog-item-badge">{task.tags.join(', ')}</span>
        )}
      </div>
      {task.description && (
        <div className="backlog-item-desc">{task.description.slice(0, 120)}</div>
      )}
      <div className="backlog-item-footer">
        <span className="muted text-sm tabular-nums">
          {formatRelative(task.createdAt)}
        </span>
        <div className="backlog-item-actions">
          <button
            type="button"
            className="icon-btn"
            title="Promote to queued"
            onClick={handlePromote}
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Edit"
            onClick={() => onEdit(task)}
          >
            <Sparkles size={13} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            title="Delete"
            onClick={handleDelete}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

type Props = {
  /** Current list of agents for the edit modal. */
  agents: Agent[];
  /** Called after any mutation so the parent can refresh snapshot. */
  onRefresh: () => Promise<void>;
};

export function BacklogPanel({ agents, onRefresh }: Props) {
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const r = await api.get<{ tasks: Task[] }>('/tasks/backlog');
      setTasks(Array.isArray(r.tasks) ? r.tasks : []);
    } catch (err) {
      toast.error(`Backlog load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handlePromote = async (id: string) => {
    setTasks((cur) => cur.filter((t) => t.id !== id));
    await onRefresh();
  };

  const handleDelete = async (id: string) => {
    setTasks((cur) => cur.filter((t) => t.id !== id));
    await onRefresh();
  };

  const handleEdit = (_task: Task) => {
    // Editing is wired through the parent Tasks view's modal helper.
    // Keep this no-op so the icon click is at least visible; the parent
    // provides the real edit affordance via the kanban.
  };

  const handlePromoteAll = async () => {
    if (tasks.length === 0) return;
    try {
      const r = await api.post<{ affected: { id: string; ok: boolean }[] }>('/tasks/promote-batch', {
        ids: tasks.map((t) => t.id),
      });
      const ok = r.affected?.filter((a) => a.ok).length ?? 0;
      toast.success(`Promoted ${ok} task(s).`, 2000);
      setTasks([]);
      await onRefresh();
    } catch (err) {
      toast.error(`Promote all failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="backlog-panel">
      <div className="backlog-panel-header">
        <span className="backlog-panel-title">
          <Inbox size={15} />
          Backlog ({tasks.length})
        </span>
        <div className="backlog-panel-header-actions">
          {tasks.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handlePromoteAll} title="Promote all to queued">
              <ArrowUp size={12} /> Promote all
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={load} title="Refresh backlog" aria-label="Refresh backlog">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="backlog-empty">Loading…</div>
      ) : tasks.length === 0 ? (
        <div className="backlog-empty">
          <Inbox size={28} />
          <span>Backlog is empty.</span>
        </div>
      ) : (
        <div className="backlog-list">
          {tasks.map((t) => (
            <BacklogItem
              key={t.id}
              task={t}
              agents={agents}
              onPromote={handlePromote}
              onDelete={handleDelete}
              onEdit={handleEdit}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
