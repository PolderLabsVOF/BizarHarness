import { Loader2 } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * Spinner — animated loading indicator.
 *
 * Per DESIGN.md §10 the v8 dashboard discourages standalone spinners —
 * prefer <Skeleton> shapes. Use Spinner only inside small controls
 * (Button loading state) or as an inline status indicator.
 */
export interface SpinnerProps {
  size?: number;
  className?: string;
  label?: string;
}

export function Spinner({ size = 16, className, label }: SpinnerProps): JSX.Element {
  return (
    <Loader2
      size={size}
      aria-label={label ?? 'Loading'}
      role="status"
      className={cx('v8-spinner', className)}
      style={{
        color: 'var(--fg-muted)',
        animation: 'v8-spin 0.8s linear infinite',
      }}
    />
  );
}