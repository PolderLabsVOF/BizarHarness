/*
 * Sparkline.tsx — Tiny inline SVG line chart (Wave 2B).
 *
 * No axes, no labels, no legend — purely a visual trend strip. Auto-scales
 * any numeric input to its own min/max so a flat-line series still draws a
 * line at mid-height. Renders a soft fill below the line for warmth. Uses
 * CSS variables (var(--chart-1) / var(--accent-subtle) by default) so it
 * picks up theme changes automatically.
 */

export type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  ariaLabel?: string;
  className?: string;
};

function buildPath(
  data: number[],
  width: number,
  height: number,
  padY: number,
): { line: string; area: string; min: number; max: number } {
  if (data.length === 0) {
    return { line: '', area: '', min: 0, max: 0 };
  }
  // Single point or flat-line series → draw at mid-height.
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const innerH = height - padY * 2;
  const innerW = width;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = padY + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');

  const last = points[points.length - 1];
  const first = points[0];
  const area =
    `${line} L${last[0].toFixed(2)},${(height - padY).toFixed(2)} ` +
    `L${first[0].toFixed(2)},${(height - padY).toFixed(2)} Z`;

  return { line, area, min, max };
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  stroke = 'var(--chart-1)',
  fill = 'var(--accent-subtle)',
  ariaLabel,
  className,
}: SparklineProps): React.JSX.Element {
  const padY = 2;
  const { line, area } = buildPath(data, width, height, padY);

  return (
    <svg
      role="img"
      aria-label={ariaLabel ?? `Sparkline of ${data.length} values`}
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {data.length > 0 && (
        <>
          <path className="bd-sparkline__fill" d={area} fill={fill} />
          <path className="bd-sparkline__line" d={line} stroke={stroke} />
        </>
      )}
    </svg>
  );
}
