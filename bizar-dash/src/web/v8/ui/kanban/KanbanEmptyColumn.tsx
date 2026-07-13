import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * KanbanEmptyColumn — drop-zone placeholder shown when a column has
 * 0 cards. Renders a dashed border with a hint, and amplifies the
 * visual when something is being dragged over the column.
 */

export interface KanbanEmptyColumnProps {
  /** Hint shown inside the placeholder. */
  message?: ReactNode;
  /** Forwarded by the column when the body is currently being hovered. */
  isOver?: boolean;
  className?: string;
}

export function KanbanEmptyColumn({
  message = 'Drop a task here',
  isOver = false,
  className,
}: KanbanEmptyColumnProps): JSX.Element {
  return (
    <div
      className={cx('v8-kanban-empty-column', isOver && 'is-over', className)}
      style={{
        flex: 1,
        minHeight: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius)',
        color: 'var(--fg-subtle)',
        fontSize: 'var(--fs-12)',
        background: isOver ? 'color-mix(in oklch, var(--accent) 8%, transparent)' : 'transparent',
        transition: 'background var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out)',
      }}
    >
      {message}
    </div>
  );
}
