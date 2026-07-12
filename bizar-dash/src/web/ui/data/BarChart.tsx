/*
 * BarChart.tsx — Horizontal bar chart (Wave 2B).
 *
 * One row per data point: optional label + value header, then a thin
 * filled bar whose width is `value / maxValue * 100%`. Bar colour comes from
 * each datum (defaults to var(--chart-1)) so callers can colour by series
 * via e.g. colorTokens.chart2. No SVG, no chart library — CSS widths only.
 */

import { cx } from '../utils/cx';

export type BarChartDatum = {
  label: string;
  value: number;
  color?: string;
};

export type BarChartProps = {
  data: BarChartDatum[];
  maxValue?: number;
  showLabels?: boolean;
  className?: string;
};

export function BarChart({
  data,
  maxValue,
  showLabels = true,
  className,
}: BarChartProps): React.JSX.Element {
  const computedMax =
    maxValue ?? Math.max(1, ...data.map((d) => d.value));

  return (
    <div className={cx('bd-bar-chart', className)} role="list">
      {data.map((d, i) => {
        const pct = Math.max(0, Math.min(100, (d.value / computedMax) * 100));
        return (
          <div key={`${d.label}-${i}`} role="listitem" className="bd-bar-chart__row">
            {showLabels && (
              <div className="bd-bar-chart__header">
                <span className="bd-bar-chart__label">{d.label}</span>
                <span className="bd-bar-chart__value">{d.value}</span>
              </div>
            )}
            <div className="bd-bar-chart__track" aria-hidden={!showLabels}>
              <div
                className="bd-bar-chart__bar"
                style={{
                  width: `${pct}%`,
                  background: d.color ?? 'var(--chart-1)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
