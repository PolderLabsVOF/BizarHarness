import { forwardRef, type HTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';

/**
 * ProgressBar — linear progress indicator.
 *
 * Use cases: Goal progress, task completion, capacity usage.
 * For circular progress use the inline circle ring (S9) or a third-party.
 */

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  /** 0..1 (or 0..100 if `max` is 100). */
  value: number;
  max?: number;
  /** Tone color for the filled portion. */
  tone?: 'accent' | 'info' | 'success' | 'warning' | 'danger';
  /** Render the value as a percentage label on the right. */
  showLabel?: boolean;
  /** Bar height in px. */
  height?: number;
}

const TONE_BG: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  accent: 'var(--accent)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(function ProgressBar(
  props,
  ref,
) {
  const {
    value,
    max = 1,
    tone = 'accent',
    showLabel,
    height = 6,
    className,
    style,
    ...rest
  } = props;
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      ref={ref}
      className={cx('v8-progress', className)}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        ...style,
      }}
      {...rest}
    >
      <div
        style={{
          flex: 1,
          height,
          background: 'var(--surface-2)',
          borderRadius: 'var(--radius-pill)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: TONE_BG[tone],
            borderRadius: 'var(--radius-pill)',
            transition: 'width var(--motion-base) var(--ease-out)',
          }}
        />
      </div>
      {showLabel === true && (
        <span
          style={{
            fontSize: 'var(--fs-12)',
            color: 'var(--fg-muted)',
            fontVariantNumeric: 'tabular-nums',
            minWidth: 32,
            textAlign: 'right',
          }}
        >
          {Math.round(pct)}%
        </span>
      )}
    </div>
  );
});