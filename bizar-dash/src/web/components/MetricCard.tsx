// src/components/MetricCard.tsx — Grafana-style stat card.
//
// v8.0 — Minimalist overhaul. No icon box, no glow, no `--accent-bg`
// fill behind an emoji. Composition:
//   eyebrow label   11px uppercase, --text-dim
//   large numeric   28px weight 700, --text-strong, monospaced
//   sparkline       32px tall, --chart-1 stroke (no gradient)
//   delta + caption metadata row at the bottom
//
// Composes `Card` with variant="metric" so radius + padding follow
// the design tokens for metric surfaces.

import type { ReactNode } from 'react';
import { Card } from './Card';
import { Sparkline } from './Sparkline';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { cn } from '../lib/utils';

export type MetricDelta = {
  value: string;
  direction: 'up' | 'down' | 'flat';
  /** When true, an upward change is "good". Inverts the semantic color. */
  good: boolean;
};

export type MetricCardProps = {
  label: string;
  value: string | number;
  unit?: string;
  sparkline?: number[];
  delta?: MetricDelta;
  caption?: string;
  className?: string;
};

export function MetricCard({
  label,
  value,
  unit,
  sparkline,
  delta,
  caption,
  className,
}: MetricCardProps) {
  const deltaTone =
    !delta ? 'neutral'
    : delta.direction === 'flat'
      ? 'neutral'
      : (delta.direction === 'up') === delta.good
        ? 'good'
        : 'bad';

  return (
    <Card variant="metric" className={cn('metric-card', className)}>
      <div className="metric-card-label">{label}</div>
      <div className="metric-card-value-row">
        <div className="metric-card-value">
          {value}
          {unit ? <span className="metric-card-unit">{unit}</span> : null}
        </div>
        {sparkline && sparkline.length > 0 ? (
          <Sparkline data={sparkline} width={120} height={32} />
        ) : null}
      </div>
      {(delta || caption) && (
        <div className="metric-card-footer">
          {delta ? (
            <span
              className={cn('metric-card-delta', `metric-card-delta-${deltaTone}`)}
              aria-label={`Change: ${delta.value} (${delta.direction})`}
            >
              <DeltaArrow direction={delta.direction} />
              <span className="metric-card-delta-value">{delta.value}</span>
            </span>
          ) : (
            <span />
          )}
          {caption ? <span className="metric-card-caption">{caption}</span> : null}
        </div>
      )}
    </Card>
  );
}

function DeltaArrow({ direction }: { direction: MetricDelta['direction'] }): ReactNode {
  if (direction === 'up') return <ArrowUp size={11} aria-hidden />;
  if (direction === 'down') return <ArrowDown size={11} aria-hidden />;
  return <Minus size={11} aria-hidden />;
}