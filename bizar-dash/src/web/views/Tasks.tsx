// src/views/Tasks.tsx — v3.1.0 task board: archive, filters, sort, bulk, recurring, timers, comments, real-time.
import { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Plus,
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
  Archive,
  ArchiveRestore,
  Filter,
  ArrowUpDown,
  Square,
  CheckSquare as CheckSquareIcon,
  Bot,
  RotateCw,
  AlertOctagon,
  Sparkles,
  RefreshCw,
  Send,
  FileText,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
import { Tag } from '../components/Tag';
import { useModal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { BgStatusBadge } from '../components/BgStatusBadge';
import { openKillConfirmDialog } from '../components/KillConfirmDialog';
import { api } from '../lib/api';
import { cn, formatRelative, priorityColors, autoTitleFromContent } from '../lib/utils';
import type { Agent, Settings, Snapshot, Task } from '../lib/types';
import { openArtifactViewer } from '../components/ArtifactViewer';

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
  kind: 'info' | 'accent' | 'success' | 'warning' | 'error';
};

const COLUMNS: Column[] = [
  { id: 'queued', label: 'Queued', kind: 'info' },
  { id: 'doing', label: 'Doing', kind: 'accent' },
  { id: 'blocked', label: 'Blocked', kind: 'warning' },
  { id: 'done', label: 'Done', kind: 'success' },
];

/**
 * v3.7.4 — Decide whether a task belongs in the given kanban column.
 * Archived tasks (any prior session's "finished and tucked away" tasks)
 * show up in the DONE column so a fresh dashboard load still surfaces
 * everything that exists on disk.
 */
function matchesColumn(task: Task, colId: string): boolean {
  const isArchived = task.status === 'archived' || task.archived === true;
  if (colId === 'done') return task.status === 'done' || isArchived;
  return !isArchived && task.status === colId;
}

const PRIORITIES = ['low', 'normal', 'high'] as const;
type Priority = (typeof PRIORITIES)[number];
type SortKey = 'priority' | 'due' | 'created' | 'updated';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'updated', label: 'Last updated' },
  { id: 'created', label: 'Created' },
  { id: 'priority', label: 'Priority' },
  { id: 'due', label: 'Due date' },
];

