// src/components/Sparkline.tsx — clean inline-SVG sparkline.
//
// v8.0 — Minimalist overhaul. No gradients, no glow, no decorative
// fills. The stroke is a single solid 1.5px line in `--chart-1`. An
// optional area fill (controlled by `withArea`) is rendered with a
// low-opacity solid color — never a gradient, per DESIGN.md §2.

import { useMemo } from 'react';

export type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  /** When true, render a low-opacity solid fill beneath the stroke. */
  withArea?: boolean;
};

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = 'var(--chart-1)',
  strokeWidth = 1.5,
  withArea = true,
}: SparklineProps) {
  const { d, area, dot } = useMemo(() => {
    if (!data || data.length === 0) {
      return { d: '', area: '', dot: null as null | { x: number; y: number } };
    }
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const pad = strokeWidth;
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;
    const step = data.length > 1 ? innerW / (data.length - 1) : 0;

    const points = data.map((v, i) => {
      const x = pad + (data.length === 1 ? innerW / 2 : i * step);
      const y = pad + innerH - ((v - min) / span) * innerH;
      return { x, y };
    });

    const linePath = points
      .map((p, i) => (i === 0 ? `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}` : `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`))
      .join(' ');

    const first = points[0];
    const last = points[points.length - 1];
    const fillPath = withArea
      ? `${linePath} L ${last.x.toFixed(2)} ${(height - pad).toFixed(2)} L ${first.x.toFixed(2)} ${(height - pad).toFixed(2)} Z`
      : '';

    const lastPoint = points[points.length - 1];
    return { d: linePath, area: fillPath, dot: lastPoint };
  }, [data, width, height, strokeWidth, withArea]);

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {withArea ? (
        <path
          d={area}
          fill={color}
          fillOpacity={0.12}
          stroke="none"
        />
      ) : null}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {dot ? (
        <circle cx={dot.x} cy={dot.y} r={strokeWidth * 0.9} fill={color} />
      ) : null}
    </svg>
  );
}