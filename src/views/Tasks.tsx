// src/views/Tasks.tsx — Personal Task Kanban Board.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  Plus,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Search,
  X as XIcon,
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

export function Tasks({ snapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [tasks, setTasks] = useState<Task[]>(snapshot.tasks || []);
  const [loading, setLoading] = useState(!snapshot.tasks);
  const [filter, setFilter] = useState('');
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
    if (!filter.trim()) return tasks;
    const q = filter.toLowerCase();
    return tasks.filter((t) => {
      const title = (t.title || '').toLowerCase();
      const desc = (t.description || '').toLowerCase();
      const tags = (t.tags || []).join(' ').toLowerCase();
      return title.includes(q) || desc.includes(q) || tags.includes(q);
    });
  }, [tasks, filter]);

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
      // Revert
      setTasks((cur) =>
        cur.map((x) => (x.id === taskId ? { ...x, status: prev } : x)),
      );
      toast.error(`Move failed: ${(err as Error).message}`);
    }
  };

  const deleteTask = async (taskId: string) => {
    if (
      // eslint-disable-next-line no-alert
      !confirm('Delete this task?')
    )
      return;
    try {
      await api.del(`/tasks/${encodeURIComponent(taskId)}`);
      setTasks((cur) => cur.filter((t) => t.id !== taskId));
      toast.success('Task deleted.', 1500);
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (
        t === 'input' ||
        t === 'textarea' ||
        (e.target as HTMLElement)?.isContentEditable ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (e.key === 'n') {
        e.preventDefault();
        openTaskModal(modal, toast, null, 'queued', reload);
      } else if (e.key === '1') {
        document
          .querySelector('[data-column="queued"]')
          ?.scrollIntoView({ behavior: 'smooth' });
      } else if (e.key === '2') {
        document
          .querySelector('[data-column="doing"]')
          ?.scrollIntoView({ behavior: 'smooth' });
      } else if (e.key === '3') {
        document
          .querySelector('[data-column="done"]')
          ?.scrollIntoView({ behavior: 'smooth' });
      } else if (e.key === 'e' && focusedId) {
        const task = tasks.find((x) => x.id === focusedId);
        if (task) openTaskModal(modal, toast, task, task.status, reload);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && focusedId) {
        e.preventDefault();
        deleteTask(focusedId);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, tasks]);

  return (
    <div className="view view-tasks">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <CheckSquare size={18} /> Tasks
          </h2>
          <p className="view-subtitle">
            Personal kanban. Press <kbd>n</kbd> for new, <kbd>1-3</kbd> to jump columns, <kbd>e</kbd> edit, <kbd>Del</kbd> delete.
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
          <Button
            variant="primary"
            size="sm"
            onClick={() => openTaskModal(modal, toast, null, 'queued', reload)}
          >
            <Plus size={14} /> Add task
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="view-loading">
          <Spinner size="lg" />
        </div>
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
              onEdit={(t) => openTaskModal(modal, toast, t, t.status, reload)}
              onAdd={() => openTaskModal(modal, toast, null, col.id, reload)}
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
}: {
  column: Column;
  tasks: Task[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  onMove: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: Task) => void;
  onAdd: () => void;
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
              onFocus={() =>
                onFocus(focusedId === t.id ? null : t.id)
              }
              onMove={(dir) => {
                const idx = COLUMNS.findIndex((c) => c.id === t.status);
                const next = idx + dir;
                if (next >= 0 && next < COLUMNS.length)
                  onMove(t.id, COLUMNS[next].id);
              }}
              onEdit={() => onEdit(t)}
              onDelete={() => onDelete(t.id)}
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
}: {
  task: Task;
  focused: boolean;
  onFocus: () => void;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        'task-card',
        `priority-${task.priority}`,
        focused && 'task-card-focused',
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
      </div>
      {task.description && (
        <div className="task-card-desc">{task.description.slice(0, 160)}</div>
      )}
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
            title="Edit (e)"
            onClick={onEdit}
          >
            <Pencil size={14} />
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

function openTaskModal(
  modal: ReturnType<typeof useModal>,
  toast: ReturnType<typeof useToast>,
  task: Task | null,
  initialStatus: string,
  reload: () => Promise<void>,
) {
  let titleEl: HTMLInputElement | null = null;
  let descEl: HTMLTextAreaElement | null = null;
  let tagsEl: HTMLInputElement | null = null;
  let priorityEl: HTMLDivElement | null = null;
  let statusEl: HTMLSelectElement | null = null;

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

    try {
      if (task) {
        await api.put(`/tasks/${encodeURIComponent(task.id)}`, {
          title,
          description,
          tags,
          priority,
          status,
        });
        toast.success('Task updated.', 1500);
      } else {
        await api.post('/tasks', {
          title,
          description,
          status,
          tags,
          priority,
        });
        toast.success('Task created.', 1500);
      }
      modal.close();
      await reload();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  };

  modal.open({
    title: task ? 'Edit task' : 'New task',
    width: 520,
    children: (
      <div className="task-form">
        <label className="field-label" htmlFor="task-title">
          Title *
        </label>
        <input
          ref={(el) => {
            titleEl = el;
          }}
          id="task-title"
          className="input"
          type="text"
          maxLength={200}
          placeholder="What needs to be done?"
          defaultValue={task?.title || ''}
          autoFocus
        />

        <label className="field-label" htmlFor="task-desc">
          Description
        </label>
        <textarea
          ref={(el) => {
            descEl = el;
          }}
          id="task-desc"
          className="textarea"
          rows={3}
          placeholder="Markdown supported…"
          defaultValue={task?.description || ''}
        />

        <div className="task-form-row">
          <div className="task-form-field">
            <label className="field-label" htmlFor="task-status">
              Status
            </label>
            <select
              ref={(el) => {
                statusEl = el;
              }}
              id="task-status"
              className="select"
              defaultValue={task?.status || initialStatus}
            >
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="task-form-field">
            <label className="field-label">Priority</label>
            <div
              className="radio-row"
              ref={(el) => {
                priorityEl = el;
              }}
            >
              {PRIORITIES.map((p) => (
                <label key={p} className="radio-label">
                  <input
                    type="radio"
                    name="task-priority"
                    value={p}
                    defaultChecked={
                      (task?.priority || 'normal') === p
                    }
                  />
                  <span className="capitalize">{p}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <label className="field-label" htmlFor="task-tags">
          Tags
        </label>
        <input
          ref={(el) => {
            tagsEl = el;
          }}
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
        <Button variant="ghost" onClick={() => modal.close()}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit}>
          {task ? 'Save' : 'Create'}
        </Button>
      </div>
    ),
  });
}
