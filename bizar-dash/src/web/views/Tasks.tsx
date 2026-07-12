// src/views/Tasks.tsx
//
// v4.6.0 — Simplified task board.
//
// Design goals (per Odin):
//   - Create flow = title + description (+ optional priority hint + tags).
//     No agent picker. Odin decides what to do with the task and which
//     agent picks it up; the UI just records intent.
//   - Tasks grouped by status into 5 columns:
//       Todo      (api: queued)
//       In progress (api: doing)
//       Done      (api: done)
//       Failed    (api: blocked)
//       Backlog   (api: backlog, parked ideas)
//   - Each task row shows title, status, priority, createdAt, and the
//     agent that auto-claimed it (read-only — set by the orchestrator).
//   - Per-task actions: edit, delete, retry, change status.
//   - Backlog view: parked ideas; one-click "promote to Todo".
//
// We keep the API contract (statuses: queued/doing/done/blocked/backlog)
// so the dashboard doesn't break the existing server, tasks store, and
// tests. The UI maps API statuses to friendlier labels.
import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Search,
  X as XIcon,
  Clock,
  Tag as TagIcon,
  ArchiveRestore,
  RefreshCw,
  Send,
  Inbox,
  Sparkles,
  Edit2,
  RotateCw,
  Bot,
  Target,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { Tag } from '../components/Tag';
