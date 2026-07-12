/*
 * Badge.tsx — Small status label for the Bizar design system (Wave 2C).
 *
 * Six semantic variants (neutral / info / success / warning / danger /
 * accent) × two sizes (sm / md). Renders inline-flex with a pill radius,
 * 11px font, and the matching `--{variant}-subtle` background with the
 * matching `--{variant}` text color. Stateless — no context provider, no
 * effect — so drop one anywhere without ceremony.
 */

import type { ReactNode } from 'react';
import { cx } from '../utils/cx';

export type BadgeVariant =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'accent';

export type BadgeSize = 'sm' | 'md';

export type BadgeProps = {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: ReactNode;
  className?: string;
};

export function Badge({
  variant = 'neutral',
  size = 'md',
  children,
  className,
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cx(
        'bizar-badge',
        `bizar-badge--${variant}`,
        `bizar-badge--${size}`,
        className,
      )}
    >
      {children}
    </span>
  );
}