export function Tasks({ snapshot, refreshSnapshot, setActiveTab }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [tasks, setTasks] = useState<Task[]>(snapshot.tasks || []);
  const [loading, setLoading] = useState(!snapshot.tasks);
  const [filter, setFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0); // for live timer re-render

  const reload = async (opts: { archived?: boolean } = {}) => {
    try {
      const params = opts.archived ? '?archived=only' : '';
      const data = await api.get<Task[]>(`/tasks${params}`);
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

  // Periodic tick for live timer display.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) for (const tag of t.tags || []) set.add(tag);
    return Array.from(set).sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    let out = tasks;
    if (assigneeFilter) {
      out = out.filter((t) => (t.assignee || '') === assigneeFilter);
    }
    if (priorityFilter) {
      out = out.filter((t) => (t.priority || 'normal') === priorityFilter);
    }
    if (tagFilter) {
      out = out.filter((t) => (t.tags || []).includes(tagFilter));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, filter, assigneeFilter, priorityFilter, tagFilter]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    const priorityWeight = { high: 0, normal: 1, low: 2 } as Record<string, number>;
    switch (sortKey) {
      case 'priority':
        out.sort((a, b) => (priorityWeight[a.priority] ?? 1) - (priorityWeight[b.priority] ?? 1));
        break;
      case 'created':
        out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case 'due':
        out.sort((a, b) => {
          const ax = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const bx = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          return ax - bx;
        });
        break;
      case 'updated':
      default:
        out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey]);

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

  const archiveTask = async (taskId: string) => {
    try {
      const updated = await api.post<Task>(`/tasks/${encodeURIComponent(taskId)}/archive`);
      setTasks((cur) => cur.filter((t) => t.id !== taskId));
      toast.success('Task archived.', 1500);
    } catch (err) {
      toast.error(`Archive failed: ${(err as Error).message}`);
    }
  };

  const unarchiveTask = async (taskId: string) => {
    try {
      const updated = await api.post<Task>(`/tasks/${encodeURIComponent(taskId)}/unarchive`);
      setTasks((cur) => cur.map((t) => (t.id === taskId ? updated : t)));
      toast.success('Task restored.', 1500);
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`);
    }
  };

  const onBulkAction = async (action: 'archive' | 'delete' | 'move' | 'priority' | 'assign' | 'tag', params: Record<string, unknown> = {}) => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    try {
      const out = await api.post<{ affected: { id: string; ok: boolean; error?: string }[] }>('/tasks/bulk', {
        ids,
        action,
        params,
      });
      const ok = out.affected.filter((r) => r.ok).length;
      const failed = out.affected.length - ok;
      if (action === 'archive' || action === 'delete') {
        setTasks((cur) => cur.filter((t) => !ids.includes(t.id)));
      } else {
        await reload();
      }
      toast.success(`Bulk ${action}: ${ok} ok${failed ? `, ${failed} failed` : ''}.`, 2500);
      setSelected(new Set());
    } catch (err) {
      toast.error(`Bulk failed: ${(err as Error).message}`);
    }
  };

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

  const onMarkWorkedBy = async (t: Task, agent: string, status: 'doing' | 'done' | 'idle', complete: boolean) => {
    try {
      const updated = await api.post<Task>(`/tasks/${encodeURIComponent(t.id)}/work`, {
        agent,
        status,
        complete,
      });
      setTasks((cur) => cur.map((x) => (x.id === t.id ? updated : x)));
      toast.success(`Marked ${status} by ${agent}.`, 1500);
    } catch (err) {
      toast.error(`Mark failed: ${(err as Error).message}`);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (ids: string[]) => {
    setSelected((cur) => {
      const next = new Set(cur);
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
        return next;
      }
      ids.forEach((id) => next.add(id));
      return next;
    });
  };

  // v3.6.2 — Pipeline: open task chat session.
  const onOpenTaskChat = (taskId: string) => {
    setActiveTab('chat');
    // The Chat view reads crossState.initialChatTaskId to pre-load a session.
    // We set it via a custom event that Chat.tsx listens to on mount.
    window.dispatchEvent(new CustomEvent('bizar:setChatTask', { detail: { taskId } }));
  };

  // v3.6.2 — Pipeline: open task artifact viewer.
  const onOpenTaskArtifact = (artifactId: string) => {
    openArtifactViewer(modal, artifactId);
  };

  return (
    <div className="view view-tasks">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <CheckSquare size={18} /> Tasks ({sorted.length})
          </h2>
          <p className="view-subtitle">
            Personal kanban. Click a card for details (subtasks, deps, timer, comments, activity).
          </p>
        </div>
      </header>

      {/* v3.4.0 — Compact single-row toolbar: search + filters + sort + actions */}
      <div className="tasks-toolbar">
        <div className="tasks-toolbar-group">
          <div className="search-input" style={{ width: 200 }}>
            <Search size={12} />
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
        </div>

        <div className="tasks-toolbar-divider" />

        <div className="tasks-toolbar-group">
          <span className="tasks-toolbar-label">Filter</span>
          <select
            className="select select-sm"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            title="Assignee"
          >
            <option value="">All assignees</option>
            <option value="me">Me</option>
            {(snapshot.agents || []).map((a) => (
              <option key={a.name} value={a.name}>@{a.name}</option>
            ))}
          </select>
          <select
            className="select select-sm"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            title="Priority"
          >
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {allTags.length > 0 && (
            <select
              className="select select-sm"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              title="Tag"
            >
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>#{t}</option>
              ))}
            </select>
          )}
        </div>

        <div className="tasks-toolbar-divider" />

        <div className="tasks-toolbar-group">
          <span className="tasks-toolbar-label">Sort</span>
          <select
            className="select select-sm"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            title="Sort by"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="tasks-toolbar-spacer" />

        <div className="tasks-toolbar-group">
          <Button
            variant={showArchived ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => {
              setShowArchived((v) => !v);
              reload({ archived: !showArchived });
            }}
            title={showArchived ? 'Showing archived' : 'Show archived'}
          >
            {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {showArchived ? 'Active' : 'Archived'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => reload()} title="Refresh" aria-label="Refresh tasks">
            <RefreshCw size={14} />
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={() => openSubmitTaskModal(modal, toast, setTasks, reload, refreshSnapshot)}
          >
            <Send size={14} /> Odin
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => openTaskModal(modal, toast, null, 'queued', setTasks, reload, refreshSnapshot, snapshot.agents)}
          >
            <Plus size={14} /> Add
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="task-bulk-bar">
          <span className="text-sm">
            <CheckSquareIcon size={14} /> {selected.size} selected
          </span>
          <div className="task-bulk-bar-actions">
            <Button size="sm" variant="ghost" onClick={() => onBulkAction('move', { status: 'queued' })}>
              Queued
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onBulkAction('move', { status: 'doing' })}>
              Doing
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onBulkAction('move', { status: 'done' })}>
              Done
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onBulkAction('priority', { priority: 'high' })}>
              High
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onBulkAction('archive')}>
              <Archive size={12} /> Archive
            </Button>
            <Button size="sm" variant="danger" onClick={() => onBulkAction('delete')}>
              <Trash2 size={12} /> Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="view-loading"><Spinner size="lg" /></div>
      ) : (
        <div className="kanban">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              // v3.7.4 — Archived tasks (`status: "archived"` OR `archived: true`)
              // surface in the DONE column so earlier-existing tasks are
              // visible from a fresh dashboard load. The TaskCard itself
              // shows an "Archived" badge so the user can distinguish them
              // from completed tasks.
              tasks={sorted.filter((t) => matchesColumn(t, col.id))}
              selected={selected}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              allTaskIdsInCol={sorted.filter((t) => matchesColumn(t, col.id)).map((t) => t.id)}
              onMove={moveTask}
              onDelete={deleteTask}
              onArchive={archiveTask}
              onUnarchive={unarchiveTask}
              onEdit={(t) => openTaskDetail(modal, toast, t, setTasks, reload, refreshSnapshot, snapshot.agents, tick)}
              onAdd={() => openTaskModal(modal, toast, null, col.id, setTasks, reload, refreshSnapshot, snapshot.agents)}
              onAssignMe={onAssignMe}
              onMarkWorkedBy={onMarkWorkedBy}
              onOpenChat={onOpenTaskChat}
              onOpenArtifact={onOpenTaskArtifact}
              isArchivedView={showArchived}
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
  selected,
  onToggleSelect,
  onToggleSelectAll,
  allTaskIdsInCol,
  onMove,
  onDelete,
  onArchive,
  onUnarchive,
  onEdit,
  onAdd,
  onAssignMe,
  onMarkWorkedBy,
  onOpenChat,
  onOpenArtifact,
  isArchivedView,
}: {
  column: Column;
  tasks: Task[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  allTaskIdsInCol: string[];
  onMove: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onEdit: (task: Task) => void;
  onAdd: () => void;
  onAssignMe: (task: Task) => void;
  onMarkWorkedBy: (task: Task, agent: string, status: 'doing' | 'done' | 'idle', complete: boolean) => void;
  onOpenChat: (taskId: string) => void;
  onOpenArtifact: (artifactId: string) => void;
  isArchivedView: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const allSelected = tasks.length > 0 && allTaskIdsInCol.every((id) => selected.has(id));
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
        <button
          type="button"
          className="icon-btn"
          onClick={() => onToggleSelectAll(allTaskIdsInCol)}
          title={allSelected ? 'Deselect all' : 'Select all'}
          aria-label={allSelected ? 'Deselect all' : 'Select all'}
        >
          {allSelected ? <CheckSquareIcon size={12} /> : <Square size={12} />}
        </button>
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
              focused={selected.has(t.id)}
              onFocus={() => onToggleSelect(t.id)}
              onMove={(dir) => {
                const idx = COLUMNS.findIndex((c) => c.id === t.status);
                const next = idx + dir;
                if (next >= 0 && next < COLUMNS.length)
                  onMove(t.id, COLUMNS[next].id);
              }}
              onEdit={() => onEdit(t)}
              onDelete={() => onDelete(t.id)}
              onArchive={() => onArchive(t.id)}
              onUnarchive={() => onUnarchive(t.id)}
              onAssignMe={() => onAssignMe(t)}
              onMarkWorkedBy={(agent, status, complete) => onMarkWorkedBy(t, agent, status, complete)}
              onOpenChat={onOpenChat}
              onOpenArtifact={onOpenArtifact}
              isArchivedView={isArchivedView}
            />
          ))
        )}
      </div>
      {!isArchivedView && (
        <footer className="kanban-col-footer">
          <Button variant="ghost" size="sm" onClick={onAdd} className="w-full">
            <Plus size={12} /> Add task
          </Button>
        </footer>
      )}
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
  onArchive,
  onUnarchive,
  onAssignMe,
  onMarkWorkedBy,
  onOpenChat,
  onOpenArtifact,
  isArchivedView,
}: {
  task: Task;
  focused: boolean;
  onFocus: () => void;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onAssignMe: () => void;
  onMarkWorkedBy: (agent: string, status: 'doing' | 'done' | 'idle', complete: boolean) => void;
  onOpenChat: (taskId: string) => void;
  onOpenArtifact: (artifactId: string) => void;
  isArchivedView: boolean;
}) {
  const toast = useToast();
  const modal = useModal();
  const isTimer = task._timerStart;
  const isWorking = (task.workedBy || task.status === 'doing') && !isArchivedView;

  // v3.6.2 — Pipeline: determine if task has a chat session or artifact.
  type TaskPipelineMeta = {
    sessionId?: string;
    bgInstanceId?: string;
    status?: string;
    artifactIds?: string[];
    artifactId?: string;
  };
  const metadata = (task.metadata || {}) as TaskPipelineMeta;
  const hasChatSession = !!(metadata.sessionId || metadata.bgInstanceId);
  const artifactIds: string[] = metadata.artifactIds || (metadata.artifactId ? [metadata.artifactId] : []);
  const primaryArtifactId = artifactIds[0];
  return (
    <div
      className={cn(
        'task-card',
        `priority-${task.priority}`,
        focused && 'task-card-focused',
        isTimer ? 'task-card-timer is-working' : null,
        isWorking && !isTimer ? 'is-working' : null,
      )}
      data-task-id={task.id}
      data-task-parent={task.parent || ''}
      draggable={!isArchivedView}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onFocus}
    >
      <div className="task-card-head">
        {/* v3.7.0 — Visible checkbox for bulk select */}
        <button
          type="button"
          className={cn('task-card-checkbox', focused && 'task-card-checkbox-on')}
          aria-label={focused ? 'Deselect task' : 'Select task'}
          title={focused ? 'Deselect' : 'Select'}
          onClick={(e) => {
            e.stopPropagation();
            onFocus();
          }}
        >
          {focused ? <CheckSquareIcon size={13} /> : <Square size={13} />}
        </button>
        <span
          className="priority-dot"
          style={{ background: priorityColors[task.priority] || 'var(--info)' }}
        />
        <div className="task-card-title">{task.title}</div>
        {isTimer && <span className="task-card-timer-pill"><Clock size={10} /> running</span>}
        {task.workedBy && task.status === 'doing' && !isTimer && (
          <span className="task-card-timer-pill" title={`@${task.workedBy}`}>
            <Bot size={10} /> @{task.workedBy}
          </span>
        )}
        {task.recurring && (
          <span className="task-card-timer-pill" title="Recurring">
            <RotateCw size={10} />
          </span>
        )}
      </div>
      {task.description && (
        <div className="task-card-desc">{task.description.slice(0, 160)}</div>
      )}
      <div className="task-card-badges">
        {task.assignee && !task.workedBy && <span className="task-card-badge"><TagIcon size={10} /> @{task.assignee}</span>}
        {task.timeSpent ? <span className="task-card-badge"><Clock size={10} /> {formatDuration(task.timeSpent)}</span> : null}
        {task.dependencies?.length ? <span className="task-card-badge"><Link2 size={10} /> {task.dependencies.length}</span> : null}
        {task.recurring ? <span className="task-card-badge"><Calendar size={10} /> {task.recurring.cron || task.recurring.freq || 'recurring'}</span> : null}
        {task.comments?.length ? <span className="task-card-badge"><MessageSquare size={10} /> {task.comments.length}</span> : null}
        {task.attachments?.length ? <span className="task-card-badge"><Paperclip size={10} /> {task.attachments.length}</span> : null}
        {metadata.bgInstanceId ? (
          <span className="task-card-badge">
            <Activity size={10} /> <BgStatusBadge status={metadata.status || 'pending'} />
          </span>
        ) : null}
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
          {!isArchivedView && (
            <>
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
                <Sparkles size={14} />
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
              {hasChatSession && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Open chat"
                  title="Open in chat"
                  onClick={() => onOpenChat(task.id)}
                >
                  <MessageSquare size={14} />
                </button>
              )}
              {primaryArtifactId && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Open artifact"
                  title="Open artifact"
                  onClick={() => onOpenArtifact(primaryArtifactId)}
                >
                  <FileText size={14} />
                </button>
              )}
              {isArchivedView ? (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Restore"
                  title="Restore"
                  onClick={onUnarchive}
                >
                  <ArchiveRestore size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Archive"
                  title="Archive"
                  onClick={onArchive}
                >
                  <Archive size={14} />
                </button>
              )}
              {metadata.bgInstanceId && (
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  aria-label="Kill background instance"
                  title="Kill background instance"
                  onClick={() => {
                    openKillConfirmDialog(modal, toast, metadata.bgInstanceId!, task.title, () => {
                      // Optimistically mark task as blocked after kill.
                      const event = new CustomEvent('bizar:taskKilled', {
                        detail: { taskId: task.id, bgInstanceId: metadata.bgInstanceId },
                      });
                      window.dispatchEvent(event);
                    });
                  }}
                >
                  <Activity size={14} />
                </button>
              )}
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
            </>
          )}
          {isArchivedView && (
            <>
              <button
                type="button"
                className="icon-btn"
                aria-label="Restore"
                title="Restore"
                onClick={onUnarchive}
              >
                <ArchiveRestore size={14} />
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
            </>
          )}
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
  agents: Agent[] = [],
) {
  let titleEl: HTMLInputElement | null = null;
  let descEl: HTMLTextAreaElement | null = null;
  let tagsEl: HTMLInputElement | null = null;
  let priorityEl: HTMLDivElement | null = null;
  let statusEl: HTMLSelectElement | null = null;
  let assigneeEl: HTMLInputElement | null = null;
  let recurEl: HTMLSelectElement | null = null;
  let cronEl: HTMLInputElement | null = null;
  let dueEl: HTMLInputElement | null = null;

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
    const recurFreq = recurEl?.value || '';
    const cron = cronEl?.value.trim() || '';
    const recurring = recurFreq === 'custom' && cron
      ? { freq: 'custom', cron }
      : recurFreq && recurFreq !== 'none'
        ? { freq: recurFreq }
        : null;
    const dueDate = dueEl?.value || null;

    try {
      if (task) {
        const updated = await api.put<Task>(`/tasks/${encodeURIComponent(task.id)}`, {
          title,
          description,
          tags,
          priority,
          status,
          assignee,
          recurring,
          dueDate,
        });
        // v3.3.1 — close modal first, bump safe window, then state.
        modal.close();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new MouseEvent('mousedown'));
        }
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
          recurring,
          dueDate,
        });
        // v3.3.1 — close modal first, bump safe window, then state.
        modal.close();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new MouseEvent('mousedown'));
        }
        setTasks((cur) => [created, ...cur]);
        toast.success('Task created.', 1500);
      }
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
        <label className="field-label" htmlFor="task-desc">Description (markdown)</label>
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
        <div className="task-form-row">
          <div className="task-form-field">
            <label className="field-label" htmlFor="task-assignee">Assignee</label>
            <input
              ref={(el) => { assigneeEl = el; }}
              id="task-assignee"
              className="input"
              type="text"
              placeholder="odin, thor, me, …"
              list="task-assignee-suggestions"
              defaultValue={task?.assignee || ''}
            />
            <datalist id="task-assignee-suggestions">
              {agents.map((a) => (
                <option key={a.name} value={a.name}>@{a.name}</option>
              ))}
            </datalist>
          </div>
          <div className="task-form-field">
            <label className="field-label" htmlFor="task-due">Due date</label>
            <input
              ref={(el) => { dueEl = el; }}
              id="task-due"
              className="input"
              type="date"
              defaultValue={task?.dueDate?.slice(0, 10) || ''}
            />
          </div>
        </div>
        <label className="field-label" htmlFor="task-tags">Tags</label>
        <input
          ref={(el) => { tagsEl = el; }}
          id="task-tags"
          className="input"
          type="text"
          placeholder="comma-separated, e.g. bug, frontend"
          defaultValue={(task?.tags || []).join(', ')}
        />
        <div className="task-form-row">
          <div className="task-form-field">
            <label className="field-label" htmlFor="task-recur">Recurring</label>
            <select
              ref={(el) => { recurEl = el; }}
              id="task-recur"
              className="select"
              defaultValue={task?.recurring?.freq || 'none'}
            >
              <option value="none">None</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom (cron)</option>
            </select>
          </div>
          <div className="task-form-field">
            <label className="field-label" htmlFor="task-cron">Cron expression</label>
            <input
              ref={(el) => { cronEl = el; }}
              id="task-cron"
              className="input"
              type="text"
              placeholder="0 9 * * *"
              defaultValue={task?.recurring?.cron || ''}
            />
          </div>
        </div>
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
  agents: Agent[] = [],
  tick: number = 0,
) {
  let commentEl: HTMLTextAreaElement | null = null;
  let depEl: HTMLInputElement | null = null;
  let agentEl: HTMLSelectElement | null = null;

  const refresh = async () => {
    try {
      const r = await api.get<Task[]>(`/tasks?archived=${task.archived ? 'true' : 'false'}`);
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

  const onStartTimer = async () => {
    try {
      const updated = await api.post<Task>(`/tasks/${encodeURIComponent(task.id)}/timer/start`);
      setTasks((cur) => cur.map((x) => (x.id === task.id ? updated : x)));
      toast.success('Timer started.', 1200);
    } catch (err) {
      toast.error(`Start failed: ${(err as Error).message}`);
    }
  };

  const onStopTimer = async () => {
    try {
      const updated = await api.post<Task>(`/tasks/${encodeURIComponent(task.id)}/timer/stop`);
      setTasks((cur) => cur.map((x) => (x.id === task.id ? updated : x)));
      toast.success('Timer stopped.', 1200);
    } catch (err) {
      toast.error(`Stop failed: ${(err as Error).message}`);
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

  const onMarkWorkedBy = async (status: 'doing' | 'done' | 'idle', complete: boolean) => {
    const agent = agentEl?.value || '';
    if (!agent) {
      toast.warning('Pick an agent first.');
      return;
    }
    try {
      const updated = await api.post<Task>(`/tasks/${encodeURIComponent(task.id)}/work`, {
        agent,
        status,
        complete,
      });
      setTasks((cur) => cur.map((x) => (x.id === task.id ? updated : x)));
      toast.success(`${status} by @${agent}.`, 1200);
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  };

  const timerSeconds = task._timerStart
    ? Math.floor((Date.now() - task._timerStart) / 1000) + (task.timeSpent || 0)
    : (task.timeSpent || 0);

  modal.open({
    title: `Task — ${task.title}`,
    width: 640,
    children: (
      <div className="task-detail">
        <div className="task-detail-meta">
          <span><strong>Status:</strong> {task.status}</span>
          <span><strong>Priority:</strong> {task.priority}</span>
          {task.assignee && <span><strong>Assignee:</strong> @{task.assignee}</span>}
          {task.workedBy && <span><strong>Working:</strong> <span className="is-working" style={{ display: 'inline-block', padding: '0 6px' }}>@{task.workedBy}</span></span>}
          {task.dueDate && <span><strong>Due:</strong> {task.dueDate.slice(0, 10)}</span>}
          <span><strong>Time:</strong> {formatDuration(timerSeconds)}</span>
        </div>
        {task.description && (
          <Card>
            <CardTitle>Description</CardTitle>
            <div className="task-detail-desc">{task.description}</div>
          </Card>
        )}
        <Card>
          <CardTitle><Bot size={14} /> Mark as worked on by</CardTitle>
          <div className="task-detail-row">
            <select ref={(el) => { agentEl = el; }} className="select" defaultValue={task.workedBy || ''}>
              <option value="">(pick an agent)</option>
              {agents.map((a) => (
                <option key={a.name} value={a.name}>@{a.name}</option>
              ))}
            </select>
            <Button variant="primary" size="sm" onClick={() => onMarkWorkedBy('doing', false)}>
              <PlayCircle size={12} /> Start working
            </Button>
            <Button variant="success" size="sm" onClick={() => onMarkWorkedBy('done', true)}>
              <CheckSquare size={12} /> Complete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onMarkWorkedBy('idle', false)}>
              <PauseCircle size={12} /> Stop
            </Button>
          </div>
        </Card>
        <Card>
          <CardTitle><Clock size={14} /> Time tracking</CardTitle>
          <div className="task-detail-row">
            {!task._timerStart ? (
              <Button variant="secondary" size="sm" onClick={onStartTimer}>
                <PlayCircle size={12} /> Start
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={onStopTimer} className="is-working">
                <PauseCircle size={12} /> Stop
              </Button>
            )}
            <span className={cn('muted', task._timerStart ? 'is-working' : null)}>
              {formatDuration(timerSeconds)}
              {task._timerStart && ' (running)'}
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
            {(task.dependencies || []).length === 0 && <li className="muted">No dependencies.</li>}
          </ul>
        </Card>
        {task.recurring && (
          <Card>
            <CardTitle><Calendar size={14} /> Recurring</CardTitle>
            <div className="muted">Frequency: <code>{task.recurring.freq || 'custom'}</code> {task.recurring.cron && <code>{task.recurring.cron}</code>}</div>
            {task.recurring.lastGenerated && (
              <div className="muted text-sm">Last spawned: {formatRelative(task.recurring.lastGenerated)}</div>
            )}
          </Card>
        )}
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
        <Button variant="primary" onClick={() => { modal.close(); openTaskModal(modal, toast, task, task.status, setTasks, reload, refreshSnapshot, agents); }}>
          <Sparkles size={12} /> Edit basics
        </Button>
      </div>
    ),
  });
}

// v3.2.0 — Submit a task to Odin. Odin splits it into subtasks and
// assigns each to the best-fit agent. Falls back to a regular task
// create if the delegator route is unavailable (older dashboards).
function openSubmitTaskModal(
  modal: ReturnType<typeof useModal>,
  toast: ReturnType<typeof useToast>,
  setTasks: (updater: (cur: Task[]) => Task[]) => void,
  reload: () => Promise<void>,
  refreshSnapshot: () => Promise<void>,
) {
  let titleEl: HTMLInputElement | null = null;
  let descEl: HTMLTextAreaElement | null = null;
  let priorityEl: HTMLSelectElement | null = null;
  let tagsEl: HTMLInputElement | null = null;

  // v3.3.0 — Wraps the submit click so we can preventDefault /
  // stopPropagation. Without this, a click on a button could bubble
  // up through the modal portal after the modal closes and either
  // trigger a sibling button or, more importantly, allow a
  // subsequent digit-key event to fire setActiveTab("overview")
  // because the just-closed modal had removed the user's focused
  // form control.
  const onSubmit = async (e?: React.SyntheticEvent) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const description = descEl?.value || '';
    let title = (titleEl?.value || '').trim();
    // v3.7.1 — Title is now optional. Auto-generate from the description
    // when the user left it blank. Reject only if BOTH fields are empty.
    if (!title && description.trim()) {
      title = autoTitleFromContent(description);
      if (titleEl) titleEl.value = title;
    }
    if (!title) {
      toast.warning('Add a description so Odin knows what to do.');
      return;
    }
    const priority = priorityEl?.value || 'normal';
    const tags = (tagsEl?.value || '')
      .split(',')
      .map((t: string) => t.trim())
      .filter(Boolean);

    try {
      const result = await api.post<{ main: Task; subtasks: Task[] }>('/tasks/submit', {
        title,
        description,
        priority,
        tags,
      });
      const count = (result.subtasks || []).length;
      toast.success(
        count > 1
          ? `Odin split it into ${count} subtasks.`
          : 'Task submitted to Odin.',
      );
      // v3.3.1 — CRITICAL: close modal FIRST, then bump safe window,
      // then update state. This way the portal unmount + React re-render
      // can't trigger any key handlers in the brief window before state
      // updates. We manually dispatch a synthetic mousedown to extend
      // the safe window so any stray keyboard events during the state-
      // update tick also can't trigger tab switches.
      modal.close();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new MouseEvent('mousedown'));
      }
      if (setTasks) setTasks((cur: Task[]) => [result.main, ...(result.subtasks || []), ...cur]);
      if (reload) await reload();
      if (refreshSnapshot) await refreshSnapshot();
    } catch (err) {
      toast.error(`Submit failed: ${(err as Error).message}`);
    }
  };

  // v3.3.0 — Submit on Enter from the title input. Without an
  // explicit onKeyDown, the implicit form-submit behavior can fire
  // when a user presses Enter. Even though we don't wrap inputs in
  // <form>, this is the safest pattern.
  const onTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  modal.open({
    title: 'Submit Task to Odin',
    width: 560,
    children: (
      <div className="submit-task-form">
        <label htmlFor="submit-task-title">
          Title <span className="field-hint">(optional — auto-generated from description)</span>
          <input
            id="submit-task-title"
            ref={(el) => { titleEl = el; }}
            className="input"
            type="text"
            placeholder="Leave blank to derive from description"
            autoFocus
            onKeyDown={onTitleKeyDown}
          />
          <span className="field-hint">
            Odin will analyze this and split it into subtasks assigned to the best agent.
          </span>
        </label>
        <label htmlFor="submit-task-desc">
          Description
          <textarea
            id="submit-task-desc"
            ref={(el) => { descEl = el; }}
            className="textarea"
            rows={5}
            placeholder="Provide more detail (markdown ok)…"
          />
        </label>
        <div className="task-form-row">
          <label htmlFor="submit-task-priority" className="task-form-field">
            Priority
            <select
              id="submit-task-priority"
              ref={(el) => { priorityEl = el; }}
              className="select"
              defaultValue="normal"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label htmlFor="submit-task-tags" className="task-form-field" style={{ flex: 2 }}>
            Tags <span className="field-hint">(comma-separated)</span>
            <input
              id="submit-task-tags"
              ref={(el) => { tagsEl = el; }}
              className="input"
              type="text"
              placeholder="backend, auth"
            />
          </label>
        </div>
      </div>
    ),
    footer: (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
        <Button
          variant="primary"
          type="button"
          onClick={(e) => onSubmit(e)}
        >
          <Send size={14} /> Submit to Odin
        </Button>
      </div>
    ),
  });
}
