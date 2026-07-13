import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, CheckSquare, Play } from 'lucide-react';
import {
  Dialog,
  DialogContent,
} from '../../ui/feedback/Dialog.js';
import { ContextMenuItem } from '../../ui/feedback/ContextMenu.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Textarea } from '../../ui/controls/Textarea.js';
import { Field } from '../../ui/controls/Field.js';
import { Select, SelectTrigger, SelectContent, SelectItem } from '../../ui/controls/Select.js';
import {
  KanbanBoard,
  KanbanColumn,
  KanbanCard,
  useKanbanCardSortable,
  KanbanQuickAdd,
  KanbanContextMenu,
  KanbanToolbar,
  KanbanEmptyColumn,
  KanbanDetailDialog,
  useKanbanSelection,
  type KanbanColumnData,
  type KanbanCardData,
} from '../../ui/index.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { toast } from '../../ui/feedback/Toast.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { fetchJson } from '../../data/fetcher.js';
import type { Task, WsMessage } from '../../data/types.js';

/**
 * TasksView — Sprint S11 kanban surface (cline-style).
 *
 * Pulls `/api/tasks` (bare array), maps statuses to columns, and
 * stays in sync via `tasks:change` / `tasks:delete` / `task:progress`
 * WebSocket events.
 *
 * Features:
 *   - drag between columns (PATCH /api/tasks/:id/status)
 *   - quick-add inside each column (POST /api/tasks)
 *   - full-edit detail dialog (PUT /api/tasks/:id)
 *   - right-click context menu (open / duplicate / move / archive / delete)
 *   - multi-select toolbar (bulk move / archive / delete via
 *     POST /api/tasks/bulk)
 *   - search across titles + descriptions
 *   - priority filter chips
 */

type TaskStatus = NonNullable<Task['status']>;
type TaskPriority = NonNullable<Task['priority']>;

const COLUMNS: KanbanColumnData[] = [
  { id: 'backlog', title: 'Backlog', accentTone: 'neutral' },
  { id: 'queued', title: 'Queued', accentTone: 'info' },
  { id: 'doing', title: 'In progress', accentTone: 'accent', wipLimit: 5 },
  { id: 'blocked', title: 'In review', accentTone: 'warning' },
  { id: 'done', title: 'Done', accentTone: 'success' },
  { id: 'archived', title: 'Archived', accentTone: 'neutral' },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; tone: 'neutral' | 'info' | 'warning' | 'danger' }[] = [
  { value: 'low', label: 'Low', tone: 'neutral' },
  { value: 'medium', label: 'Medium', tone: 'info' },
  { value: 'high', label: 'High', tone: 'warning' },
  { value: 'urgent', label: 'Urgent', tone: 'danger' },
];

/** Map any priority string the backend might emit to the dashboard's union. */
function normalizePriority(p: string | undefined): TaskPriority {
  switch (p) {
    case 'low':
    case 'medium':
    case 'high':
    case 'urgent':
      return p;
    case 'normal': // server-side alias for medium
      return 'medium';
    default:
      return 'medium';
  }
}

/** Card shape used inside the board. */
interface Card extends KanbanCardData {
  taskId: string;
  columnId: TaskStatus;
}

function taskToCard(t: Task): Card {
  const md = (t.metadata ?? {}) as Record<string, unknown>;
  const tags = Array.isArray(t.tags) ? t.tags : [];
  const subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
  const dependencies = Array.isArray(t.dependencies) ? t.dependencies : [];
  const status = (t.status ?? 'queued') as TaskStatus;
  return {
    id: t.id,
    taskId: t.id,
    columnId: status,
    title: t.title,
    description: t.description,
    priority: normalizePriority(t.priority),
    branch: t.branch,
    due: t.due,
    comments: t.comments,
    attachments: t.attachments,
    assignee: t.assignee ?? undefined,
    progress: typeof md.progress === 'number' ? md.progress : undefined,
    currentStep: typeof md.currentStep === 'string' ? md.currentStep : undefined,
    recurring: t.recurring != null,
    tags,
    subtaskCount: subtasks.length || undefined,
    dependencyCount: dependencies.length || undefined,
  };
}

function statusToColumn(status: TaskStatus | string | undefined): TaskStatus {
  switch (status) {
    case 'backlog':
    case 'queued':
    case 'doing':
    case 'blocked':
    case 'done':
    case 'archived':
      return status;
    default:
      return 'queued';
  }
}

