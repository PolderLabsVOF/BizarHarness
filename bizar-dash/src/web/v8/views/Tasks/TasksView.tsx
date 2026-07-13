import { useCallback, useState } from 'react';
import { Stack } from '../../ui/primitives/Stack.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { KanbanBoard } from '../../ui/kanban/KanbanBoard.js';
import { KanbanColumn, type KanbanColumnData } from '../../ui/kanban/KanbanColumn.js';
import { KanbanCard, useKanbanCardSortable, type KanbanCardData } from '../../ui/kanban/KanbanCard.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
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
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync fetched list → local state.
  if (tasks.data?.tasks && !initialized) {
    setInitialized(true);
    setCards(tasks.data.tasks.map(taskToCard));
  }

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

  return (
    <Stack gap={4}>
      <ViewHeader
        title="Tasks"
        description="Drag cards across columns. Right-click for actions."
        actions={error ? <span style={{ color: 'var(--danger)' }}>{error}</span> : null}
      />
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
                  <SortableCard key={card.id} card={card} />
                ))}
              </KanbanColumn>
            );
          })}
        </KanbanBoard>
      )}
    </Stack>
  );
}