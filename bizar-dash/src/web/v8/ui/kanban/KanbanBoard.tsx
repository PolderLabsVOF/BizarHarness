import { useState, type ReactNode } from 'react';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { cx } from '../utils/cx.js';

/**
 * KanbanBoard — horizontal-scrolling board hosting multiple columns.
 *
 * The board owns drag state. It receives:
 *   - columns: definition + droppable ids
 *   - renderColumn: function that takes column data + isOver flag + children
 *   - onCardMove: invoked when a card moves between columns (or reorders within)
 *
 * For most cases, prefer using the higher-level `KanbanBoardSimple` wrapper
 * which handles the dnd-kit boilerplate for you.
 */

export interface KanbanBoardProps {
  columns: readonly { id: string }[];
  onCardMove?: (cardId: string, fromColumnId: string, toColumnId: string) => void;
  children: ReactNode;
  className?: string;
}

export function KanbanBoard({ columns, onCardMove, children, className }: KanbanBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [, setActiveId] = useState<string | null>(null);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (over === null) return;
    const cardId = String(active.id);
    const targetId = String(over.id);
    // The "over" can be a column id (drop on empty) or another card id.
    const toColumn = columns.find((c) => c.id === targetId)?.id ?? cardId.split('::')[0];
    if (toColumn === undefined) return;
    const fromColumn = cardId.split('::')[0] ?? '';
    if (fromColumn !== toColumn && onCardMove !== undefined) {
      onCardMove(cardId, fromColumn, toColumn);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
    >
      <div
        className={cx('v8-kanban-board', className)}
        style={{
          display: 'grid',
          gridAutoFlow: 'column',
          gridAutoColumns: 'minmax(320px, 1fr)',
          gap: 'var(--space-4)',
          padding: 'var(--space-4) var(--space-5)',
          overflowX: 'auto',
          overflowY: 'hidden',
          height: '100%',
          width: '100%',
          alignItems: 'stretch',
        }}
        role="region"
        aria-label="Kanban board"
      >
        {children}
      </div>
    </DndContext>
  );
}