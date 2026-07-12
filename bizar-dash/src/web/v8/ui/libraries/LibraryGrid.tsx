import { type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * LibraryGrid — responsive grid for LibraryItem lists.
 *
 * Renders 1 column on narrow viewports, 2 columns on md, 3 columns on lg.
 * Uses CSS grid + auto-fit; items auto-size to fill available space.
 */

export interface LibraryGridProps {
  children: ReactNode;
  className?: string;
}

export function LibraryGrid(props: LibraryGridProps) {
  const { children, className } = props;
  return (
    <div
      className={cx('v8-library-grid', className)}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))',
        gap: 'var(--space-3)',
      }}
    >
      {children}
    </div>
  );
}