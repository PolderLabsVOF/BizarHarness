import { createContext, useContext, useState, type ReactNode } from 'react';
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
  /** Set of selected card ids; passed down via context. */
  selection?: ReadonlySet<string>;
  /** Called when the user toggles the selection checkbox on a card. */
  onSelectionChange?: (id: string, next: boolean) => void;
  /** When true, all cards render their selection checkbox always-on. */
  selectionMode?: boolean;
}

/**
 * Context exposed to children of <KanbanBoard> so cards know about the
 * selection state without prop-drilling through every column.
 */
export interface KanbanBoardContextValue {
  selection: ReadonlySet<string>;
  selectionMode: boolean;
  onSelectionChange?: (id: string, next: boolean) => void;
}

export const KanbanBoardContext = createContext<KanbanBoardContextValue>({
  selection: new Set(),
  selectionMode: false,
});

/** Hook for descendants to read the board's selection state. */
export function useKanbanBoard(): KanbanBoardContextValue {
  return useContext(KanbanBoardContext);
}

export function KanbanBoard(props: KanbanBoardProps): JSX.Element {
  const { columns, onCardMove, children, className, selection, onSelectionChange, selectionMode } = props;
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
    <KanbanBoardContext.Provider
      value={{
        selection: selection ?? new Set(),
        selectionMode: selectionMode === true,
        onSelectionChange,
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragEnd={handleDragEnd}
      >
        <div
          className={cx('v8-kanban-board', className)}
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            overflowX: 'auto',
            overflowY: 'hidden',
            height: '100%',
            alignItems: 'stretch',
          }}
          role="region"
          aria-label="Kanban board"
        >
          {children}
        </div>
      </DndContext>
    </KanbanBoardContext.Provider>
  );
}
