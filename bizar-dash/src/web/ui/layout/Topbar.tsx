/*
 * Topbar.tsx — Header bar for the Bizar design system (Wave 2C).
 *
 * Three horizontal slots: brand (left), center (typically a search input),
 * right (actions / notifications). Height comes from `--layout-topbar-height`
 * (default 48px) and `sticky=true` (default) pins the bar to the top of
 * the viewport via `position: sticky` and `--z-sticky`. Visual chrome is
 * minimal: a single hairline border-bottom in `--border-subtle`.
 */

import type { ReactNode } from 'react';
import { cx } from '../utils/cx';

export type TopbarProps = {
  brand?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  height?: number;
  sticky?: boolean;
  className?: string;
};

export function Topbar({
  brand,
  center,
  right,
  height,
  sticky = true,
  className,
}: TopbarProps): React.JSX.Element {
  return (
    <header
      className={cx('bizar-topbar', sticky && 'bizar-topbar--sticky', className)}
      style={height ? { height } : undefined}
      role="banner"
    >
      <div className="bizar-topbar__brand">{brand}</div>
      {center && <div className="bizar-topbar__center">{center}</div>}
      {right && <div className="bizar-topbar__right">{right}</div>}
    </header>
  );
}