function columnIndex(id: string): number {
  return COLUMNS.findIndex((c) => c.id === id);
}

/**
 * SortableCard — wraps a single KanbanCard with dnd-kit's useSortable
 * so KanbanBoard.onDragEnd can fire.
 */
function SortableCard(props: {
  card: Card;
  selected: boolean;
  onSelectionChange: (id: string, next: boolean) => void;
  onOpen: (taskId: string) => void;
  onMove: (taskId: string, direction: -1 | 1) => void;
  onDuplicate: (taskId: string) => void;
  onCopyLink: (taskId: string) => void;
  onArchive: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onStart: (taskId: string) => void;
  showSelection: boolean;
}): JSX.Element {
  const sortable = useKanbanCardSortable(props.card.id);
  const colIdx = columnIndex(props.card.columnId);
  const canMoveLeft = colIdx > 0;
  const canMoveRight = colIdx >= 0 && colIdx < COLUMNS.length - 1;
  return (
    <KanbanContextMenu
      canMoveLeft={canMoveLeft}
      canMoveRight={canMoveRight}
      onOpen={() => props.onOpen(props.card.taskId)}
      onRename={() => props.onOpen(props.card.taskId)}
      onDuplicate={() => props.onDuplicate(props.card.taskId)}
      onCopyLink={() => props.onCopyLink(props.card.taskId)}
      onMoveLeft={() => props.onMove(props.card.taskId, -1)}
      onMoveRight={() => props.onMove(props.card.taskId, 1)}
      onArchive={() => props.onArchive(props.card.taskId)}
      onDelete={() => props.onDelete(props.card.taskId)}
      extraItems={
        props.card.columnId === 'queued' ? (
          <KanbanContextMenuAction
            label="Start agent"
            onSelect={() => props.onStart(props.card.taskId)}
          />
        ) : undefined
      }
    >
      <KanbanCard
        card={props.card}
        isDragging={sortable.isDragging}
        selected={props.selected}
        onSelectionChange={props.onSelectionChange}
        showSelection={props.showSelection}
        onClick={() => props.onOpen(props.card.taskId)}
        dragHandleProps={{ ...sortable.attributes, ...sortable.listeners, ref: sortable.setNodeRef, style: sortable.style }}
      />
    </KanbanContextMenu>
  );
}

/** Lightweight menu item used by `extraItems` above. */
function KanbanContextMenuAction(props: { label: string; onSelect: () => void }): JSX.Element {
  return (
    <ContextMenuItem leftIcon={<Play size={14} aria-hidden="true" />} onSelect={props.onSelect}>
      {props.label}
    </ContextMenuItem>
  );
}

