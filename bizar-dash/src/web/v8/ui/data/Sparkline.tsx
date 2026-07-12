import { forwardRef, type HTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Sparkline — tiny inline line chart.
 *
 * Pure SVG so it composes inside StatTile, Table cells, Card headers
 * without bringing in a chart library dependency.
 */
export interface SparklineProps extends Omit<HTMLAttributes<SVGSVGElement>, 'children'> {
  data: readonly number[];
  width?: number;
  height?: number;
  /** Stroke color (defaults to --accent). */
  stroke?: string;
  /** Optional fill color (defaults to a 14% mix of stroke). */
  fill?: string;
  /** Show the area under the line. */
  area?: boolean;
  /** Goal/expected value rendered as a dashed horizontal line. */
  goal?: number;
}

export const Sparkline = forwardRef<SVGSVGElement, SparklineProps>(function Sparkline(props, ref) {
  const {
    data,
    width = 120,
    height = 32,
    stroke = 'var(--accent)',
    fill,
    area = true,
    goal,
    className,
    style,
    ...rest
  } = props;

  if (data.length < 2) {
    return (
      <svg
        ref={ref}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cx('v8-sparkline', className)}
        style={style}
        aria-hidden="true"
        {...rest}
      />
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const stepX = (width - pad * 2) / (data.length - 1);

  const points = data.map((v, i) => {
    const x = pad + stepX * i;
    const y = pad + (height - pad * 2) * (1 - (v - min) / range);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = area
    ? `${linePath} L${points[points.length - 1]?.x.toFixed(1) ?? '0'},${(height - pad).toFixed(1)} L${points[0]?.x.toFixed(1) ?? '0'},${(height - pad).toFixed(1)} Z`
    : '';

  const fillColor = fill ?? `color-mix(in oklch, ${stroke} 14%, transparent)`;

  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cx('v8-sparkline', className)}
      style={style}
      aria-hidden="true"
      {...rest}
    >
      {area === true && <path d={areaPath} fill={fillColor} stroke="none" />}
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {goal !== undefined && (
        <line
          x1={pad}
          x2={width - pad}
          y1={pad + (height - pad * 2) * (1 - (goal - min) / range)}
          y2={pad + (height - pad * 2) * (1 - (goal - min) / range)}
          stroke="var(--fg-subtle)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
    </svg>
  );
});