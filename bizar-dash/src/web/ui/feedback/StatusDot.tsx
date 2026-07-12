/*
 * StatusDot.tsx — Small colored indicator dot (Wave 2C).
 *
 * Renders a 6–8px circle in one of five semantic colors. When `pulse` is
 * true a 2s opacity animation makes the dot appear to "breathe" — used
 * sparingly to call attention to live or in-flight states. No context,
 * no effects — pure styled span.
 */

import { cx } from '../utils/cx';

export type StatusDotVariant =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger';

export type StatusDotSize = 'sm' | 'md';

export type StatusDotProps = {
  variant?: StatusDotVariant;
  size?: StatusDotSize;
  pulse?: boolean;
  className?: string;
  /** Accessible label for screen readers — the dot itself is decorative. */
  label?: string;
};

export function StatusDot({
  variant = 'neutral',
  size = 'md',
  pulse = false,
  className,
  label,
}: StatusDotProps): React.JSX.Element {
  return (
    <span
      className={cx(
        'bizar-status-dot',
        `bizar-status-dot--${variant}`,
        `bizar-status-dot--${size}`,
        pulse && 'bizar-status-dot--pulse',
        className,
      )}
      role={label ? 'status' : 'presentation'}
      aria-label={label}
    />
  );
}
