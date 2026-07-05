// src/components/EvalRunCard.tsx — v5.2.0
//
// Compact card summarizing a single eval run. Used in the EvalReport's
// left rail to show the recent run history. Click selects the run.
//
// Status rules (per brief):
//   failed === 0            → pass
//   passed/total > 0.8      → warn
//   otherwise               → fail

import type { ReactNode } from 'react';
import { Card, CardTitle, CardMeta } from './Card';
import { cn, formatTime } from '../lib/utils';

/**
 * Summary of an eval run. The fields here are the subset returned by
 * GET /api/eval/runs (the list endpoint) — `results` lives on the full
 * run record returned by GET /api/eval/runs/:id and is not present here.
 */
export type EvalRunSummary = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  suitePath: string;
  total: number;
  passed: number;
  failed: number;
};

export type EvalRunCardProps = {
  run: EvalRunSummary;
  onClick?: () => void;
  /** v5.2.0 — Marks the card as the currently selected run. */
  selected?: boolean;
  /** Optional aria-label override; falls back to the run id. */
  ariaLabel?: string;
};

function pickStatus(run: EvalRunSummary): 'pass' | 'warn' | 'fail' {
  if (run.total <= 0) return 'fail';
  if (run.failed === 0) return 'pass';
  if (run.passed / run.total > 0.8) return 'warn';
  return 'fail';
}

export function EvalRunCard({ run, onClick, selected, ariaLabel }: EvalRunCardProps): ReactNode {
  const status = pickStatus(run);
  // Pass-rate as a fixed-percent string. toFixed guards against locale
  // issues (e.g. some locales use "," as the decimal separator).
  const passRate = run.total > 0
    ? ((run.passed / run.total) * 100).toFixed(1)
    : '0.0';
  const interactive = Boolean(onClick);

  return (
    <Card
      onClick={onClick}
      interactive={interactive}
      aria-label={ariaLabel ?? `Eval run ${run.id}`}
      aria-pressed={interactive ? selected : undefined}
      className={cn(
        'eval-run-card',
        selected && 'eval-run-card-selected',
        `eval-run-${status}`,
      )}
    >
      <div className="eval-run-head">
        <CardTitle className="eval-run-title">{run.id}</CardTitle>
        <span className={cn('eval-status', `is-${status}`)}>
          {run.passed}/{run.total} ({passRate}%)
        </span>
      </div>
      <CardMeta className="eval-run-meta">
        {formatTime(run.startedAt)} · {run.suitePath}
      </CardMeta>
    </Card>
  );
}