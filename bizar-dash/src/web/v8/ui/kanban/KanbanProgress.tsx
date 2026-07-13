import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * KanbanProgress — compact progress bar for a card or detail panel.
 *
 * Two layouts:
 *   - inline (default): thin 4px bar, optional label on the right.
 *   - block: full-width bar with the percentage label inside.
 *
 * Always clamps `value` to 0-100. Renders nothing for falsy/empty
 * progress so a missing `metadata.progress` doesn't show an empty bar.
 */

export interface KanbanProgressProps {
  /** 0..100. Anything outside the range is clamped. */
  value: number;
  /** Optional label rendered next to the bar (e.g. "42%" or "Writing tests"). */
  label?: ReactNode;
  /** Optional caption rendered above the bar in `block` layout. */
  caption?: ReactNode;
  /** Tone for the filled portion. Defaults to `accent`. */
  tone?: 'accent' | 'info' | 'success' | 'warning' | 'danger';
  layout?: 'inline' | 'block';
  className?: string;
}

const TONE_BG: Record<NonNullable<KanbanProgressProps['tone']>, string> = {
  accent: 'var(--accent)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

export function KanbanProgress(props: KanbanProgressProps): JSX.Element | null {
  const { value, label, caption, tone = 'accent', layout = 'inline', className } = props;
  if (value === undefined || value === null) return null;
  const clamped = Math.max(0, Math.min(100, value));
  if (clamped === 0 && label === undefined && caption === undefined) return null;
  const filled = TONE_BG[tone];

  if (layout === 'block') {
    return (
      <div className={cx('v8-kanban-progress v8-kanban-progress--block', className)}>
        {caption !== undefined && (
          <div
            style={{
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-muted)',
              marginBottom: 4,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--space-2)',
            }}
          >
            <span>{caption}</span>
            {label !== undefined && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{label}</span>}
          </div>
        )}
        <div
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            position: 'relative',
            height: 6,
            borderRadius: 'var(--radius-pill)',
            background: 'color-mix(in oklch, var(--fg-muted) 12%, transparent)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: `${clamped}%`,
              background: filled,
              borderRadius: 'var(--radius-pill)',
              transition: 'width var(--motion-base) var(--ease-out)',
            }}
          />
        </div>
      </div>
    );
  }

  // inline
  return (
    <div
      className={cx('v8-kanban-progress v8-kanban-progress--inline', className)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        fontSize: 'var(--fs-12)',
        color: 'var(--fg-muted)',
      }}
    >
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          flex: 1,
          minWidth: 0,
          position: 'relative',
          height: 4,
          borderRadius: 'var(--radius-pill)',
          background: 'color-mix(in oklch, var(--fg-muted) 12%, transparent)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${clamped}%`,
            background: filled,
            borderRadius: 'var(--radius-pill)',
            transition: 'width var(--motion-base) var(--ease-out)',
          }}
        />
      </div>
      {label !== undefined && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{label}</span>}
    </div>
  );
}
