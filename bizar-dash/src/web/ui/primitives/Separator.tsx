/*
 * Separator.tsx — visual divider (Wave 2A).
 *
 * Renders a true <hr> for the bare case (semantic + accessible) and a
 * div+role=separator with hairline ::before/::after rules when an
 * optional centered label is supplied. Vertical orientation produces
 * a 1px-left-bordered column-suitable rule (caller controls height via
 * parent flex). `label`, if provided, is the label shown between the
 * two hairline halves of a horizontal separator.
 */

import type { ReactNode } from 'react';
import { cx } from '../utils/cx';

export type SeparatorProps = {
  orientation?: 'horizontal' | 'vertical';
  label?: ReactNode;
  className?: string;
};

export function Separator({
  orientation = 'horizontal',
  label,
  className,
}: SeparatorProps): React.JSX.Element {
  if (label !== undefined) {
    return (
      <div
        role="separator"
        aria-orientation={orientation}
        className={cx('separator-with-label', className)}
      >
        <span className="separator-label">{label}</span>
      </div>
    );
  }
  return (
    <hr
      className={cx(
        'separator',
        orientation === 'vertical' && 'separator-vertical',
        className,
      )}
    />
  );
}
