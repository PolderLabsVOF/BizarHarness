import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { KanbanBoard } from '../../ui/kanban/KanbanBoard.js';
import { KanbanColumn, type KanbanColumnData } from '../../ui/kanban/KanbanColumn.js';
import { KanbanCard, useKanbanCardSortable, type KanbanCardData } from '../../ui/kanban/KanbanCard.js';
import { KanbanToolbar, useKanbanSelection, type KanbanFilter } from '../../ui/index.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { TaskDetail } from '../../ui/tasks/TaskDetail.js';
import { Sheet, SheetContent } from '../../ui/feedback/Sheet.js';
import { Input } from '../../ui/controls/Input.js';
import { Textarea } from '../../ui/controls/Textarea.js';
import { Button } from '../../ui/controls/Button.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import type { Task, WsMessage } from '../../data/types.js';

type TaskStatus = NonNullable<Task['status']>;

/**
 * TasksView — Sprint S10. Pulls `/api/tasks` and maps server statuses
 * to v8 kanban columns. Drag a card between columns → PATCH
 * /api/tasks/:id/status. Live updates via `tasks:change`.
 *
 * v10.0.6 — adds KanbanToolbar (search + priority filter chips +
 * bulk-actions row), useKanbanSelection hook (Esc-to-clear), and a
 * 6th "Backlog" column from PR #14.
 */

const COLUMNS: KanbanColumnData[] = [
  { id: 'backlog', title: 'Backlog', accentTone: 'neutral' },
  { id: 'queued', title: 'Queued', accentTone: 'info' },
  { id: 'doing', title: 'In progress', accentTone: 'accent', wipLimit: 5 },
  { id: 'blocked', title: 'In review', accentTone: 'warning' },
  { id: 'done', title: 'Done', accentTone: 'success' },
  { id: 'archived', title: 'Archived', accentTone: 'neutral' },
];

const PRIORITY_MAP: Record<string, KanbanCardData['priority']> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  urgent: 'urgent',
};

interface Card extends KanbanCardData {
  taskId: string;
  columnId: TaskStatus;
}

function taskToCard(t: Task): Card {
  return {
    id: t.id,
    taskId: t.id,
    columnId: statusToColumn(t.status),
    title: t.title,
    priority: PRIORITY_MAP[t.priority || 'medium'] || 'medium',
    branch: t.branch,
    due: t.due,
    comments: t.comments,
    attachments: t.attachments,
  };
}

function statusToColumn(status?: TaskStatus): TaskStatus {
  switch (status) {
    case 'backlog':
    case 'queued':
    case 'doing':
    case 'blocked':
    case 'done':
    case 'archived':
      return status;
    default:
      return 'backlog';
  }
}

/**
 * SortableCard — wraps a single KanbanCard with dnd-kit's useSortable
 * so KanbanBoard.onDragEnd can fire.
 */
function SortableCard({ card }: { card: Card }): JSX.Element {
  const sortable = useKanbanCardSortable(card.id);
  return (
    <KanbanCard
      card={card}
      isDragging={sortable.isDragging}
      dragHandleProps={{ ...sortable.attributes, ...sortable.listeners, ref: sortable.setNodeRef, style: sortable.style }}
    />
  );
}

