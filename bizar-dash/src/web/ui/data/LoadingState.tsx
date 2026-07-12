/*
 * LoadingState.tsx — Placeholder for in-flight data (Wave 2B).
 *
 * Two modes: when `rows` is set, renders N skeleton bars (use inside cards
 * and detail panels); otherwise renders a centred spinner with an optional
 * label. Skeleton bars use a shimmer animation that picks up the active
 * theme via the token-driven gradient — no per-mode flag needed.
 */

import { cx } from '../utils/cx';

export type LoadingStateProps = {
  label?: string;
  rows?: number;
  inline?: boolean;
  className?: string;
};

export function LoadingState({
  label,
  rows = 3,
  inline = false,
  className,
}: LoadingStateProps): React.JSX.Element {
  if (rows > 0) {
    return (
      <div
        className={cx(
          'bd-state',
          inline && 'bd-state--inline',
          className,
        )}
        role="status"
        aria-live="polite"
        aria-label={label ?? 'Loading'}
      >
        <div className="bd-skeleton-row" aria-hidden="true">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="bd-skeleton-row__bar" />
          ))}
        </div>
        {label && <div className="bd-state__label">{label}</div>}
      </div>
    );
  }

  return (
    <div
      className={cx(
        'bd-state',
        inline && 'bd-state--inline',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
    >
      <div
        className={cx('bd-spinner', inline && 'bd-spinner--inline')}
        aria-hidden="true"
      />
      {label && <div className="bd-state__label">{label}</div>}
    </div>
  );
}
