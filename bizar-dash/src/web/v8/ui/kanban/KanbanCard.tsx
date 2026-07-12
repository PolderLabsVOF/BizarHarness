import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, MessageSquare, Paperclip, GitBranch } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * KanbanCard — the primary surface of the v8 dashboard.
 *
 * Built per DESIGN.md §6: compact metadata, never decorative, drag-handle
 * is the whole card, every card has a right-click context menu.
 *
 * Variants:
 *   - default:  full metadata row (date, comments, attachments, branch)
 *   - compact:  title + 1 priority dot only (for crowded boards)
 *   - detailed: title + description preview + metadata
 */

export type KanbanCardVariant = 'default' | 'compact' | 'detailed';

export type KanbanPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface KanbanCardData {
  id: string;
  title: string;
  description?: string;
  priority?: KanbanPriority;
  /** Due date as ISO string or relative phrase ("Today", "Tomorrow"). */
  due?: string;
  /** Number of comments; renders icon + count. */
  comments?: number;
  /** Number of attachments. */
  attachments?: number;
  /** Branch name to show in the meta row. */
  branch?: string;
  /** IDs of assigned agents/users; rendered as AvatarStack. */
  assignees?: readonly string[];
  /** Tone of the leading priority stripe. */
  accentTone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
  /** Custom badge / chip to render after the title. */
  badges?: ReactNode;
}

export interface KanbanCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'id'> {
  card: KanbanCardData;
  variant?: KanbanCardVariant;
  /** When true, the card is being dragged (visual lift + shadow). */
  isDragging?: boolean;
  /** Drag handlers from useSortable (omit to make the card non-draggable). */
  dragHandleProps?: Record<string, unknown>;
}

const PRIORITY_FG: Record<KanbanPriority, string> = {
  low: 'var(--fg-subtle)',
  medium: 'var(--info)',
  high: 'var(--warning)',
  urgent: 'var(--danger)',
};

const PRIORITY_LABEL: Record<KanbanPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const ACCENT_FG: Record<NonNullable<KanbanCardData['accentTone']>, string> = {
  neutral: 'var(--fg-subtle)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  accent: 'var(--accent)',
};

export const KanbanCard = forwardRef<HTMLDivElement, KanbanCardProps>(function KanbanCard(
  props,
  ref,
) {
  const { card, variant = 'default', isDragging, dragHandleProps, className, style, ...rest } =
    props;

  return (
    <div
      ref={ref}
      data-kanban-card-id={card.id}
      className={cx('v8-kanban-card', `v8-kanban-card--${variant}`, isDragging && 'is-dragging', className)}
      style={{
        position: 'relative',
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--space-3)',
        boxShadow: isDragging === true ? 'var(--shadow-3)' : 'none',
        transform: isDragging === true ? 'rotate(1.5deg)' : undefined,
        transition: 'box-shadow var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out)',
        ...style,
      }}
      {...(dragHandleProps as Record<string, unknown>)}
      {...rest}
    >
      {/* Leading accent stripe — colored by priority or accentTone. */}
      {variant !== 'compact' && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 6,
            bottom: 6,
            width: 3,
            borderRadius: '0 var(--radius-pill) var(--radius-pill) 0',
            background:
              card.priority !== undefined
                ? PRIORITY_FG[card.priority]
                : ACCENT_FG[card.accentTone ?? 'neutral'],
          }}
        />
      )}
      <div style={{ paddingLeft: variant !== 'compact' ? 'var(--space-2)' : 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-2)',
            marginBottom: variant === 'detailed' ? 'var(--space-2)' : 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 'var(--fs-13)',
                fontWeight: 500,
                color: 'var(--fg)',
                lineHeight: 'var(--lh-snug)',
              }}
            >
              {card.title}
            </div>
            {variant === 'detailed' && card.description !== undefined && (
              <div
                style={{
                  fontSize: 'var(--fs-12)',
                  color: 'var(--fg-muted)',
                  marginTop: 'var(--space-1)',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {card.description}
              </div>
            )}
          </div>
          {card.priority !== undefined && (
            <span
              aria-label={`Priority: ${PRIORITY_LABEL[card.priority]}`}
              style={{
                width: 8,
                height: 8,
                borderRadius: 'var(--radius-pill)',
                background: PRIORITY_FG[card.priority],
                flexShrink: 0,
                marginTop: 6,
              }}
            />
          )}
        </div>
        {card.badges !== undefined && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
            {card.badges}
          </div>
        )}
        {variant !== 'compact' &&
          (card.due !== undefined ||
            card.comments !== undefined ||
            card.attachments !== undefined ||
            card.branch !== undefined) && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                marginTop: 'var(--space-2)',
                fontSize: 'var(--fs-12)',
                color: 'var(--fg-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {card.due !== undefined && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Calendar size={12} aria-hidden="true" />
                  {card.due}
                </span>
              )}
              {card.comments !== undefined && card.comments > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <MessageSquare size={12} aria-hidden="true" />
                  {card.comments}
                </span>
              )}
              {card.attachments !== undefined && card.attachments > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Paperclip size={12} aria-hidden="true" />
                  {card.attachments}
                </span>
              )}
              {card.branch !== undefined && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontFamily: 'var(--font-mono)',
                  }}
                  title={card.branch}
                >
                  <GitBranch size={12} aria-hidden="true" />
                  {card.branch}
                </span>
              )}
            </div>
          )}
      </div>
    </div>
  );
});

/**
 * useKanbanCardSortable — convenience hook wrapping @dnd-kit/sortable's
 * useSortable for a card. Returns props to spread onto <KanbanCard>.
 */
export function useKanbanCardSortable(id: string) {
  const sortable = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return {
    attributes: sortable.attributes,
    listeners: sortable.listeners,
    setNodeRef: sortable.setNodeRef,
    isDragging: sortable.isDragging,
    style,
  };
}