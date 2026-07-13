import { useCallback, useEffect, useState } from 'react';
import { Stack } from '../../ui/primitives/Stack.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { KanbanBoard } from '../../ui/kanban/KanbanBoard.js';
import { KanbanColumn, type KanbanColumnData } from '../../ui/kanban/KanbanColumn.js';
import { KanbanCard, useKanbanCardSortable, type KanbanCardData } from '../../ui/kanban/KanbanCard.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { TaskDetail } from '../../ui/tasks/TaskDetail.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { fetchJson } from '../../data/fetcher.js';
import type { Task, WsMessage } from '../../data/types.js';

type TaskStatus = 'queued' | 'doing' | 'blocked' | 'done' | 'archived';

/**
 * TasksView — Sprint S10. Pulls `/api/tasks` and maps server statuses
 * to v8 kanban columns. Drag a card between columns → PATCH
 * /api/tasks/:id/status. Live updates via `tasks:change`.
 */

const COLUMNS: KanbanColumnData[] = [
  { id: 'queued', title: 'Backlog', accentTone: 'neutral' },
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const onWsRemove = useCallback((msg: WsMessage) => {
    const m = msg as { type?: string; id?: string };
    if (m.type !== 'tasks:removed' && m.type !== 'task:removed') return;
    if (!m.id) return;
    setCards((prev) => prev.filter((c) => c.taskId !== m.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(m.id!);
      return next;
    });
    if (openTaskId === m.id) setOpenTaskId(null);
  }, [openTaskId]);
  useWsMessage('tasks:removed', onWsRemove);
  useWsMessage('task:removed', onWsRemove);

  const toggleSelect = (taskId: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const bulkMove = async (toStatus: TaskStatus): Promise<void> => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setCards((prev) => prev.map((c) => (selectedIds.has(c.taskId) ? { ...c, columnId: toStatus } : c)));
    try {
      await fetchJson('/api/tasks/bulk-status', {
        method: 'PATCH',
        body: { ids, status: toStatus },
      });
      setSelectedIds(new Set());
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
  const selectedCount = selectedIds.size;

  return (
    <Stack gap={4}>
      <ViewHeader
        title="Tasks"
        description="Drag cards across columns. Click a card to edit. Use the checkbox to select multiple."
        actions={error ? <span style={{ color: 'var(--danger)' }}>{error}</span> : null}
      />
      {selectedCount > 0 && (
        <div role="region" aria-label="Bulk actions" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-md)', background: 'color-mix(in oklch, var(--accent) 8%, var(--surface-0))' }}>
          <strong style={{ fontSize: 'var(--fs-13)' }}>{selectedCount} selected</strong>
          <button onClick={() => void bulkMove('doing')} style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-1)', cursor: 'pointer', fontSize: 'var(--fs-12)' }}>Move to In progress</button>
          <button onClick={() => void bulkMove('done')} style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-1)', cursor: 'pointer', fontSize: 'var(--fs-12)' }}>Move to Done</button>
          <button onClick={() => void bulkMove('archived')} style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-1)', cursor: 'pointer', fontSize: 'var(--fs-12)' }}>Archive</button>
          <button onClick={() => setSelectedIds(new Set())} style={{ marginLeft: 'auto', padding: '4px 10px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Clear</button>
        </div>
      )}
      {tasks.loading && cards.length === 0 ? (
        <Stack gap={3}>
          <Skeleton style={{ height: 120 }} />
          <Skeleton style={{ height: 120 }} />
        </Stack>
      ) : (
        <KanbanBoard columns={COLUMNS} onCardMove={onCardMove}>
          {COLUMNS.map((col) => {
            const inColumn = cards.filter((c) => c.columnId === col.id);
            return (
              <KanbanColumn
                key={col.id}
                column={{ ...col, count: counts[col.id] || 0 }}
              >
                {inColumn.map((card) => (
                  <div key={card.id} style={{ position: 'relative' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(card.taskId)}
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
    </Stack>
  );
}