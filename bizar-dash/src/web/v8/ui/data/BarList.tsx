import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * BarList — horizontal bar list for distributions (e.g. tasks per agent,
 * memory by category). Renders each row as a label + animated bar + value.
 */

export interface BarListItem {
  /** Unique key for React. */
  id: string;
  label: ReactNode;
  value: number;
  /** Optional secondary text (e.g. percentage). */
  hint?: ReactNode;
  /** Optional leading slot (e.g. avatar, icon). */
  leading?: ReactNode;
  /** Override the bar color. */
  color?: string;
}

export interface BarListProps extends HTMLAttributes<HTMLDivElement> {
  items: readonly BarListItem[];
  /** Show numeric values on the right (default true). */
  showValue?: boolean;
  /** Bar height in px (default 6). */
  barHeight?: number;
  /** Cap so the longest bar doesn't visually overwhelm. */
  cap?: number;
}

export const BarList = forwardRef<HTMLDivElement, BarListProps>(function BarList(props, ref) {
  const { items, showValue = true, barHeight = 6, cap, className, style, ...rest } = props;
  const max = cap ?? Math.max(1, ...items.map((i) => i.value));

  return (
    <div
      ref={ref}
      className={cx('v8-bar-list', className)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        ...style,
      }}
      {...rest}
    >
      {items.map((item) => {
        const pct = Math.min(100, (item.value / max) * 100);
        return (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {item.leading !== undefined && (
              <span style={{ flexShrink: 0 }}>{item.leading}</span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', marginBottom: 4 }}>
                <span style={{ fontSize: 'var(--fs-13)', color: 'var(--fg)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
                {showValue === true && (
                  <span
                    style={{
                      fontSize: 'var(--fs-12)',
                      color: 'var(--fg-muted)',
                      fontVariantNumeric: 'tabular-nums',
                      flexShrink: 0,
                    }}
                  >
                    {item.hint ?? item.value}
                  </span>
                )}
              </div>
              <div
                style={{
                  position: 'relative',
                  height: barHeight,
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--radius-pill)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    height: '100%',
                    width: `${pct}%`,
                    background: item.color ?? 'var(--accent)',
                    borderRadius: 'var(--radius-pill)',
                    transition: 'width var(--motion-base) var(--ease-out)',
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});