export function TasksView(): JSX.Element {
  const tasks = useFetch<Task[]>('/api/tasks');
  const [cards, setCards] = useState<Card[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate local state from the initial fetch. useEffect so we don't
  // setState during render (which would warn + be discarded on re-render).
  useEffect(() => {
    if (tasks.data && !hydrated) {
      setCards(tasks.data.map(taskToCard));
      setHydrated(true);
    }
  }, [tasks.data, hydrated]);

  const onWsChange = useCallback((msg: WsMessage) => {
    if (msg.type !== 'tasks:change') return;
    const t = msg.task as Task | undefined;
    if (!t) return;
    setCards((prev) => {
      const idx = prev.findIndex((c) => c.taskId === t.id);
      const card = taskToCard(t);
      if (idx === -1) return [...prev, card];
      const copy = prev.slice();
      copy[idx] = { ...copy[idx], ...card };
      return copy;
    });
  }, []);

  const onWsDelete = useCallback((msg: WsMessage) => {
    if (msg.type !== 'tasks:delete') return;
    const id = (msg as { id?: string }).id;
    if (!id) return;
    setCards((prev) => prev.filter((c) => c.taskId !== id));
  }, []);

  const onWsProgress = useCallback((msg: WsMessage) => {
    if (msg.type !== 'task:progress') return;
    const m = msg as { taskId?: string; progress?: number; step?: string };
    if (!m.taskId) return;
    setCards((prev) =>
      prev.map((c) =>
        c.taskId === m.taskId
          ? {
              ...c,
              progress: typeof m.progress === 'number' ? m.progress : c.progress,
              currentStep: typeof m.step === 'string' ? m.step : c.currentStep,
            }
          : c,
      ),
    );
  }, []);

  useWsMessage(['tasks:change', 'tasks:delete', 'task:progress'], (msg) => {
    if (msg.type === 'tasks:change') onWsChange(msg);
    else if (msg.type === 'tasks:delete') onWsDelete(msg);
    else if (msg.type === 'task:progress') onWsProgress(msg);
  });

  // --- search + filter ---
  const [query, setQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<ReadonlySet<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (activeFilters.has(`priority:${c.priority ?? 'medium'}`) === false &&
          Array.from(activeFilters).some((f) => f.startsWith('priority:'))) {
        return false;
      }
      if (activeFilters.has(`status:${c.columnId}`) === false &&
          Array.from(activeFilters).some((f) => f.startsWith('status:'))) {
        return false;
      }
      if (q === '') return true;
      const haystack = `${c.title} ${c.description ?? ''} ${c.branch ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [cards, query, activeFilters]);

  // --- selection ---
  const selection = useKanbanSelection();
  const selectionMode = selection.selected.size > 0;

  // --- detail dialog ---
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const openTask = useMemo(
    () => (openTaskId ? cards.find((c) => c.taskId === openTaskId) : null) ?? null,
    [openTaskId, cards],
  );

  // Re-derive the live Task shape from the local card state so progress
  // / activity / etc. stay in sync without a re-fetch.
  const openTaskLive: Task | null = useMemo(() => {
    if (!openTask) return null;
    const c = openTask;
    return {
      id: c.taskId,
      title: c.title,
      description: c.description,
      status: c.columnId,
      priority: c.priority,
      branch: c.branch,
      due: c.due,
      comments: c.comments,
      attachments: c.attachments,
      assignee: c.assignee ?? null,
      tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
      metadata:
        c.progress !== undefined
          ? { progress: c.progress, currentStep: c.currentStep }
          : undefined,
    } as Task;
  }, [openTask]);

  // --- new task dialog ---
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newStatus, setNewStatus] = useState<TaskStatus>('queued');

  const onCreate = async () => {
    const title = newTitle.trim();
    if (title === '') return;
    try {
      await fetchJson('/api/tasks', {
        method: 'POST',
        body: {
          title,
          description: newDescription,
          priority: newPriority === 'medium' ? 'normal' : newPriority,
          status: newStatus,
        },
      });
      toast.success('Task created', { description: title });
      setNewTitle('');
      setNewDescription('');
      setNewPriority('medium');
      setNewStatus('queued');
      setCreating(false);
    } catch (err) {
      toast.error('Could not create task', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // --- column card move (drag or arrow) ---
  const moveCard = useCallback(
    async (cardId: string, fromColumnId: string, toColumnId: string) => {
      const card = cards.find((c) => c.id === cardId || c.taskId === cardId);
      if (!card || fromColumnId === toColumnId) return;
      const prevColumn = card.columnId;
      setCards((p) =>
        p.map((c) => (c.id === cardId ? { ...c, columnId: toColumnId as TaskStatus } : c)),
      );
      try {
        await fetchJson(`/api/tasks/${encodeURIComponent(card.taskId)}/status`, {
          method: 'PATCH',
          body: { status: toColumnId },
        });
      } catch (err) {
        setCards((p) =>
          p.map((c) => (c.id === cardId ? { ...c, columnId: prevColumn } : c)),
        );
        toast.error('Could not move task', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [cards],
  );

  // --- quick-add (per-column) ---
  const quickAdd = useCallback(
    async (columnId: string, title: string) => {
      try {
        await fetchJson('/api/tasks', {
          method: 'POST',
          body: {
            title,
            status: columnId,
            priority: 'normal',
          },
        });
        toast.success('Task created', { description: title });
      } catch (err) {
        toast.error('Could not create task', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  // --- context-menu / dialog actions ---
  const onMove = useCallback(
    (taskId: string, direction: -1 | 1) => {
      const card = cards.find((c) => c.taskId === taskId);
      if (!card) return;
      const idx = columnIndex(card.columnId);
      const next = COLUMNS[idx + direction];
      if (next) void moveCard(card.id, card.columnId, next.id);
    },
    [cards, moveCard],
  );

  const onDuplicate = useCallback(
    async (taskId: string) => {
      const card = cards.find((c) => c.taskId === taskId);
      if (!card) return;
      try {
        await fetchJson('/api/tasks', {
          method: 'POST',
          body: {
            title: `${card.title} (copy)`,
            description: card.description,
            priority: card.priority === 'medium' ? 'normal' : card.priority,
            status: card.columnId,
            tags: Array.isArray(card.tags) ? card.tags : [],
            assignee: card.assignee,
            branch: card.branch,
          },
        });
        toast.success('Task duplicated');
      } catch (err) {
        toast.error('Could not duplicate', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [cards],
  );

  const onCopyLink = useCallback((taskId: string) => {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}${window.location.pathname}#task/${taskId}`;
    void navigator.clipboard?.writeText(url);
    toast.info('Link copied');
  }, []);

  const onArchiveOne = useCallback(
    async (taskId: string) => {
      try {
        await fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/archive`, {
          method: 'POST',
        });
        toast.success('Task archived');
      } catch (err) {
        toast.error('Could not archive', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  const onDeleteOne = useCallback(
    async (taskId: string) => {
      if (!window.confirm('Delete this task? This cannot be undone.')) return;
      try {
        await fetchJson(`/api/tasks/${encodeURIComponent(taskId)}`, {
          method: 'DELETE',
        });
        toast.success('Task deleted');
        selection.remove([taskId]);
      } catch (err) {
        toast.error('Could not delete', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [selection],
  );

  const onStartAgent = useCallback(
    async (taskId: string) => {
      try {
        await fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/start`, {
          method: 'POST',
        });
        toast.success('Agent dispatched');
      } catch (err) {
        toast.error('Could not start agent', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  // --- bulk actions ---
  const onBulkArchive = useCallback(() => {
    const ids = Array.from(selection.selected);
    if (ids.length === 0) return;
    void (async () => {
      try {
        await fetchJson('/api/tasks/bulk', {
          method: 'POST',
          body: { ids, action: 'archive' },
        });
        toast.success(`Archived ${ids.length} task${ids.length === 1 ? '' : 's'}`);
        selection.clear();
      } catch (err) {
        toast.error('Bulk archive failed', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [selection]);

  const onBulkDelete = useCallback(() => {
    const ids = Array.from(selection.selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} task${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) {
      return;
    }
    void (async () => {
      try {
        await fetchJson('/api/tasks/bulk', {
          method: 'POST',
          body: { ids, action: 'delete' },
        });
        toast.success(`Deleted ${ids.length} task${ids.length === 1 ? '' : 's'}`);
        selection.clear();
      } catch (err) {
        toast.error('Bulk delete failed', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [selection]);

  const onBulkMove = useCallback(() => {
    const ids = Array.from(selection.selected);
    if (ids.length === 0) return;
    const target = window.prompt(
      `Move ${ids.length} task${ids.length === 1 ? '' : 's'} to which column?\n` +
        COLUMNS.map((c, i) => `${i + 1}. ${c.title}`).join('\n'),
    );
    if (!target) return;
    const idx = parseInt(target, 10);
    if (!Number.isFinite(idx) || idx < 1 || idx > COLUMNS.length) return;
    const status = COLUMNS[idx - 1].id;
    void (async () => {
      try {
        await fetchJson('/api/tasks/bulk', {
          method: 'POST',
          body: { ids, action: 'move', params: { status } },
        });
        toast.success(`Moved ${ids.length} task${ids.length === 1 ? '' : 's'} to ${COLUMNS[idx - 1].title}`);
        selection.clear();
      } catch (err) {
        toast.error('Bulk move failed', {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [selection]);

  // --- filter chips ---
  const priorityFilters = PRIORITY_OPTIONS.map((p) => ({
    id: `active:priority:${p.value}`,
    label: p.label,
    tone: p.tone,
  }));
  type FilterTone = NonNullable<import('../../ui/kanban/KanbanToolbar.js').KanbanFilter['tone']>;
  const toneForColumn = (tone: KanbanColumnData['accentTone']): FilterTone => {
    if (tone === 'accent' || tone === 'warning' || tone === 'success' || tone === 'danger' || tone === 'info' || tone === 'neutral') return tone;
    return 'neutral';
  };
  const statusFilters = COLUMNS.map((c) => ({
    id: `active:status:${c.id}`,
    label: c.title,
    tone: toneForColumn(c.accentTone),
  }));
  const allFilters = [...priorityFilters, ...statusFilters];

  const onFilterToggle = useCallback((filterId: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filterId)) next.delete(filterId);
      else next.add(filterId);
      return next;
    });
  }, []);

  const onClearFilters = useCallback(() => setActiveFilters(new Set()), []);

  const counts: Record<string, number> = {};
  for (const c of filtered) counts[c.columnId] = (counts[c.columnId] ?? 0) + 1;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        height: '100%',
      }}
    >
      <ViewHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <CheckSquare size={20} aria-hidden="true" />
            Tasks
          </span>
        }
        description={
          error !== null
            ? error
            : 'Drag cards across columns. Right-click for actions. Click to edit.'
        }
        actions={
          <Button
            variant="primary"
            leftIcon={<Plus size={14} aria-hidden="true" />}
            onClick={() => setCreating(true)}
          >
            New task
          </Button>
        }
      />
      <KanbanToolbar
        totalCount={cards.length}
        visibleCount={filtered.length}
        selectedCount={selection.selected.size}
        query={query}
        onQueryChange={setQuery}
        filters={allFilters}
        onFilterToggle={onFilterToggle}
        onClearFilters={onClearFilters}
        onNewTask={() => setCreating(true)}
        onBulkMove={onBulkMove}
        onBulkArchive={onBulkArchive}
        onBulkDelete={onBulkDelete}
        onClearSelection={() => selection.clear()}
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {tasks.loading && cards.length === 0 ? (
          <div style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-3)', flex: 1 }}>
            <Skeleton style={{ width: 280, height: '100%' }} />
            <Skeleton style={{ width: 280, height: '100%' }} />
            <Skeleton style={{ width: 280, height: '100%' }} />
          </div>
        ) : (
          <KanbanBoard
            columns={COLUMNS}
            onCardMove={moveCard}
            selection={selection.selected}
            onSelectionChange={selection.toggle}
            selectionMode={selectionMode}
          >
            {COLUMNS.map((col) => {
              const inColumn = filtered.filter((c) => c.columnId === col.id);
              return (
                <KanbanColumn
                  key={col.id}
                  column={{ ...col, count: counts[col.id] ?? 0 }}
                  onAdd={() => quickAdd(col.id, prompt(`Add task to ${col.title}:`) ?? '')}
                >
                  {inColumn.length === 0 ? (
                    <KanbanEmptyColumn message={`No tasks in ${col.title}`} />
                  ) : (
                    inColumn.map((card) => (
                      <SortableCard
                        key={card.id}
                        card={card}
                        selected={selection.has(card.id)}
                        onSelectionChange={selection.toggle}
                        onOpen={(id) => setOpenTaskId(id)}
                        onMove={onMove}
                        onDuplicate={onDuplicate}
                        onCopyLink={onCopyLink}
                        onArchive={onArchiveOne}
                        onDelete={onDeleteOne}
                        onStart={onStartAgent}
                        showSelection={selectionMode}
                      />
                    ))
                  )}
                  <KanbanQuickAdd
                    onAdd={(title) => quickAdd(col.id, title)}
                    addLabel={`Add to ${col.title}`}
                    placeholder={`Task title in ${col.title}…`}
                  />
                </KanbanColumn>
              );
            })}
          </KanbanBoard>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          size="md"
          title="New task"
          description="Create a task. Drag it to a different column if needed."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            <Field id="new-title" label="Title" required>
              <Input
                id="new-title"
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && newTitle.trim() !== '') {
                    e.preventDefault();
                    void onCreate();
                  }
                }}
              />
            </Field>
            <Field id="new-desc" label="Description">
              <Textarea
                id="new-desc"
                rows={3}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <Field id="new-status" label="Status">
                <Select value={newStatus} onValueChange={(v) => setNewStatus(v as TaskStatus)}>
                  <SelectTrigger id="new-status" />
                  <SelectContent>
                    {COLUMNS.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="new-priority" label="Priority">
                <Select value={newPriority} onValueChange={(v) => setNewPriority(v as TaskPriority)}>
                  <SelectTrigger id="new-priority" />
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={onCreate}
                disabled={newTitle.trim() === ''}
                leftIcon={<Plus size={14} aria-hidden="true" />}
              >
                Create task
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <KanbanDetailDialog
        task={openTaskLive}
        open={openTaskId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenTaskId(null);
        }}
        onTaskUpdated={(t) => {
          setCards((prev) => {
            const idx = prev.findIndex((c) => c.taskId === t.id);
            const card = taskToCard(t);
            if (idx === -1) return [...prev, card];
            const copy = prev.slice();
            copy[idx] = { ...copy[idx], ...card };
            return copy;
          });
        }}
        onTaskDeleted={(id) => {
          setCards((prev) => prev.filter((c) => c.taskId !== id));
          selection.remove([id]);
          setOpenTaskId(null);
        }}
      />
    </div>
  );
}