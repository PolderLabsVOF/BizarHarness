/*
 * Tasks.tsx — Wave 3 redesigned kanban board (Supabase-style simplicity).
 *
 * The view groups tasks into 5 columns by API status (queued | doing | done
 * | blocked | backlog) and renders each column as a `Panel` from the new
 * design system. Task rows are compact (~76px) cards with a left-edge
 * priority accent (3px) derived from the priority token. The redesign
 * intentionally uses only design-system primitives (Panel, Grid, Stack,
 * Inline, Badge, StatusDot, Button, IconButton, SearchInput, Select,
 * EmptyState, LoadingState) — no legacy `.task-card` / `.kanban-column`
 * classes from main.css.
 *
 * Hard constraints preserved from the previous implementation:
 *   - Same export name (`Tasks`) and same `Props` shape so App.tsx keeps
 *     importing without changes.
 *   - Same API contracts (`api.get('/tasks')`, `api.patch(.../status)`, etc).
 *   - Same WS subscriptions (`tasks:change`, `tasks:delete`).
 *   - Same COLUMNS array — the API status enum is the public contract.
 *   - BacklogPanel is still imported from `components/tasks/BacklogPanel`
 *     and receives the same props (out-of-scope for this redesign).
 *   - Legacy `Modal` is reused for the create/edit dialogs (out-of-scope).
 *   - 30s tick for relative-time labels.
 *
 * What changed:
 *   - Columns are now `Panel`s with a StatusDot + count in the header.
 *   - Task rows render with `Badge` for status/priority/agent and
 *     `IconButton` for actions (edit, submit-to-odin, retry, delete).
 *   - The whole task row is clickable (delegates to the edit modal) —
 *     action buttons stop propagation so they keep their dedicated path.
 *   - Toolbar uses `SearchInput` + `Select` (priority) instead of raw
 *     inputs.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Plus,
  Trash2,
  RefreshCw,
  Tag as TagIcon,
  ArchiveRestore,
  RotateCw,
  Send,
  Inbox,
  Edit2,
  Bot,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { useModal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { api, enhancePrompt } from '../lib/api';
import { formatRelative } from '../lib/utils';
import type { Settings, Snapshot, Task } from '../lib/types';
import { BacklogPanel } from '../components/tasks/BacklogPanel';
import {
  Badge,
  cx,
  Grid,
  IconButton,
  Inline,
  LoadingState,
  Panel,
  SearchInput,
  Select,
  Stack,
  StatusDot,
  type BadgeVariant,
} from '../ui';

import '../styles/tasks-redesign.css';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type StatusKind = 'info' | 'accent' | 'success' | 'warning' | 'error';
type PriorityKind = 'low' | 'normal' | 'high';

/**
 * UI <-> API status mapping. We keep the existing API enum
 * (queued | doing | done | blocked | archived | backlog) and only
 * rename the labels here so the dashboard, server, and tests stay in
 * sync. Switch back if you need to expose the raw API value.
 */
const COLUMNS: {
  id: Task['status'];
  label: string;
  kind: StatusKind;
  dotVariant: 'info' | 'success' | 'warning' | 'danger';
}[] = [
  { id: 'queued',  label: 'Todo',        kind: 'info',    dotVariant: 'info' },
  { id: 'doing',   label: 'In progress', kind: 'accent',  dotVariant: 'info' },
  { id: 'done',    label: 'Done',        kind: 'success', dotVariant: 'success' },
  { id: 'blocked', label: 'Failed',      kind: 'error',   dotVariant: 'danger' },
];

const PRIORITIES: readonly PriorityKind[] = ['low', 'normal', 'high'];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All' },
  ...PRIORITIES.map((p) => ({ value: p, label: p })),
];

const STATUS_BADGE: Record<StatusKind, BadgeVariant> = {
  info: 'info',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  error: 'danger',
};

const PRIORITY_BADGE: Record<PriorityKind, BadgeVariant> = {
  high: 'danger',
  normal: 'info',
  low: 'neutral',
};

