import type { CSSProperties, ReactNode } from 'react';
import { Stack } from '../primitives/Stack.js';

/**
 * ActivityLanes — horizontal scroller holding a row of `ActivityLane`s.
 *
 * Each lane owns its own width (default 320px). The container scrolls
 * horizontally on overflow. A right-edge fade hint can be enabled via
 * `fade` when lanes are clipped on smaller viewports.
 */
export interface ActivityLanesProps {
  children: ReactNode;
  /** Gap between lanes in px (default 12). */
  gap?: number;
  /** Minimum height for the row; lanes fill the available height. */
  minHeight?: string | number;
  /** When true the rightmost lane fades into a scroll hint. */
  fade?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function ActivityLanes(props: ActivityLanesProps): JSX.Element {
  const { children, gap = 12, minHeight = 480, fade = true, className, style } = props;
  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    gap,
    overflowX: 'auto',
    overflowY: 'hidden',
    padding: 'var(--space-1) var(--space-1) var(--space-2)',
    minHeight,
    WebkitOverflowScrolling: 'touch',
    scrollSnapType: 'x proximity',
    maskImage: fade
      ? 'linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)'
      : undefined,
    ...style,
  };
  return (
    <Stack
      role="region"
      aria-label="Activity lanes"
      data-testid="activity-lanes"
      className={className}
      style={containerStyle}
    >
      {children}
    </Stack>
  );
}
