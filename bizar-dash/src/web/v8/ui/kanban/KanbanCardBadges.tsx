import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * KanbanCardBadges — chip row rendered under the title on a card.
 *
 * Pure presentational. Consumers pass an array of badges; this
 * component handles overflow (caps at `max` and rolls the rest into
 * a "+N" chip).
 */

export interface KanbanCardBadge {
  /** Visible label. */
  label: ReactNode;
  /** Short hint on hover. */
  title?: string;
  /** Tone forwarded to the inline pill. */
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
  /** Optional leading icon (Lucide, 12px). */
  icon?: ReactNode;
}

export interface KanbanCardBadgesProps {
  badges: readonly KanbanCardBadge[];
  /** Maximum number of badges to render before collapsing into "+N". */
  max?: number;
  className?: string;
}

const TONE_FG: Record<NonNullable<KanbanCardBadge['tone']>, string> = {
  neutral: 'var(--fg-muted)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  accent: 'var(--accent)',
};

const TONE_BG: Record<NonNullable<KanbanCardBadge['tone']>, string> = {
  neutral: 'color-mix(in oklch, var(--fg-muted) 12%, transparent)',
  info: 'color-mix(in oklch, var(--info) 14%, transparent)',
  success: 'color-mix(in oklch, var(--success) 14%, transparent)',
  warning: 'color-mix(in oklch, var(--warning) 14%, transparent)',
  danger: 'color-mix(in oklch, var(--danger) 14%, transparent)',
  accent: 'color-mix(in oklch, var(--accent) 14%, transparent)',
};

export function KanbanCardBadges({ badges, max = 4, className }: KanbanCardBadgesProps): JSX.Element | null {
  if (badges.length === 0) return null;
  const visible = badges.slice(0, max);
  const overflow = badges.length - visible.length;
  return (
    <div
      className={cx('v8-kanban-card-badges', className)}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: 'var(--space-2)',
      }}
    >
      {visible.map((b, i) => {
        const tone = b.tone ?? 'neutral';
        return (
          <span
            key={i}
            title={b.title}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 18,
              padding: '0 6px',
              borderRadius: 'var(--radius-pill)',
              background: TONE_BG[tone],
              color: TONE_FG[tone],
              fontSize: 'var(--fs-12)',
              fontWeight: 500,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {b.icon !== undefined && <span style={{ display: 'inline-flex' }}>{b.icon}</span>}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</span>
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 18,
            padding: '0 6px',
            borderRadius: 'var(--radius-pill)',
            background: 'color-mix(in oklch, var(--fg-muted) 12%, transparent)',
            color: 'var(--fg-muted)',
            fontSize: 'var(--fs-12)',
            fontWeight: 500,
            lineHeight: 1,
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
