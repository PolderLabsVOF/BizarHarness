/*
 * StatTile.tsx — KPI tile for the dashboard hero row (Wave 2B).
 *
 * Compact [icon] [label/value/delta] layout. Whole tile becomes a clickable
 * surface when `href` is supplied (renders an <a>); otherwise a plain <div>.
 * Value uses font-mono + tabular-nums so a row of tiles stays column-aligned
 * even when digit counts change (12 vs 1234). Loading state replaces the
 * value with a shimmer skeleton; everything else stays put.
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cx } from '../utils/cx';

export type StatTileProps = HTMLAttributes<HTMLElement> & {
  label: string;
  value: string | number;
  unit?: string;
  delta?: { value: number; direction: 'up' | 'down' };
  icon?: ReactNode;
  href?: string;
  loading?: boolean;
  className?: string;
};

export function StatTile({
  label,
  value,
  unit,
  delta,
  icon,
  href,
  loading = false,
  className,
  ...rest
}: StatTileProps): React.JSX.Element {
  const Tag = href ? 'a' : 'div';
  // When rendering an <a>, only forward anchor-safe attrs. When rendering a
  // <div>, forward all HTMLAttributes. The intersection avoids TS complaints
  // about ref / event-handler types that differ between the two tags.
  const forwarded = href
    ? ({ href, ...rest } as HTMLAttributes<HTMLElement>)
    : (rest as HTMLAttributes<HTMLElement>);

  return (
    <Tag
      {...forwarded}
      className={cx(
        'bd-stat-tile',
        href && 'bd-stat-tile--clickable',
        className,
      )}
    >
      {icon && <div className="bd-stat-tile__icon">{icon}</div>}
      <div className="bd-stat-tile__body">
        <div className="bd-stat-tile__label">{label}</div>
        <div className="bd-stat-tile__value-row">
          {loading ? (
            <div className="bd-stat-tile__skeleton" aria-hidden="true" />
          ) : (
            <>
              <span className="bd-stat-tile__value">{value}</span>
              {unit && <span className="bd-stat-tile__unit">{unit}</span>}
            </>
          )}
        </div>
        {delta && !loading && (
          <div
            className={cx(
              'bd-stat-tile__delta',
              delta.direction === 'up' && 'bd-stat-tile__delta--up',
              delta.direction === 'down' && 'bd-stat-tile__delta--down',
            )}
            aria-label={`${delta.direction === 'up' ? 'up' : 'down'} ${delta.value}`}
          >
            {delta.direction === 'up' ? (
              <ArrowUp size={12} aria-hidden="true" />
            ) : (
              <ArrowDown size={12} aria-hidden="true" />
            )}
            <span>{delta.value}</span>
          </div>
        )}
      </div>
    </Tag>
  );
}