const PRIORITY_ROW_CLASS: Record<PriorityKind, string> = {
  high: 'tasks-wave3__row--priority-high',
  normal: 'tasks-wave3__row--priority-normal',
  low: 'tasks-wave3__row--priority-low',
};

function TasksInner({
  snapshot,
  refreshSnapshot,
}: Props) {
  const toast = useToast();
  const modal = useModal();
  const [tasks, setTasks] = useState<Task[]>(snapshot.tasks || []);
  const [loading, setLoading] = useState(!snapshot.tasks);
  const [filter, setFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [showBacklog, setShowBacklog] = useState(false);
  const [tick, setTick] = useState(0); // for live timer re-render
  const [statusAnnouncement, setStatusAnnouncement] = useState('');

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

  const handleTaskClick = (task: Task) => {
    openEditTaskModal(modal, toast, task, setTasks, reload, refreshSnapshot);
  };

  return (
    <div className="view view-tasks tasks-wave3">
      {/* Hidden live region for screen-reader announcements of status changes. */}
      <div className="sr-only" role="status" aria-live="polite">
        {statusAnnouncement}
      </div>
      <header className="tasks-wave3__header">
        <div>
          <h2 className="tasks-wave3__title-row">
            <CheckSquare size={18} aria-hidden /> Tasks ({sorted.length})
          </h2>
          <p className="tasks-wave3__subtitle">
            Add a task — title and description is all you need. Odin picks the agent and priority.
          </p>
        </div>
      </header>

      {/* Toolbar: search, priority filter, refresh, backlog toggle, new task */}
      <div className="tasks-wave3__toolbar" role="toolbar" aria-label="Task filters">
        <div className="tasks-wave3__toolbar-group">
          <SearchInput
            inputSize="sm"
            value={filter}
            onChange={((v: unknown) => setFilter(String(v))) as unknown as React.ComponentProps<typeof SearchInput>['onChange']}
            placeholder="Search…"
            aria-label="Search tasks"
          />
        </div>

        <div className="tasks-wave3__toolbar-group">
          <span className="tasks-wave3__toolbar-label" id="tasks-priority-filter-label">
            Priority
          </span>
          <Select
            inputSize="sm"
            aria-labelledby="tasks-priority-filter-label"
            options={PRIORITY_OPTIONS}
            value={priorityFilter}
            onChange={(e) => setPriorityFilter((e.target as HTMLSelectElement).value)}
          />
        </div>

        <div className="tasks-wave3__toolbar-spacer" />

        <div className="tasks-wave3__toolbar-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={reload}
            title="Refresh"
            aria-label="Refresh tasks"
          >
            <RefreshCw size={14} aria-hidden />
          </Button>
          {backlogCount > 0 && (
            <Button
              variant={showBacklog ? 'accent' : 'ghost'}
              size="sm"
              onClick={() => setShowBacklog((v) => !v)}
              title={showBacklog ? 'Hide backlog' : 'Show backlog'}
            >
              <Inbox size={14} aria-hidden />
              Backlog
              <span className="tasks-wave3__column-count" aria-label={`${backlogCount} items`}>
                {backlogCount}
              </span>
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => openCreateTaskModal(modal, toast, setTasks, reload, refreshSnapshot)}
          >
            <Plus size={14} aria-hidden /> New task
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
        <LoadingState label="Loading tasks…" />
      ) : (
        <Grid cols={5} gap={3} className="tasks-wave3__kanban">
          {COLUMNS.map((col) => {
            const columnTasks = sorted.filter((t) => t.status === col.id);
            return (
              <Panel
                key={col.id}
                padding={3}
                className="tasks-wave3__column"
                title={
                  <span className="tasks-wave3__column-title">
                    <StatusDot variant={col.dotVariant} size="sm" label={col.label} />
                    {col.label}
                  </span>
                }
                actions={
                  <span
                    className="tasks-wave3__column-count"
                    aria-label={`${columnTasks.length} tasks`}
                  >
                    {columnTasks.length}
                  </span>
                }
              >
                <Stack gap={2} className="tasks-wave3__column-body">
                  {columnTasks.length === 0 ? (
                    <div className="tasks-wave3__column-empty">No tasks</div>
                  ) : (
                    columnTasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        column={col}
                        onTaskClick={handleTaskClick}
                        onEdit={() => openEditTaskModal(modal, toast, t, setTasks, reload, refreshSnapshot)}
                        onDelete={() => deleteTask(t.id)}
                        onRetry={() => retryTask(t.id)}
                        onSubmitToOdin={() => submitToOdin(t.id)}
                        tick={tick}
                      />
                    ))
                  )}
                </Stack>
              </Panel>
            );
          })}
        </Grid>
      )}
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────

