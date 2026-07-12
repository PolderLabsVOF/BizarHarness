import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * StatTile — a single KPI tile for the overview.
 *
 * Pattern: `[label]   [trend-icon delta]`
 *          `[BIG value]`
 *          `[sparkline?]`
 *
 * Use cases: Overview dashboard, agent detail, goal detail.
 */
export type StatTrend = 'up' | 'down' | 'flat';

export interface StatTileProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  /** Optional delta with trend direction (e.g. "+12%" vs last week). */
  delta?: ReactNode;
  trend?: StatTrend;
  /** Optional helper text under the value. */
  hint?: ReactNode;
  /** Optional icon for the top-right corner. */
  icon?: ReactNode;
  /** Inline sparkline rendered beneath the value (use the Sparkline component). */
  sparkline?: ReactNode;
  /** Loading state — replaces value with skeleton. */
  loading?: boolean;
}

const TREND_FG: Record<StatTrend, string> = {
  up: 'var(--success)',
  down: 'var(--danger)',
  flat: 'var(--fg-muted)',
};

const TREND_ICON: Record<StatTrend, typeof TrendingUp> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

export const StatTile = forwardRef<HTMLDivElement, StatTileProps>(function StatTile(props, ref) {
  const {
    label,
    value,
    delta,
    trend,
    hint,
    icon,
    sparkline,
    loading,
    className,
    style,
    ...rest
  } = props;
  const TrendIcon = trend !== undefined ? TREND_ICON[trend] : null;
  return (
    <div
      ref={ref}
      className={cx('v8-stat-tile', className)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-5)',
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        ...style,
      }}
      {...rest}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <div style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', fontWeight: 500 }}>
          {label}
        </div>
        {icon !== undefined && (
          <span style={{ color: 'var(--fg-subtle)', display: 'inline-flex' }}>{icon}</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
        <div
          style={{
            fontSize: 'var(--fs-24)',
            fontWeight: 600,
            color: 'var(--fg)',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 'var(--lh-tight)',
          }}
        >
          {loading === true ? '—' : value}
        </div>
        {(delta !== undefined || TrendIcon !== null) && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              fontSize: 'var(--fs-12)',
              fontWeight: 500,
              color: trend !== undefined ? TREND_FG[trend] : 'var(--fg-muted)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {TrendIcon !== null && <TrendIcon size={12} aria-hidden="true" />}
            {delta}
          </div>
        )}
      </div>
      {hint !== undefined && (
        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-subtle)' }}>{hint}</div>
      )}
      {sparkline !== undefined && <div style={{ marginTop: 'var(--space-1)' }}>{sparkline}</div>}
    </div>
  );
});

/**
 * StatGrid — responsive grid for StatTiles. Auto-fits 1..4 columns.
 */
export interface StatGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Min tile width (default 200px). */
  minWidth?: number;
  cols?: 2 | 3 | 4;
}

export const StatGrid = forwardRef<HTMLDivElement, StatGridProps>(function StatGrid(props, ref) {
  const { children, cols, minWidth = 200, className, style, ...rest } = props;
  const gridTemplate = cols !== undefined
    ? `repeat(${cols}, minmax(0, 1fr))`
    : `repeat(auto-fit, minmax(${minWidth}px, 1fr))`;
  return (
    <div
      ref={ref}
      className={cx('v8-stat-grid', className)}
      style={{
        display: 'grid',
        gridTemplateColumns: gridTemplate,
        gap: 'var(--space-3)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
});