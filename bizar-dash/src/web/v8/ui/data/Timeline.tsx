import { forwardRef, type OlHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Timeline — vertical event feed (activity, runs, comments).
 *
 * Each item is a dot on a vertical rail + body to the right. Use inside
 * Activity view, Agent detail, or anywhere you'd reach for a feed.
 */

export interface TimelineItem {
  id: string;
  /** Optional leading icon/avatar (rendered inside the dot). */
  icon?: ReactNode;
  /** Tone color for the dot. */
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned timestamp / metadata. */
  meta?: ReactNode;
}

export interface TimelineProps extends OlHTMLAttributes<HTMLOListElement> {
  items: readonly TimelineItem[];
}

const TONE_BG: Record<NonNullable<TimelineItem['tone']>, string> = {
  neutral: 'var(--fg-subtle)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  accent: 'var(--accent)',
};

const TONE_RING: Record<NonNullable<TimelineItem['tone']>, string> = {
  neutral: 'color-mix(in oklch, var(--fg-subtle) 30%, var(--surface-0))',
  info: 'color-mix(in oklch, var(--info) 30%, var(--surface-0))',
  success: 'color-mix(in oklch, var(--success) 30%, var(--surface-0))',
  warning: 'color-mix(in oklch, var(--warning) 30%, var(--surface-0))',
  danger: 'color-mix(in oklch, var(--danger) 30%, var(--surface-0))',
  accent: 'color-mix(in oklch, var(--accent) 30%, var(--surface-0))',
};

export const Timeline = forwardRef<HTMLOListElement, TimelineProps>(function Timeline(props, ref) {
  const { items, className, style, ...rest } = props;
  return (
    <ol
      ref={ref}
      className={cx('v8-timeline', className)}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        ...style,
      }}
      {...rest}
    >
      {items.map((item, idx) => {
        const tone = item.tone ?? 'neutral';
        const isLast = idx === items.length - 1;
        return (
          <li
            key={item.id}
            style={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: '20px 1fr',
              gap: 'var(--space-3)',
              paddingBottom: isLast ? 0 : 'var(--space-4)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: 'relative',
                width: 20,
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              {!isLast && (
                <span
                  style={{
                    position: 'absolute',
                    top: 16,
                    bottom: -16,
                    width: 1,
                    background: 'var(--border)',
                  }}
                />
              )}
              <span
                style={{
                  position: 'relative',
                  width: 14,
                  height: 14,
                  borderRadius: 'var(--radius-pill)',
                  background: TONE_BG[tone],
                  boxShadow: `0 0 0 3px ${TONE_RING[tone]}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 4,
                  fontSize: 10,
                  color: 'var(--bg)',
                }}
              >
                {item.icon}
              </span>
            </span>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--fs-13)', fontWeight: 500, color: 'var(--fg)' }}>{item.title}</div>
                {item.meta !== undefined && (
                  <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-subtle)', flexShrink: 0 }}>{item.meta}</div>
                )}
              </div>
              {item.description !== undefined && (
                <div style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginTop: 2 }}>
                  {item.description}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
});