/*
 * ErrorState.tsx — Inline error block for data contexts (Wave 2B).
 *
 * Compact, actionable error display. Shows a danger-coloured error string
 * (stringified if an Error object is passed) inside a subtle tinted box so
 * the eye finds it without breaking the layout. Optional `onRetry` adds a
 * primary "Try again" CTA button.
 */

import { AlertTriangle } from 'lucide-react';
import { cx } from '../utils/cx';

export type ErrorStateProps = {
  title?: string;
  error: Error | string;
  onRetry?: () => void;
  inline?: boolean;
  className?: string;
};

function stringifyError(err: Error | string): string {
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  return err.name || 'Unknown error';
}

export function ErrorState({
  title = 'Something went wrong',
  error,
  onRetry,
  inline = false,
  className,
}: ErrorStateProps): React.JSX.Element {
  const message = stringifyError(error);
  return (
    <div
      className={cx('bd-state', inline && 'bd-state--inline', className)}
      role="alert"
    >
      <div className="bd-state__icon" aria-hidden="true">
        <AlertTriangle size={28} />
      </div>
      <div className="bd-state__title">{title}</div>
      <div className="bd-state__error">{message}</div>
      {onRetry && (
        <button
          type="button"
          className="bd-state__action"
          onClick={onRetry}
        >
          Try again
        </button>
      )}
    </div>
  );
}
