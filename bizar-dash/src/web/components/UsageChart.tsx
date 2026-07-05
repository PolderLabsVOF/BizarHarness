// src/web/components/UsageChart.tsx
//
// Hand-rolled SVG chart. No external chart library — keeps bundle small.
//
// Props:
//   series: { labels: string[]; requests: number[]; tokens: number[] }
//   height?: number (default 280)
//   onHover?: (index: number | null, x: number, y: number) => void

import { useCallback, useRef, useState } from 'react';
import { cn } from '../lib/utils';

type Props = {
  series: { labels: string[]; requests: number[]; tokens: number[] };
  height?: number;
  onHover?: (index: number | null, x: number, y: number) => void;
  className?: string;
};

const PADDING = { top: 16, right: 20, bottom: 40, left: 52 };

export function UsageChart({ series, height = 280, onHover, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ index: number; x: number; y: number } | null>(null);

  const { labels, requests, tokens } = series;
  const n = labels.length;
  if (n === 0) {
    return (
      <div className={cn('usage-chart-empty', className)} style={{ height }}>
        <span>No data for this range</span>
      </div>
    );
  }

  const innerW = 600 - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const maxReq = Math.max(...requests, 1);
  const maxTok = Math.max(...tokens, 1);
  // Two separate Y scales (left = requests, right = tokens)
  const barW = Math.max(4, Math.min(24, Math.floor(innerW / n) - 4));
  const gap = (innerW - barW * n) / (n + 1);

  function barX(i: number) {
    return PADDING.left + gap + i * (barW + gap);
  }

  function barH(v: number) {
    return (v / maxReq) * innerH * 0.75;
  }

  function lineY(v: number) {
    return PADDING.top + innerH - (v / maxTok) * innerH * 0.75;
  }

  // Build polyline points for the token line.
  const linePoints = tokens
    .map((v, i) => `${barX(i) + barW / 2},${lineY(v)}`)
    .join(' ');

  // Y-axis ticks (left, requests).
  const leftTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: PADDING.top + innerH - t * innerH * 0.75,
    label: t === 0 ? '0' : `${Math.round(maxReq * t).toLocaleString()}`,
  }));

  // Y-axis ticks (right, tokens).
  const rightTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: PADDING.top + innerH - t * innerH * 0.75,
    label: t === 0 ? '0' : `${Math.round(maxTok * t / 1000)}k`,
  }));

  // X-axis labels (show at most 7 to avoid crowding).
  const labelStep = Math.max(1, Math.floor(n / 7));
  const xLabels = labels.map((l, i) => ({ i, l, x: barX(i) + barW / 2 })).filter((_, i) => i % labelStep === 0);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const svgX = (e.clientX - rect.left) * (600 / rect.width);
      const svgY = (e.clientY - rect.top) * (height / rect.height);
      // Find closest bar.
      const relX = svgX - PADDING.left;
      const i = Math.round((relX - gap / 2) / (barW + gap));
      const clamped = Math.max(0, Math.min(n - 1, i));
      setTooltip({ index: clamped, x: e.clientX - rect.left, y: e.clientY - rect.top });
      onHover?.(clamped, svgX, svgY);
    },
    [n, barW, gap, onHover, height],
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    onHover?.(null, 0, 0);
  }, [onHover]);

  const tip = tooltip;

  return (
    <div ref={containerRef} className={cn('usage-chart', className)} style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 600 ${height}`}
        width="100%"
        height={height}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Grid lines */}
        {leftTicks.map((tick, i) => (
          <line
            key={`grid-${i}`}
            x1={PADDING.left}
            y1={tick.y}
            x2={600 - PADDING.right}
            y2={tick.y}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray="4,3"
            opacity={0.5}
          />
        ))}

        {/* Left Y axis — requests */}
        {leftTicks.map((tick, i) => (
          <text
            key={`ly-${i}`}
            x={PADDING.left - 6}
            y={tick.y + 4}
            textAnchor="end"
            fontSize={10}
            fill="var(--text-muted)"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
          >
            {tick.label}
          </text>
        ))}

        {/* Right Y axis — tokens */}
        {rightTicks.map((tick, i) => (
          <text
            key={`ry-${i}`}
            x={600 - PADDING.right + 6}
            y={tick.y + 4}
            textAnchor="start"
            fontSize={10}
            fill="var(--text-muted)"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
          >
            {tick.label}
          </text>
        ))}

        {/* Bars — requests */}
        {requests.map((v, i) => {
          const bh = barH(v);
          const bx = barX(i);
          const by = PADDING.top + innerH - bh;
          return (
            <rect
              key={`bar-${i}`}
              x={bx}
              y={by}
              width={barW}
              height={bh}
              rx={2}
              fill={tip?.index === i ? 'var(--accent)' : 'var(--accent)'}
              opacity={tip?.index === i ? 1 : 0.75}
              style={{ transition: 'opacity 120ms ease' }}
            />
          );
        })}

        {/* Token line */}
        <polyline
          points={linePoints}
          fill="none"
          stroke="var(--warning, #d29922)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.9}
        />

        {/* Token dots */}
        {tokens.map((v, i) => (
          <circle
            key={`dot-${i}`}
            cx={barX(i) + barW / 2}
            cy={lineY(v)}
            r={tip?.index === i ? 5 : 3}
            fill="var(--warning, #d29922)"
            opacity={tip?.index === i ? 1 : 0.7}
            style={{ transition: 'r 120ms ease' }}
          />
        ))}

        {/* X axis labels */}
        {xLabels.map(({ i, l, x }) => (
          <text
            key={`xl-${i}`}
            x={x}
            y={PADDING.top + innerH + 18}
            textAnchor="middle"
            fontSize={10}
            fill="var(--text-muted)"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
          >
            {l}
          </text>
        ))}

        {/* X axis line */}
        <line
          x1={PADDING.left}
          y1={PADDING.top + innerH}
          x2={600 - PADDING.right}
          y2={PADDING.top + innerH}
          stroke="var(--border)"
          strokeWidth={1}
        />
      </svg>

      {/* Floating tooltip */}
      {tip !== null && (
        <div
          className="usage-chart-tooltip"
          style={{
            left: Math.min(tip.x + 12, 600 - 140),
            top: tip.y - 60,
          }}
        >
          <div className="usage-tooltip-date">{labels[tip.index]}</div>
          <div className="usage-tooltip-row">
            <span className="usage-tooltip-dot" style={{ background: 'var(--accent)' }} />
            <span>Requests:</span>
            <strong>{requests[tip.index].toLocaleString()}</strong>
          </div>
          <div className="usage-tooltip-row">
            <span className="usage-tooltip-dot" style={{ background: 'var(--warning, #d29922)' }} />
            <span>Tokens:</span>
            <strong>{tokens[tip.index].toLocaleString()}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