import { useModal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { api, enhancePrompt } from '../lib/api';
import { cn, formatRelative, priorityColors } from '../lib/utils';
import type { Goal, Settings, Snapshot, Task } from '../lib/types';
import { BacklogPanel } from '../components/tasks/BacklogPanel';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type StatusKind = 'info' | 'accent' | 'success' | 'warning' | 'error';

/**
 * UI <-> API status mapping. We keep the existing API enum
 * (queued | doing | done | blocked | archived | backlog) and only
 * rename the labels here so the dashboard, server, and tests stay in
 * sync. Switch back if you need to expose the raw API value.
 */
const COLUMNS: { id: Task['status']; label: string; kind: StatusKind }[] = [
  { id: 'queued',  label: 'Todo',        kind: 'info' },
  { id: 'doing',   label: 'In progress', kind: 'accent' },
  { id: 'done',    label: 'Done',        kind: 'success' },
  { id: 'blocked', label: 'Failed',      kind: 'error' },
];

const PRIORITIES = ['low', 'normal', 'high'] as const;
type Priority = (typeof PRIORITIES)[number];

function TasksInner({ snapshot, refreshSnapshot, setActiveTab }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [tasks, setTasks] = useState<Task[]>(snapshot.tasks || []);
  const [loading, setLoading] = useState(!snapshot.tasks);
  const [filter, setFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [showBacklog, setShowBacklog] = useState(false);
  const [tick, setTick] = useState(0); // for live timer re-render
  const [statusAnnouncement, setStatusAnnouncement] = useState('');
  // v6.6.0 — F-041. Load the project's goals so each task card can
  // surface a clickable "Goal: <title>" badge that jumps to the
  // Goals view. Recomputes when the project switches or the snapshot
  // updates.
  const activeProjectId = snapshot.activeProject?.id || '';
  const [goalsById, setGoalsById] = useState<Record<string, Goal>>({});

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
    if (snapshot.tasks) {
      setTasks(snapshot.tasks);
      setLoading(false);
    }
  }, [snapshot.tasks]);

  // v6.6.0 — F-041. Fetch goals for the active project so task cards
  // can show a "Goal" badge. Re-runs whenever the active project
  // changes. Empty / no-project just clears the map; the badge won't
  // render in those cases anyway because no task will have a goalId.
  useEffect(() => {
    let cancelled = false;
    if (!activeProjectId) {
      setGoalsById({});
      return;
    }
    api
      .get<{ goals: Goal[] }>(`/goals?projectId=${encodeURIComponent(activeProjectId)}`)
      .then((r) => {
        if (cancelled) return;
        const m: Record<string, Goal> = {};
        for (const g of r.goals || []) m[g.id] = g;
        setGoalsById(m);
      })
      .catch(() => {
        if (!cancelled) setGoalsById({});
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  // Periodic tick keeps relative-time labels fresh without a full reload.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    let out = tasks.filter((t) => t.status !== 'backlog');
    if (priorityFilter) {
      out = out.filter((t) => (t.priority || 'normal') === priorityFilter);
    }
    if (filter.trim()) {
      const q = filter.toLowerCase();
      out = out.filter((t) =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q),
      );
    }
    return out;
  }, [tasks, filter, priorityFilter]);

  const sorted = useMemo(() => {
    const priorityWeight = { high: 0, normal: 1, low: 2 } as Record<string, number>;
    return [...filtered].sort((a, b) => {
      const pa = priorityWeight[a.priority] ?? 1;
      const pb = priorityWeight[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [filtered]);

  const backlogCount = tasks.filter((t) => t.status === 'backlog').length;

  // ─── Actions ─────────────────────────────────────────────────────────────

  const moveTask = async (taskId: string, newStatus: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const prev = t.status;
    setTasks((cur) =>
      cur.map((x) => (x.id === taskId ? { ...x, status: newStatus } : x)),
    );
    setStatusAnnouncement(`Task ${t.title} moved to ${newStatus}.`);
    try {
      await api.patch(`/tasks/${encodeURIComponent(taskId)}/status`, {
        status: newStatus,
      });
      toast.success(`Moved to ${newStatus}.`, 1200);
    } catch (err) {
      setTasks((cur) =>
        cur.map((x) => (x.id === taskId ? { ...x, status: prev } : x)),
      );
      setStatusAnnouncement(`Failed to move task ${t.title}: ${(err as Error).message}`);
      toast.error(`Move failed: ${(err as Error).message}`);
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm('Delete this task?')) return;
    try {
      await api.del(`/tasks/${encodeURIComponent(taskId)}`);
      setTasks((cur) => cur.filter((t) => t.id !== taskId));
      toast.success('Task deleted.', 1200);
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const retryTask = async (taskId: string) => {
    try {
      // Re-dispatch via the existing /tasks/:id/start endpoint. The
      // server returns 202 on accept; failures surface as 502/404.
      const r = await api.post<{ ok: boolean; task: Task }>(
        `/tasks/${encodeURIComponent(taskId)}/start`,
      );
      if (r && r.task) {
        setTasks((cur) => cur.map((t) => (t.id === taskId ? r.task : t)));
      }
      toast.success('Retry dispatched.', 1200);
    } catch (err) {
      toast.error(`Retry failed: ${(err as Error).message}`);
    }
  };

  const submitToOdin = async (taskId: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    try {
      // The /tasks/submit endpoint takes a title + description and
      // hands the bundle to Odin for delegation. We re-use the task's
      // existing fields.
      const r = await api.post<{ main: Task; subtasks: Task[] }>('/tasks/submit', {
        title: t.title,
        description: t.description,
        priority: t.priority,
        tags: t.tags,
      });
      const count = (r.subtasks || []).length;
      toast.success(
        count > 1
          ? `Odin split it into ${count} subtasks.`
          : 'Sent to Odin.',
        1500,
      );
      if (r.subtasks && r.subtasks.length > 0) {
        setTasks((cur) => [r.main, ...r.subtasks, ...cur.filter((x) => x.id !== t.id)]);
      }
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Submit failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="view view-tasks">
      {/* Hidden live region for screen-reader announcements of status changes. */}
      <div className="sr-only" role="status" aria-live="polite">
        {statusAnnouncement}
      </div>
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <CheckSquare size={18} /> Tasks ({sorted.length})
          </h2>
          <p className="view-subtitle">
            Add a task — title and description is all you need. Odin picks the agent and priority.
          </p>
        </div>
      </header>

      {/* Toolbar: search, filter, sort, actions */}
      <div className="tasks-toolbar">
        <div className="tasks-toolbar-group">
          <div className="search-input" style={{ width: 200 }}>
            <Search size={12} aria-hidden />
            <input
              className="input"
              type="text"
              placeholder="Search…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Search tasks"
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
        </div>

        <div className="tasks-toolbar-divider" />

        <div className="tasks-toolbar-group">
          <label className="tasks-toolbar-label" htmlFor="tasks-priority-filter">Priority</label>
          <select
            id="tasks-priority-filter"
            className="select select-sm"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            title="Filter by priority"
          >
            <option value="">All</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className="tasks-toolbar-spacer" />

        <div className="tasks-toolbar-group">
          <Button variant="ghost" size="sm" onClick={reload} title="Refresh" aria-label="Refresh tasks">
            <RefreshCw size={14} />
          </Button>
          {backlogCount > 0 && (
            <Button
              variant={showBacklog ? 'accent' : 'ghost'}
              size="sm"
              onClick={() => setShowBacklog((v) => !v)}
              title={showBacklog ? 'Hide backlog' : 'Show backlog'}
            >
              <Inbox size={14} />
              Backlog
              <span className="badge">{backlogCount}</span>
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => openCreateTaskModal(modal, toast, setTasks, reload, refreshSnapshot)}
          >
            <Plus size={14} /> New task
          </Button>
        </div>
      </div>

      {showBacklog && backlogCount > 0 && (
        <BacklogPanel
          agents={snapshot.agents || []}
          onRefresh={refreshSnapshot}
        />
      )}

      {loading ? (
        <div className="view-loading"><Spinner size="lg" /></div>
      ) : (
        <div className="kanban">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              tasks={sorted.filter((t) => t.status === col.id)}
              onMove={moveTask}
              onDelete={deleteTask}
              onRetry={retryTask}
              onEdit={(t) => openEditTaskModal(modal, toast, t, setTasks, reload, refreshSnapshot)}
              onSubmitToOdin={submitToOdin}
              tick={tick}
              goalsById={goalsById}
              onOpenGoal={() => setActiveTab('goals')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Column ────────────────────────────────────────────────────────────────

function KanbanColumn({
  column,
  tasks,
  onMove,
  onDelete,
  onRetry,
  onEdit,
  onSubmitToOdin,
  tick,
  goalsById,
  onOpenGoal,
}: {
  column: { id: string; label: string; kind: StatusKind };
  tasks: Task[];
  onMove: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onEdit: (t: Task) => void;
  onSubmitToOdin: (id: string) => void;
  tick: number;
  goalsById: Record<string, Goal>;
  onOpenGoal: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={cn('kanban-column', dragOver && 'kanban-column-drop')}
      data-column={column.id}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
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
          <span className={cn('status-dot', `status-${column.kind}`)} />
          {column.label}
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
              onMove={(dir) => {
                const idx = COLUMNS.findIndex((c) => c.id === t.status);
                const next = idx + dir;
                if (next >= 0 && next < COLUMNS.length) onMove(t.id, COLUMNS[next].id);
              }}
              onEdit={() => onEdit(t)}
              onDelete={() => onDelete(t.id)}
              onRetry={() => onRetry(t.id)}
              onSubmitToOdin={() => onSubmitToOdin(t.id)}
              tick={tick}
              goal={t.goalId ? goalsById[t.goalId] || null : null}
              onOpenGoal={onOpenGoal}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onMove,
  onEdit,
  onDelete,
  onRetry,
  onSubmitToOdin,
  tick,
  goal,
  onOpenGoal,
}: {
  task: Task;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onSubmitToOdin: () => void;
  tick: number;
  goal: Goal | null;
  onOpenGoal: () => void;
}) {
  const assignedAgent = task.workedBy || task.assignee || null;
  return (
    <div
      className={cn('task-card', `priority-${task.priority}`)}
      data-task-id={task.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      data-tick={tick}
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
      <div className="task-card-badges">
        {assignedAgent && (
          <span className="task-card-badge" title={`Auto-assigned to @${assignedAgent}`}>
            <Bot size={10} /> @{assignedAgent}
          </span>
        )}
        {task.timeSpent ? (
          <span className="task-card-badge">
            <Clock size={10} /> {Math.round((task.timeSpent || 0) / 60)}m
          </span>
        ) : null}
        {task.tags && task.tags.length > 0 && task.tags.slice(0, 3).map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
        {/* v6.0.0 — Cline agent team indicator. */}
        {(task.tags || []).some((t) => t.startsWith('team:')) && (
          <span className="task-card-badge team" title="Cline agent team">
            <Sparkles size={10} /> team
          </span>
        )}
        {/* v6.6.0 — F-041 Goal badge. Renders when this task is
            linked to a Goal; click jumps to the Goals view so the
            user can see the rollup. Hidden when the linked goal
            isn't in our lookup map (stale link, deleted goal). */}
        {goal && (
          <button
            type="button"
            className="task-card-badge task-card-goal-badge"
            data-testid="task-goal-badge"
            data-goal-id={goal.id}
            title={`Linked to goal: ${goal.title} — click to open`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenGoal();
            }}
          >
            <Target size={10} /> {goal.title}
          </button>
        )}
      </div>
      <div className="task-card-footer">
        <span className="task-card-time tabular-nums muted">
          {formatRelative(task.createdAt)}
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
            title="Edit"
            onClick={onEdit}
          >
            <Edit2 size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Submit to Odin"
            title="Re-delegate to Odin"
            onClick={onSubmitToOdin}
          >
            <Send size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Retry"
            title="Retry"
            onClick={onRetry}
          >
            <RotateCw size={14} />
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

// ─── Create / Edit modal ───────────────────────────────────────────────────
//
// Simplified: title, description, priority hint, optional tags. NO
// agent dropdown. The store will default `assignee` and `workedBy` to
// null; the orchestrator sets them when it picks the task up.

function openCreateTaskModal(
  modal: ReturnType<typeof useModal>,
  toast: ReturnType<typeof useToast>,
  setTasks: (updater: (cur: Task[]) => Task[]) => void,
  reload: () => Promise<void>,
  refreshSnapshot: () => Promise<void>,
) {
  let titleEl: HTMLInputElement | null = null;
  let descEl: HTMLTextAreaElement | null = null;
  let tagsEl: HTMLInputElement | null = null;
  let priorityEl: HTMLSelectElement | null = null;

  const submit = async (e?: React.SyntheticEvent) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const title = (titleEl?.value || '').trim();
    const description = (descEl?.value || '').trim();
    if (!title) {
      toast.warning('Title is required.');
      titleEl?.focus();
      return;
    }
    const priority = (priorityEl?.value || 'normal') as Priority;
    const tags = (tagsEl?.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const created = await api.post<Task>('/tasks', {
        title,
        description,
        priority,
        tags,
        // No assignee / agent — Odin decides.
      });
      modal.close();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new MouseEvent('mousedown'));
      }
      setTasks((cur) => [created, ...cur]);
      toast.success('Task created.', 1200);
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Create failed: ${(err as Error).message}`);
    }
  };

  const onTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(e);
    }
  };

  modal.open({
    title: 'New task',
    width: 520,
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
          autoFocus
          onKeyDown={onTitleKeyDown}
        />
        <label className="field-label" htmlFor="task-desc">Description</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <textarea
            ref={(el) => { descEl = el; }}
            id="task-desc"
            className="textarea"
            rows={4}
            placeholder="Add any context Odin might need (markdown ok)…"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            title="Enhance with AI"
            onClick={async () => {
              if (!descEl?.value?.trim()) return;
              const enhanced = await enhancePrompt(descEl.value);
              if (enhanced !== descEl.value) descEl.value = enhanced;
            }}
          >
            ✨
          </button>
        </div>
        <div className="task-form-row">
          <label htmlFor="task-priority" className="task-form-field">
            Priority hint
            <select
              ref={(el) => { priorityEl = el; }}
              id="task-priority"
              className="select"
              defaultValue="normal"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label htmlFor="task-tags" className="task-form-field" style={{ flex: 2 }}>
            Tags <span className="field-hint">(comma-separated)</span>
            <input
              ref={(el) => { tagsEl = el; }}
              id="task-tags"
              className="input"
              type="text"
              placeholder="bug, frontend, urgent"
            />
          </label>
        </div>
        <p className="muted text-sm" style={{ marginTop: 8 }}>
          The agent and final priority are decided by Odin after you submit.
        </p>
      </div>
    ),
    footer: (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
        <Button variant="primary" type="button" onClick={(e) => submit(e)}>
          <Plus size={14} /> Create task
        </Button>
      </div>
    ),
  });
}

function openEditTaskModal(
  modal: ReturnType<typeof useModal>,
  toast: ReturnType<typeof useToast>,
  task: Task,
  setTasks: (updater: (cur: Task[]) => Task[]) => void,
  reload: () => Promise<void>,
  refreshSnapshot: () => Promise<void>,
) {
  let titleEl: HTMLInputElement | null = null;
  let descEl: HTMLTextAreaElement | null = null;
  let tagsEl: HTMLInputElement | null = null;
  let priorityEl: HTMLSelectElement | null = null;

  const submit = async () => {
    const title = (titleEl?.value || '').trim();
    const description = (descEl?.value || '').trim();
    if (!title) {
      toast.warning('Title is required.');
      titleEl?.focus();
      return;
    }
    const priority = (priorityEl?.value || 'normal') as Priority;
    const tags = (tagsEl?.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const updated = await api.put<Task>(`/tasks/${encodeURIComponent(task.id)}`, {
        title,
        description,
        priority,
        tags,
      });
      modal.close();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new MouseEvent('mousedown'));
      }
      setTasks((cur) => cur.map((x) => (x.id === task.id ? updated : x)));
      toast.success('Task updated.', 1200);
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  };

  modal.open({
    title: 'Edit task',
    width: 520,
    children: (
      <div className="task-form">
        <label className="field-label" htmlFor="edit-task-title">Title *</label>
        <input
          ref={(el) => { titleEl = el; }}
          id="edit-task-title"
          className="input"
          type="text"
          maxLength={200}
          defaultValue={task.title}
          autoFocus
        />
        <label className="field-label" htmlFor="edit-task-desc">Description</label>
        <textarea
          ref={(el) => { descEl = el; }}
          id="edit-task-desc"
          className="textarea"
          rows={4}
          defaultValue={task.description || ''}
        />
        <div className="task-form-row">
          <label htmlFor="edit-task-priority" className="task-form-field">
            Priority hint
            <select
              ref={(el) => { priorityEl = el; }}
              id="edit-task-priority"
              className="select"
              defaultValue={task.priority || 'normal'}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label htmlFor="edit-task-tags" className="task-form-field" style={{ flex: 2 }}>
            Tags
            <input
              ref={(el) => { tagsEl = el; }}
              id="edit-task-tags"
              className="input"
              type="text"
              defaultValue={(task.tags || []).join(', ')}
              placeholder="comma-separated"
            />
          </label>
        </div>
        <Card>
          <CardTitle><TagIcon size={12} /> Status</CardTitle>
          <CardMeta>
            Current: <strong>{task.status}</strong>
            {task.workedBy && <> · Worked by @{task.workedBy}</>}
            {task.assignee && !task.workedBy && <> · Assigned @{task.assignee}</>}
          </CardMeta>
        </Card>
      </div>
    ),
    footer: (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          <ArchiveRestore size={14} /> Save
        </Button>
      </div>
    ),
  });
}
export const Tasks = React.memo(TasksInner);
