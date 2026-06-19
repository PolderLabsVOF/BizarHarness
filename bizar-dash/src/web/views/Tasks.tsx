// src/views/Tasks.tsx — v3 task board with extended fields.
import { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Plus,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Search,
  X as XIcon,
  Clock,
  PlayCircle,
  PauseCircle,
  MessageSquare,
  Activity,
  Link2,
  Calendar,
  Paperclip,
  Tag as TagIcon,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
import { Tag } from '../components/Tag';
import { useModal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn, formatRelative, priorityColors } from '../lib/utils';
import type { Settings, Snapshot, Task } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type Column = {
  id: Task['status'] | string;
  label: string;
  kind: 'info' | 'accent' | 'success';
};

const COLUMNS: Column[] = [
  { id: 'queued', label: 'Queued', kind: 'info' },
  { id: 'doing', label: 'Doing', kind: 'accent' },
  { id: 'done', label: 'Done', kind: 'success' },
];

const PRIORITIES = ['low', 'normal', 'high'] as const;
type Priority = (typeof PRIORITIES)[number];

export function Tasks({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [tasks, setTasks] = useState<Task[]>(snapshot.tasks || []);
  const [loading, setLoading] = useState(!snapshot.tasks);
  const [filter, setFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const reload = async () => {
    try {
      const data = await api.get<Task[]>('/tasks');
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(`Tasks load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (snapshot.tasks?.length || snapshot.tasks) {
      setTasks(snapshot.tasks || []);
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.tasks]);

  const filtered = useMemo(() => {
    let out = tasks;
    if (assigneeFilter) {
      out = out.filter((t) => (t.assignee || '') === assigneeFilter);
    }
    if (filter.trim()) {
      const q = filter.toLowerCase();
      out = out.filter((t) => {
        const title = (t.title || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        const tags = (t.tags || []).join(' ').toLowerCase();
        return title.includes(q) || desc.includes(q) || tags.includes(q);
      });
    }
    return out;
  }, [tasks, filter, assigneeFilter]);

  const moveTask = async (taskId: string, newStatus: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const prev = t.status;
    setTasks((cur) =>
      cur.map((x) => (x.id === taskId ? { ...x, status: newStatus } : x)),
    );
    try {
      await api.patch(`/tasks/${encodeURIComponent(taskId)}/status`, {
        status: newStatus,
      });
      toast.success(`Moved to ${newStatus}.`, 1500);
    } catch (err) {
      setTasks((cur) =>
        cur.map((x) => (x.id === taskId ? { ...x, status: prev } : x)),
      );
      toast.error(`Move failed: ${(err as Error).message}`);
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm('Delete this task?')) return;
    try {
      await api.del(`/tasks/${encodeURIComponent(taskId)}`);
      setTasks((cur) => cur.filter((t) => t.id !== taskId));
      toast.success('Task deleted.', 1500);
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const onOpen = (t: Task) => openTaskDetail(modal, toast, t, setTasks, reload, refreshSnapshot);

  // Bulk: assign all focused to "self" — for v3 just expose a per-task action
  const onAssignMe = async (t: Task) => {
    try {
      const me = 'me';
      const updated = await api.put<Task>(`/tasks/${encodeURIComponent(t.id)}`, { assignee: me });
      setTasks((cur) => cur.map((x) => (x.id === t.id ? updated : x)));
      toast.success('Assigned to me.', 1200);
    } catch (err) {
      toast.error(`Assign failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="view view-tasks">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <CheckSquare size={18} /> Tasks ({tasks.length})
          </h2>
          <p className="view-subtitle">
            Personal kanban. Click a card for details (subtasks, deps, timer, comments, activity).
          </p>
        </div>
        <div className="view-actions">
          <div className="search-input">
            <Search size={14} />
            <input
              className="input"
              type="text"
              placeholder="Search…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Clear search"
                onClick={() => setFilter('')}
              >
                <XIcon size={12} />
              </button>
            )}
          </div>
          <select
            className="select select-sm"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
          >
            <option value="">All assignees</option>
            <option value="me">Me</option>
            <option value="">—</option>
            {(snapshot.agents || []).map((a) => (
              <option key={a.name} value={a.name}>@{a.name}</option>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            onClick={() => openTaskModal(modal, toast, null, 'queued', setTasks, reload, refreshSnapshot)}
          >
            <Plus size={14} /> Add task
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="view-loading"><Spinner size="lg" /></div>
      ) : (
        <div className="kanban">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              tasks={filtered.filter((t) => t.status === col.id)}
              focusedId={focusedId}
              onFocus={setFocusedId}
              onMove={moveTask}
              onDelete={deleteTask}
              onEdit={onOpen}
              onAdd={() => openTaskModal(modal, toast, null, col.id, setTasks, reload, refreshSnapshot)}
              onAssignMe={onAssignMe}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KanbanColumn({
  column,
  tasks,
  focusedId,
  onFocus,
  onMove,
  onDelete,
  onEdit,
  onAdd,
  onAssignMe,
}: {
  column: Column;
  tasks: Task[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  onMove: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: Task) => void;
  onAdd: () => void;
  onAssignMe: (task: Task) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={cn('kanban-column', dragOver && 'kanban-column-drop')}
      data-column={column.id}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const id = e.dataTransfer.getData('text/task-id');
        if (id) onMove(id, column.id);
      }}
    >
      <div className="kanban-col-header">
        <CardTitle>
          <StatusBadge kind={column.kind} dot>
            {column.label}
          </StatusBadge>
        </CardTitle>
        <span className="kanban-col-count tabular-nums">{tasks.length}</span>
      </div>
      <div className="kanban-col-body">
        {tasks.length === 0 ? (
          <div className="kanban-empty">No tasks</div>
        ) : (
          tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              focused={focusedId === t.id}
              onFocus={() => onFocus(focusedId === t.id ? null : t.id)}
              onMove={(dir) => {
                const idx = COLUMNS.findIndex((c) => c.id === t.status);
                const next = idx + dir;
                if (next >= 0 && next < COLUMNS.length)
                  onMove(t.id, COLUMNS[next].id);
              }}
              onEdit={() => onEdit(t)}
              onDelete={() => onDelete(t.id)}
              onAssignMe={() => onAssignMe(t)}
            />
          ))
        )}
      </div>
      <footer className="kanban-col-footer">
        <Button variant="ghost" size="sm" onClick={onAdd} className="w-full">
          <Plus size={12} /> Add task
        </Button>
      </footer>
    </div>
  );
}

function TaskCard({
  task,
  focused,
  onFocus,
  onMove,
  onEdit,
  onDelete,
  onAssignMe,
}: {
  task: Task;
  focused: boolean;
  onFocus: () => void;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAssignMe: () => void;
}) {
  const hasSubtasks = false; // shown in detail view
  const isTimer = (task as unknown as { _timerStart?: number })._timerStart;
  return (
    <div
      className={cn(
        'task-card',
        `priority-${task.priority}`,
        focused && 'task-card-focused',
        isTimer ? 'task-card-timer' : null,
      )}
      data-task-id={task.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onFocus}
    >
      <div className="task-card-head">
        <span
          className="priority-dot"
          style={{ background: priorityColors[task.priority] || 'var(--info)' }}
        />
        <div className="task-card-title">{task.title}</div>
        {isTimer && <span className="task-card-timer-pill"><Clock size={10} /> running</span>}
      </div>
      {task.description && (
        <div className="task-card-desc">{task.description.slice(0, 160)}</div>
      )}
      <div className="task-card-badges">
        {task.assignee && <span className="task-card-badge"><TagIcon size={10} /> @{task.assignee}</span>}
        {task.timeSpent ? <span className="task-card-badge"><Clock size={10} /> {formatDuration(task.timeSpent)}</span> : null}
        {task.dependencies?.length ? <span className="task-card-badge"><Link2 size={10} /> {task.dependencies.length}</span> : null}
        {task.recurring ? <span className="task-card-badge"><Calendar size={10} /> {task.recurring.cron || 'recurring'}</span> : null}
        {task.comments?.length ? <span className="task-card-badge"><MessageSquare size={10} /> {task.comments.length}</span> : null}
        {task.attachments?.length ? <span className="task-card-badge"><Paperclip size={10} /> {task.attachments.length}</span> : null}
      </div>
      {task.tags && task.tags.length > 0 && (
        <div className="task-card-tags">
          {task.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}
      <div className="task-card-footer">
        <span className="task-card-time tabular-nums muted">
          {formatRelative(task.updatedAt || task.createdAt)}
        </span>
        <div className="task-card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Move left"
            title="Move left"
            onClick={() => onMove(-1)}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Edit"
            title="Open detail"
            onClick={onEdit}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Assign me"
            title="Assign to me"
            onClick={onAssignMe}
          >
            <TagIcon size={14} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            aria-label="Delete"
            title="Delete"
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Move right"
            title="Move right"
            onClick={() => onMove(1)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function openTaskModal(
  modal: ReturnType<typeof useModal>,
  toast: ReturnType<typeof useToast>,
  task: Task | null,
  initialStatus: string,
  setTasks: (updater: (cur: Task[]) => Task[]) => void,
  reload: () => Promise<void>,
  refreshSnapshot: () => Promise<void>,
) {
  let titleEl: HTMLInputElement | null = null;
  let descEl: HTMLTextAreaElement | null = null;
  let tagsEl: HTMLInputElement | null = null;
  let priorityEl: HTMLDivElement | null = null;
  let statusEl: HTMLSelectElement | null = null;
  let assigneeEl: HTMLInputElement | null = null;

  const submit = async () => {
    const title = titleEl?.value.trim() || '';
    if (!title) {
      toast.warning('Title is required.');
      titleEl?.focus();
      return;
    }
    const description = descEl?.value.trim() || '';
    const priority =
      (priorityEl?.querySelector<HTMLInputElement>(
        'input[name="task-priority"]:checked',
      )?.value as Priority) || 'normal';
    const tagsRaw = tagsEl?.value.trim() || '';
    const tags = tagsRaw
      ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    const status = statusEl?.value || initialStatus;
    const assignee = (assigneeEl?.value || '').trim() || null;

    try {
      if (task) {
        const updated = await api.put<Task>(`/tasks/${encodeURIComponent(task.id)}`, {
          title,
          description,
          tags,
          priority,
          status,
          assignee,
        });
        setTasks((cur) => cur.map((x) => (x.id === task.id ? updated : x)));
        toast.success('Task updated.', 1500);
      } else {
        const created = await api.post<Task>('/tasks', {
          title,
          description,
          status,
          tags,
          priority,
          assignee,
        });
        setTasks((cur) => [created, ...cur]);
        toast.success('Task created.', 1500);
      }
      modal.close();
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  };

  modal.open({
    title: task ? 'Edit task' : 'New task',
    width: 560,
    children: (
      <div className="task-form">
        <label className="field-label" htmlFor="task-title">Title *</label>
        <input
          ref={(el) => { titleEl = el; }}
          id="task-title"
          className="input"
          type="text"
          maxLength={200}
          placeholder="What needs to be done?"
          defaultValue={task?.title || ''}
          autoFocus
        />
        <label className="field-label" htmlFor="task-desc">Description</label>
        <textarea
          ref={(el) => { descEl = el; }}
          id="task-desc"
          className="textarea"
          rows={3}
          placeholder="Markdown supported…"
          defaultValue={task?.description || ''}
        />
        <div className="task-form-row">
          <div className="task-form-field">
            <label className="field-label" htmlFor="task-status">Status</label>
            <select
              ref={(el) => { statusEl = el; }}
              id="task-status"
              className="select"
              defaultValue={task?.status || initialStatus}
            >
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="task-form-field">
            <label className="field-label">Priority</label>
            <div className="radio-row" ref={(el) => { priorityEl = el; }}>
              {PRIORITIES.map((p) => (
                <label key={p} className="radio-label">
                  <input
                    type="radio"
                    name="task-priority"
                    value={p}
                    defaultChecked={(task?.priority || 'normal') === p}
                  />
                  <span className="capitalize">{p}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <label className="field-label" htmlFor="task-assignee">Assignee (agent or user)</label>
        <input
          ref={(el) => { assigneeEl = el; }}
          id="task-assignee"
          className="input"
          type="text"
          placeholder="odin, thor, me, …"
          defaultValue={task?.assignee || ''}
        />
        <label className="field-label" htmlFor="task-tags">Tags</label>
        <input
          ref={(el) => { tagsEl = el; }}
          id="task-tags"
          className="input"
          type="text"
          placeholder="comma-separated, e.g. bug, frontend"
          defaultValue={(task?.tags || []).join(', ')}
        />
      </div>
    ),
    footer: (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{task ? 'Save' : 'Create'}</Button>
      </div>
    ),
  });
}

function openTaskDetail(
  modal: ReturnType<typeof useModal>,
  toast: ReturnType<typeof useToast>,
  task: Task,
  setTasks: (updater: (cur: Task[]) => Task[]) => void,
  reload: () => Promise<void>,
  refreshSnapshot: () => Promise<void>,
) {
  let commentEl: HTMLTextAreaElement | null = null;
  let depEl: HTMLInputElement | null = null;
  let recurEl: HTMLInputElement | null = null;

  const refresh = async () => {
    try {
      const r = await api.get<Task[]>(`/tasks`);
      const found = r.find((t) => t.id === task.id);
      if (found) {
        setTasks((cur) => cur.map((x) => (x.id === found.id ? found : x)));
      }
    } catch { /* ignore */ }
  };

  const onComment = async () => {
    const text = (commentEl?.value || '').trim();
    if (!text) return;
    try {
      const updated = await api.post<Task>(`/tasks/${encodeURIComponent(task.id)}/comments`, { text });
      setTasks((cur) => cur.map((x) => (x.id === task.id ? updated : x)));
      if (commentEl) commentEl.value = '';
      toast.success('Comment added.', 1200);
    } catch (err) {
      toast.error(`Comment failed: ${(err as Error).message}`);
    }
  };

  const onTimer = async () => {
    try {
      const updated = await api.post<Task>(`/tasks/${encodeURIComponent(task.id)}/timer`);
      setTasks((cur) => cur.map((x) => (x.id === task.id ? updated : x)));
      toast.success('Timer toggled.', 1200);
    } catch (err) {
      toast.error(`Timer failed: ${(err as Error).message}`);
    }
  };

  const onAddDep = async () => {
    const id = (depEl?.value || '').trim();
    if (!id) return;
    const next = [...(task.dependencies || []), id];
    try {
      const updated = await api.put<Task>(`/tasks/${encodeURIComponent(task.id)}`, { dependencies: next });
      setTasks((cur) => cur.map((x) => (x.id === task.id ? updated : x)));
      if (depEl) depEl.value = '';
      toast.success('Dependency added.', 1200);
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  };

  const onSetRecur = async () => {
    const cron = (recurEl?.value || '').trim();
    try {
      const updated = await api.put<Task>(`/tasks/${encodeURIComponent(task.id)}`, {
        recurring: cron ? { cron } : null,
      });
      setTasks((cur) => cur.map((x) => (x.id === task.id ? updated : x)));
      toast.success(cron ? 'Recurring set.' : 'Recurring cleared.', 1200);
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  };

  modal.open({
    title: `Task — ${task.title}`,
    width: 640,
    children: (
      <div className="task-detail">
        <div className="task-detail-meta">
          <span><strong>Status:</strong> {task.status}</span>
          <span><strong>Priority:</strong> {task.priority}</span>
          {task.assignee && <span><strong>Assignee:</strong> @{task.assignee}</span>}
          {task.timeSpent != null && <span><strong>Time:</strong> {formatDuration(task.timeSpent)}</span>}
        </div>
        {task.description && (
          <Card>
            <CardTitle>Description</CardTitle>
            <div className="task-detail-desc">{task.description}</div>
          </Card>
        )}
        <Card>
          <CardTitle><Clock size={14} /> Time tracking</CardTitle>
          <div className="task-detail-row">
            <Button variant="secondary" size="sm" onClick={onTimer}>
              {(task as unknown as { _timerStart?: number })._timerStart ? (
                <><PauseCircle size={12} /> Stop</>
              ) : (
                <><PlayCircle size={12} /> Start</>
              )}
            </Button>
            <span className="muted">
              {task.timeSpent ? formatDuration(task.timeSpent) : 'no time tracked'}
            </span>
          </div>
        </Card>
        <Card>
          <CardTitle><Link2 size={14} /> Dependencies</CardTitle>
          <div className="task-detail-row">
            <input
              ref={(el) => { depEl = el; }}
              className="input"
              type="text"
              placeholder="task id (e.g. tsk_abc12345)"
            />
            <Button variant="secondary" size="sm" onClick={onAddDep}>Add</Button>
          </div>
          <ul>
            {(task.dependencies || []).map((d) => (
              <li key={d}><code>{d}</code></li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle><Calendar size={14} /> Recurring</CardTitle>
          <div className="task-detail-row">
            <input
              ref={(el) => { recurEl = el; }}
              className="input"
              type="text"
              placeholder="cron expression (e.g. 0 9 * * *)"
              defaultValue={task.recurring?.cron || ''}
            />
            <Button variant="secondary" size="sm" onClick={onSetRecur}>Save</Button>
          </div>
          {task.recurring && <div className="muted">Cron: <code>{task.recurring.cron}</code></div>}
        </Card>
        <Card>
          <CardTitle><MessageSquare size={14} /> Comments</CardTitle>
          <textarea
            ref={(el) => { commentEl = el; }}
            className="textarea"
            rows={3}
            placeholder="Add a comment…"
          />
          <Button variant="primary" size="sm" onClick={onComment}>Post</Button>
          <ul className="task-comments">
            {(task.comments || []).map((c) => (
              <li key={c.id}>
                <div className="muted tabular-nums">{formatRelative(c.createdAt)}</div>
                <div>{c.text}</div>
              </li>
            ))}
            {(task.comments || []).length === 0 && <li className="muted">No comments.</li>}
          </ul>
        </Card>
        <Card>
          <CardTitle><Activity size={14} /> Activity</CardTitle>
          <ul className="task-activity">
            {(task.activity || []).slice().reverse().slice(0, 20).map((a) => (
              <li key={a.id}>
                <span className="muted tabular-nums">{formatRelative(a.ts)}</span>{' '}
                <span className="tag">{a.type}</span>
                {a.data && typeof a.data === 'object' ? (
                  <code className="muted"> {JSON.stringify(a.data)}</code>
                ) : null}
              </li>
            ))}
            {(task.activity || []).length === 0 && <li className="muted">No activity yet.</li>}
          </ul>
        </Card>
      </div>
    ),
    footer: (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={() => modal.close()}>Close</Button>
        <Button variant="primary" onClick={() => { modal.close(); openTaskModal(modal, toast, task, task.status, setTasks, reload, refreshSnapshot); }}>
          <Pencil size={12} /> Edit basics
        </Button>
      </div>
    ),
  });
}
