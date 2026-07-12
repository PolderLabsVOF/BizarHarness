import { forwardRef, type OlHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * ActivityFeed — vertical feed of recent events (the home/dashboard view).
 *
 * Each item: icon + title + optional description + meta (relative time).
 * Tone colors the leading icon chip (mirrors the tone vocabulary used in
 * the rest of the v8 library).
 *
 * Renders as `<ol>` so screen readers announce item count.
 */

export type ActivityTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface ActivityItem {
  id: string;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  tone?: ActivityTone;
}

export interface ActivityFeedProps extends OlHTMLAttributes<HTMLOListElement> {
  items: readonly ActivityItem[];
  /** Optional empty-state node when `items` is empty. */
  empty?: ReactNode;
}

const TONE_BG: Record<ActivityTone, string> = {
  neutral: 'var(--fg-subtle)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

export const ActivityFeed = forwardRef<HTMLOListElement, ActivityFeedProps>(function ActivityFeed(
  props,
  ref,
) {
  const { items, empty, className, ...rest } = props;
  if (items.length === 0 && empty !== undefined) {
    return <>{empty}</>;
  }
  return (
    <ol
      ref={ref}
      className={cx('v8-activity-feed', className)}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
      {...rest}
    >
      {items.map((item) => {
        const tone = item.tone ?? 'neutral';
        return (
          <li
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--space-3)',
              padding: 'var(--space-3)',
              background: 'var(--surface-0)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                borderRadius: 'var(--radius-sm)',
                background: `color-mix(in oklch, ${TONE_BG[tone]} 14%, transparent)`,
                color: TONE_BG[tone],
                flexShrink: 0,
              }}
            >
              {item.icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 'var(--space-2)',
                }}
              >
                <div style={{ fontSize: 'var(--fs-13)', fontWeight: 500, color: 'var(--fg)', minWidth: 0 }}>
                  {item.title}
                </div>
                {item.meta !== undefined && (
                  <div
                    style={{
                      fontSize: 'var(--fs-12)',
                      color: 'var(--fg-subtle)',
                      flexShrink: 0,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {item.meta}
                  </div>
                )}
              </div>
              {item.description !== undefined && (
                <div
                  style={{
                    fontSize: 'var(--fs-12)',
                    color: 'var(--fg-muted)',
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
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