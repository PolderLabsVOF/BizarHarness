/*
 * Grid.tsx — CSS grid primitive (Wave 2A).
 *
 * Use the explicit `cols` prop (1..12) for fixed-column layouts, or set
 * `autoFit` to flow as many `minmax(180px, 1fr)` columns as fit the
 * container — useful for responsive card walls. `gap` follows the same
 * 0..8 spacing scale as Stack/Inline. `style` is reserved for free-form
 * custom-property overrides (e.g. per-instance --cols-token) — no
 * inline numerics.
 */

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx';

export type GridSpace = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type GridProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  cols?: number;
  gap?: GridSpace;
  autoFit?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
};

export function Grid({
  cols = 1,
  gap = 3,
  autoFit = false,
  className,
  children,
  style,
  ...rest
}: GridProps): React.JSX.Element {
  return (
    <div
      {...rest}
      className={cx(
        'grid',
        !autoFit && `cols-${cols}`,
        autoFit && 'grid-autofit',
        `gap-${gap}`,
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
