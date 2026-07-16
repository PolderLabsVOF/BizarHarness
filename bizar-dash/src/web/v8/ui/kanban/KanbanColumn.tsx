import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Plus, MoreHorizontal } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * KanbanColumn — a single status column on the kanban board.
 *
 * Built per DESIGN.md §6: title row with count + actions, scrollable
 * card list, "+ Add" quick-add affordance at the bottom.
 */

export interface KanbanColumnData {
  id: string;
  title: ReactNode;
  /** Optional small description below the title. */
  description?: ReactNode;
  /** Number of cards in the column; auto-counted if not provided. */
  count?: number;
  /** WIP limit. When set, the column header shows the limit and warns when exceeded. */
  wipLimit?: number;
  /** Tone for the column header accent bar. */
  accentTone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
}

export interface KanbanColumnProps extends HTMLAttributes<HTMLElement> {
  column: KanbanColumnData;
  /** Cards rendered inside the column body. */
  children?: ReactNode;
  /** Click handler for the "+" add button. */
  onAdd?: () => void;
  /** Click handler for the "⋯" overflow button. */
  onOverflow?: () => void;
  /** WIP limit warning state. */
  exceedsWip?: boolean;
}

const ACCENT_FG: Record<NonNullable<KanbanColumnData['accentTone']>, string> = {
  neutral: 'var(--fg-subtle)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  accent: 'var(--accent)',
};

export const KanbanColumn = forwardRef<HTMLElement, KanbanColumnProps>(function KanbanColumn(
  props,
  ref,
) {
  const { column, children, onAdd, onOverflow, exceedsWip, className, style, ...rest } = props;
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <section
      ref={ref}
      className={cx('v8-kanban-column', isOver && 'is-over', className)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 280,
        flexShrink: 0,
        background: 'var(--surface-0)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        height: '100%',
        ...style,
      }}
      aria-label={typeof column.title === 'string' ? column.title : undefined}
      {...rest}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-3)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: 'var(--radius-pill)',
            background: ACCENT_FG[column.accentTone ?? 'neutral'],
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 'var(--fs-13)',
              fontWeight: 600,
              color: 'var(--fg)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {column.title}
          </div>
          {(column.count !== undefined || column.wipLimit !== undefined) && (
            <div
              style={{
                fontSize: 'var(--fs-12)',
                color:
                  exceedsWip === true
                    ? 'var(--danger)'
                    : 'var(--fg-subtle)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {column.count ?? 0}
              {column.wipLimit !== undefined && ` / ${column.wipLimit}`}
            </div>
          )}
        </div>
        {onOverflow !== undefined && (
          <button
            type="button"
            onClick={onOverflow}
            aria-label="Column options"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              background: 'transparent',
              border: 0,
              borderRadius: 'var(--radius-sm)',
              color: 'var(--fg-muted)',
              cursor: 'pointer',
            }}
          >
            <MoreHorizontal size={14} aria-hidden="true" />
          </button>
        )}
        {onAdd !== undefined && (
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add card"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              background: 'transparent',
              border: 0,
              borderRadius: 'var(--radius-sm)',
              color: 'var(--fg-muted)',
              cursor: 'pointer',
            }}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        )}
      </header>
      <div
        ref={setNodeRef}
        className="v8-kanban-column__body"
        style={{
          flex: 1,
          minHeight: 0,
          padding: 'var(--space-2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          overflowY: 'auto',
          background: isOver ? 'color-mix(in oklch, var(--accent) 6%, transparent)' : 'transparent',
          transition: 'background var(--motion-fast) var(--ease-out)',
        }}
      >
        {children}
      </div>
    </section>
  );
});