export function TasksView(): JSX.Element {
  const tasks = useFetch<{ tasks?: Task[]; count?: number }>('/api/tasks');
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const selection = useKanbanSelection();
  const [query, setQuery] = useState<string>('');
  const [activeFilters, setActiveFilters] = useState<ReadonlySet<string>>(new Set());
  const [createDraft, setCreateDraft] = useState<{ title: string; description: string; priority: 'low' | 'medium' | 'high' | 'urgent' } | null>(null);
  const [creating, setCreating] = useState(false);

  const saveCreate = async (): Promise<void> => {
    if (createDraft === null || !createDraft.title.trim()) return;
    setCreating(true);
    try {
      await fetchJson('/api/tasks', { method: 'POST', body: { title: createDraft.title.trim(), description: createDraft.description, priority: createDraft.priority, status: 'queued' } });
      setCreateDraft(null);
      tasks.refetch();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const onWsRemove = useCallback((msg: WsMessage) => {
    const m = msg as { type?: string; id?: string };
    if (m.type !== 'tasks:removed' && m.type !== 'task:removed') return;
    if (!m.id) return;
    setCards((prev) => prev.filter((c) => c.taskId !== m.id));
    selection.remove([m.id]);
    if (openTaskId === m.id) setOpenTaskId(null);
  }, [openTaskId, selection]);
  useWsMessage('tasks:removed', onWsRemove);
  useWsMessage('task:removed', onWsRemove);

  const toggleSelect = (taskId: string): void => {
    selection.toggle(taskId);
  };

  const bulkMove = async (toStatus: TaskStatus): Promise<void> => {
    const ids = Array.from(selection.selected);
    if (ids.length === 0) return;
    setCards((prev) => prev.map((c) => (selection.has(c.taskId) ? { ...c, columnId: toStatus } : c)));
    try {
      await fetchJson('/api/tasks/bulk-status', {
        method: 'PATCH',
        body: { ids, status: toStatus },
      });
      selection.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Sync fetched list → local state. Effect-driven so we don't setState
  // during render (which React warns about under StrictMode and which
  // can double-render the cards).
  useEffect(() => {
    if (tasks.data?.tasks) {
      setCards(tasks.data.tasks.map(taskToCard));
    }
  }, [tasks.data]);

  const onWsChange = useCallback((msg: WsMessage) => {
    if (msg.type !== 'tasks:change') return;
    const t = msg.task as Task | undefined;
    if (!t) return;
    setCards((prev) => {
      const idx = prev.findIndex((c) => c.taskId === t.id);
      const card = taskToCard({ ...t, status: statusToColumn(t.status) });
      if (idx === -1) return [...prev, card];
      const copy = prev.slice();
      copy[idx] = { ...copy[idx], ...card };
      return copy;
    });
  }, []);
  useWsMessage('tasks:change', onWsChange);

  const onCardMove = useCallback(async (cardId: string, _from: string, to: string) => {
    const card = cards.find((c) => c.taskId === cardId || c.id === cardId);
    if (!card) return;
    const nextStatus = statusToColumn(to as TaskStatus);
    setCards((prev) =>
      prev.map((c) => (c.taskId === cardId ? { ...c, columnId: nextStatus } : c)),
    );
    try {
      await fetchJson(`/api/tasks/${encodeURIComponent(card.taskId)}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Roll back on failure.
      setCards((prev) =>
        prev.map((c) => (c.taskId === cardId ? { ...c, columnId: card.columnId } : c)),
      );
    }
  }, [cards]);

  const counts: Record<string, number> = {};
  for (const c of cards) counts[c.columnId] = (counts[c.columnId] || 0) + 1;

  const openTask = openTaskId ? tasks.data?.tasks?.find((t) => t.id === openTaskId) ?? null : null;
  const selectedCount = selection.selected.size;

  // ── v10.0.6 — search + filter chips (PR #14 toolbar wiring) ──
  const filteredCards = useMemo<Card[]>(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (activeFilters.size > 0) {
        if (activeFilters.has(`status:${c.columnId}`) === false) {
          const hasPriority = c.priority !== undefined && activeFilters.has(`priority:${c.priority}`);
          const hasStatus = activeFilters.has(`status:${c.columnId}`);
          if (!hasPriority && !hasStatus) return false;
        }
      }
      if (q !== '') {
        const hay = `${c.title} ${c.description ?? ''}`.toLowerCase();
        if (hay.includes(q) === false) return false;
      }
      return true;
    });
  }, [cards, query, activeFilters]);

  const priorityFilters: KanbanFilter[] = [
    { id: 'priority:low', label: 'Low', tone: 'neutral' },
    { id: 'priority:medium', label: 'Medium', tone: 'info' },
    { id: 'priority:high', label: 'High', tone: 'warning' },
    { id: 'priority:urgent', label: 'Urgent', tone: 'danger' },
  ];
  const statusFilters: KanbanFilter[] = COLUMNS.map((c) => ({ id: `status:${c.id}`, label: c.title as string }));
  const allFilters: KanbanFilter[] = [...priorityFilters, ...statusFilters];

  const onFilterToggle = useCallback((id: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const onClearFilters = useCallback(() => setActiveFilters(new Set()), []);

  return (
    <Stack gap={4} data-testid="tasks-view">
      <ViewHeader
        title="Tasks"
        description="Drag cards across columns. Click a card to edit. Use the checkbox to select multiple."
        actions={
          <Inline gap={2} align="center">
            {error !== null && <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>}
            <Button variant="primary" onClick={() => setCreateDraft({ title: '', description: '', priority: 'medium' })} data-testid="task-create-open">
              <Plus size={14} aria-hidden /> New task
            </Button>
          </Inline>
        }
      />
      {selectedCount > 0 && (
        <KanbanToolbar
          totalCount={cards.length}
          visibleCount={filteredCards.length}
          selectedCount={selectedCount}
          query={query}
          onQueryChange={setQuery}
          filters={allFilters}
          onFilterToggle={onFilterToggle}
          onClearFilters={onClearFilters}
          onNewTask={() => setCreateDraft({ title: '', description: '', priority: 'medium' })}
          onBulkMove={() => void bulkMove('doing')}
          onBulkArchive={() => void bulkMove('archived')}
          onBulkDelete={async () => {
            const ids = Array.from(selection.selected);
            if (ids.length === 0) return;
            if (!window.confirm(`Delete ${ids.length} task${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
            try {
              await fetchJson('/api/tasks/bulk-status', { method: 'PATCH', body: { ids, status: 'archived' } });
              selection.clear();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
          onClearSelection={() => selection.clear()}
        />
      )}
      {tasks.loading && cards.length === 0 ? (
        <Stack gap={3}>
          <Skeleton style={{ height: 120 }} />
          <Skeleton style={{ height: 120 }} />
        </Stack>
      ) : (
        <KanbanBoard columns={COLUMNS} onCardMove={onCardMove}>
          {COLUMNS.map((col) => {
            const inColumn = filteredCards.filter((c) => c.columnId === col.id);
            return (
              <KanbanColumn
                key={col.id}
                column={{ ...col, count: counts[col.id] || 0 }}
              >
                {inColumn.map((card) => (
                  <div key={card.id} style={{ position: 'relative' }}>
                    <input
                      type="checkbox"
                      checked={selection.has(card.taskId)}
                      onChange={() => toggleSelect(card.taskId)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${card.title}`}
                      style={{ position: 'absolute', top: 8, left: 8, zIndex: 2 }}
                    />
                    <div onClick={() => setOpenTaskId(card.taskId)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenTaskId(card.taskId); } }} style={{ cursor: 'pointer' }}>
                      <SortableCard card={card} />
                    </div>
                  </div>
                ))}
              </KanbanColumn>
            );
          })}
        </KanbanBoard>
      )}
      {openTask && (
        <TaskDetail
          task={openTask}
          open={openTaskId !== null}
          onOpenChange={(o) => { if (!o) setOpenTaskId(null); }}
          onDeleted={() => {
            setCards((prev) => prev.filter((c) => c.taskId !== openTask.id));
            setOpenTaskId(null);
          }}
        />
      )}

      {/* v9.2.0 — create-task Sheet. Replaces the missing "new task"
          action that the audit flagged as a HIGH gap. */}
      <Sheet open={createDraft !== null} onOpenChange={(o) => { if (!o) setCreateDraft(null); }}>
        <SheetContent side="right" title="New task">
          {createDraft !== null && (
            <Stack gap={4} style={{ padding: 'var(--space-4)' }}>
              <Stack gap={2}>
                <label htmlFor="task-create-title" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Title</label>
                <Input
                  id="task-create-title"
                  value={createDraft.title}
                  onChange={(e) => setCreateDraft({ ...createDraft, title: e.target.value })}
                  placeholder="What needs doing?"
                  disabled={creating}
                  data-testid="task-create-title"
                />
              </Stack>
              <Stack gap={2}>
                <label htmlFor="task-create-desc" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Description (optional)</label>
                <Textarea
                  id="task-create-desc"
                  value={createDraft.description}
                  onChange={(e) => setCreateDraft({ ...createDraft, description: e.target.value })}
                  rows={4}
                  disabled={creating}
                  data-testid="task-create-desc"
                />
              </Stack>
              <Stack gap={2}>
                <label htmlFor="task-create-priority" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Priority</label>
                <select
                  id="task-create-priority"
                  value={createDraft.priority}
                  onChange={(e) => setCreateDraft({ ...createDraft, priority: e.target.value as typeof createDraft.priority })}
                  disabled={creating}
                  data-testid="task-create-priority"
                  style={{ height: 32, padding: '0 var(--space-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface-0)', color: 'var(--fg)', fontSize: 'var(--fs-13)' }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Stack>
              <Inline gap={2}>
                <Button variant="primary" onClick={() => { void saveCreate(); }} disabled={creating || !createDraft.title.trim()} data-testid="task-create-submit">
                  Create task
                </Button>
                <Button variant="ghost" onClick={() => setCreateDraft(null)} disabled={creating}>
                  Cancel
                </Button>
              </Inline>
            </Stack>
          )}
        </SheetContent>
      </Sheet>
    </Stack>
  );
}