type RowProps = {
  task: Task;
  column: (typeof COLUMNS)[number];
  onTaskClick: (task: Task) => void;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onSubmitToOdin: () => void;
  tick: number;
};

function TaskRow({
  task,
  column,
  onTaskClick,
  onEdit,
  onDelete,
  onRetry,
  onSubmitToOdin,
  tick,
}: RowProps) {
  const assignedAgent = task.workedBy || task.assignee || null;
  const priority: PriorityKind = (PRIORITIES as readonly string[]).includes(task.priority as string)
    ? (task.priority as PriorityKind)
    : 'normal';
  return (
    <div
      className={cx('tasks-wave3__row', PRIORITY_ROW_CLASS[priority])}
      data-task-id={task.id}
      data-tick={tick}
      role="button"
      tabIndex={0}
      onClick={() => onTaskClick(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTaskClick(task);
        }
      }}
    >
      <div className="tasks-wave3__row-title-row">
        <div className="tasks-wave3__row-title" title={task.title}>
          {task.title}
        </div>
        <Badge variant={STATUS_BADGE[column.kind]} size="sm" aria-label={`Status ${column.label}`}>
          {column.label}
        </Badge>
      </div>

      <Inline gap={1} align="center" className="tasks-wave3__row-badges">
        <Badge variant={PRIORITY_BADGE[priority]} size="sm">
          {priority}
        </Badge>
        {assignedAgent && (
          <Badge variant="neutral" size="sm">
            <Bot size={10} aria-hidden /> @{assignedAgent}
          </Badge>
        )}
        {(task.tags || []).slice(0, 2).map((tag) => (
          <Badge key={tag} variant="neutral" size="sm">
            #{tag}
          </Badge>
        ))}
      </Inline>

      <div className="tasks-wave3__row-footer">
        <span className="tasks-wave3__row-time">{formatRelative(task.createdAt)}</span>
        <Inline
          gap={1}
          align="center"
          className="tasks-wave3__row-actions"
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Edit2 size={12} aria-hidden />}
            aria-label="Edit task"
            title="Edit"
            onClick={onEdit}
          />
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Send size={12} aria-hidden />}
            aria-label="Submit to Odin"
            title="Re-delegate to Odin"
            onClick={onSubmitToOdin}
          />
          <IconButton
            variant="ghost"
            size="sm"
            icon={<RotateCw size={12} aria-hidden />}
            aria-label="Retry task"
            title="Retry"
            onClick={onRetry}
          />
          <IconButton
            variant="danger"
            size="sm"
            icon={<Trash2 size={12} aria-hidden />}
            aria-label="Delete task"
            title="Delete"
            onClick={onDelete}
          />
        </Inline>
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
    const priority = (priorityEl?.value || 'normal') as PriorityKind;
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
      // Synthetic mousedown is intentional: it signals any open outside-
      // click listeners (e.g. WorkspaceSelector, Notifications popover)
      // that another surface has just stolen focus, so they collapse
      // before the toast overlays the layout. The event carries no
      // coordinates by design — those listeners only check the dispatch.
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
    const priority = (priorityEl?.value || 'normal') as PriorityKind;
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
      // Synthetic mousedown is intentional: it signals any open outside-
      // click listeners (e.g. WorkspaceSelector, Notifications popover)
      // that another surface has just stolen focus, so they collapse
      // before the toast overlays the layout. The event carries no
      // coordinates by design — those listeners only check the dispatch.
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
