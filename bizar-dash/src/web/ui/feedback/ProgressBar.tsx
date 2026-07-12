/*
 * ProgressBar.tsx — Horizontal progress indicator (Wave 2C).
 *
 * Three modes:
 *   - Determinate (`value` 0..max): width = `value / max` percent.
 *   - Indeterminate: a 25%-wide bar slides across the track infinitely.
 *   - Without any inputs: renders a 0% determinate bar (callers should
 *     pass `indeterminate` for spinner-style states).
 *
 * Accessible: a `role="progressbar"` element with `aria-valuenow`,
 * `aria-valuemin`, `aria-valuemax`. Indeterminate progress passes
 * `aria-valuenow={undefined}` per the ARIA spec so assistive tech knows
 * not to read a value.
 */

import type { ReactNode } from 'react';
import { cx } from '../utils/cx';

export type ProgressVariant = 'neutral' | 'accent' | 'success' | 'danger';
export type ProgressSize = 'sm' | 'md' | 'lg';

export type ProgressBarProps = {
  value?: number;
  max?: number;
  indeterminate?: boolean;
  size?: ProgressSize;
  variant?: ProgressVariant;
  label?: ReactNode;
  className?: string;
};

export function ProgressBar({
  value = 0,
  max = 100,
  indeterminate = false,
  size = 'md',
  variant = 'accent',
  label,
  className,
}: ProgressBarProps): React.JSX.Element {
  const safeMax = max > 0 ? max : 100;
  const clamped = Math.max(0, Math.min(value, safeMax));
  const pct = (clamped / safeMax) * 100;

  return (
    <div className={cx('bizar-progress-wrap', className)}>
      {label !== undefined && (
        <span className="bizar-progress__label">{label}</span>
      )}
      <div
        className={cx(
          'bizar-progress',
          `bizar-progress--${size}`,
          indeterminate && 'bizar-progress--indeterminate',
        )}
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : clamped}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : safeMax}
        aria-label={typeof label === 'string' ? label : undefined}
      >
        <div
          className={cx('bizar-progress__fill', `bizar-progress__fill--${variant}`)}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
