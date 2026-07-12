import { type HTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Skeleton — a placeholder that pulses while content loads.
 *
 * Per DESIGN.md §10: NEVER use a spinner labelled "Loading…". Use
 * skeleton shapes that mirror the final content (text widths, card
 * outlines, chart frames).
 */
export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: number | string;
  height?: number | string;
  radius?: 'sm' | 'md' | 'pill';
}

export function Skeleton({
  width = '100%',
  height = 16,
  radius = 'sm',
  className,
  style,
  ...rest
}: SkeletonProps): JSX.Element {
  const radiusValue = radius === 'sm' ? 'var(--radius-sm)' : radius === 'pill' ? 'var(--radius-pill)' : 'var(--radius)';
  return (
    <div
      className={cx('v8-skeleton', className)}
      style={{
        display: 'inline-block',
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        background:
          'linear-gradient(90deg, var(--surface-1) 0%, var(--surface-2) 50%, var(--surface-1) 100%)',
        backgroundSize: '200% 100%',
        borderRadius: radiusValue,
        animation: 'v8-skeleton-pulse 1.4s ease-in-out infinite',
        ...style,
      }}
      aria-hidden="true"
      {...rest}
    />
  );
}

/**
 * SkeletonText — multi-line text placeholder.
 */
export interface SkeletonTextProps {
  lines?: number;
  /** Width of the last line (defaults to 60%). */
  lastLineWidth?: string;
}

export function SkeletonText({ lines = 3, lastLineWidth = '60%' }: SkeletonTextProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? lastLineWidth : '100%'}
          height={12}
        />
      ))}
    </div>
  );
}