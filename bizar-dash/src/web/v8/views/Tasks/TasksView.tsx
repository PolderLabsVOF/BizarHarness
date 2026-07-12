import { useState } from 'react';
import { Stack } from '../../ui/primitives/Stack.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { KanbanBoard } from '../../ui/kanban/KanbanBoard.js';
import { KanbanColumn, type KanbanColumnData } from '../../ui/kanban/KanbanColumn.js';
import { KanbanCard, type KanbanCardData } from '../../ui/kanban/KanbanCard.js';

/**
 * TasksView — the v8 Kanban centerpiece (PLAN.md "Tasks page").
 *
 * The card `id` encodes its column (`<columnId>::<cardId>`) so dnd-kit
 * can resolve drop targets. The visible mapping is held in local state.
 */

interface CardWithCol extends KanbanCardData {
  columnId: string;
}

const COLUMNS: KanbanColumnData[] = [
  { id: 'backlog', title: 'Backlog', accentTone: 'neutral' },
  { id: 'todo', title: 'To do', accentTone: 'info' },
  { id: 'in-progress', title: 'In progress', accentTone: 'accent', wipLimit: 5 },
  { id: 'review', title: 'In review', accentTone: 'warning' },
  { id: 'done', title: 'Done', accentTone: 'success' },
];

const INITIAL_CARDS: CardWithCol[] = [
  { id: 't1', columnId: 'in-progress', title: 'Wire TanStack Router in v8 App', priority: 'high', branch: 'feat/router', due: 'Today', comments: 3 },
  { id: 't2', columnId: 'todo', title: 'Add WebSocket layer for live activity', priority: 'medium', branch: 'feat/ws', due: 'Fri', comments: 1 },
  { id: 't3', columnId: 'review', title: 'Refactor ActivityFeed empty state', priority: 'low', branch: 'fix/activity', comments: 0 },
  { id: 't4', columnId: 'backlog', title: 'Polish Goals page legend', priority: 'low' },
  { id: 't5', columnId: 'done', title: 'Wire command palette at app level', priority: 'urgent', branch: 'feat/palette', due: 'Yesterday', comments: 7 },
];

function cardToId(c: CardWithCol): string {
  return `${c.columnId}::${c.id}`;
}

export function TasksView(): JSX.Element {
  const [cards, setCards] = useState<CardWithCol[]>(INITIAL_CARDS);
  return (
    <Stack gap={4}>
      <ViewHeader
        title="Tasks"
        description="Drag cards across columns. Right-click for actions."
      />
      <KanbanBoard
        columns={COLUMNS}
        onCardMove={(cardId, from, to) => {
          setCards((prev) =>
            prev.map((c) =>
              cardToId(c) === cardId ? { ...c, columnId: to } : c,
            ),
          );
          // The onCardMove callback fires only when the column actually
          // changed; we use this purely for the side effect of advancing
          // the visible mapping.
          void from;
        }}
      >
        {COLUMNS.map((col) => {
          const inColumn = cards.filter((c) => c.columnId === col.id);
          return (
            <KanbanColumn key={col.id} column={{ ...col, count: inColumn.length }}>
              {inColumn.map((card) => (
                <KanbanCard key={cardToId(card)} card={card} />
              ))}
            </KanbanColumn>
          );
        })}
      </KanbanBoard>
    </Stack>
  );
}