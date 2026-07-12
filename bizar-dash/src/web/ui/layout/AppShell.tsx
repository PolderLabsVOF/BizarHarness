/*
 * AppShell.tsx — Outer shell layout for the Bizar design system (Wave 2C).
 *
 * Composes a sticky topbar above a sidebar + main content area using a CSS
 * grid. Tokens `--layout-sidebar-width` and `--layout-topbar-height` drive
 * the dimensions so theming/sizing changes flow through CSS only. Pass
 * `sidebarCollapsed=true` to collapse the rail (animated width-zero via the
 * `--collapsed` modifier). This component is additive — it does not replace
 * the existing App.tsx shell; old layouts continue to render unchanged.
 */

import type { ReactNode } from 'react';
import { cx } from '../utils/cx';

export type AppShellProps = {
  topbar?: ReactNode;
  sidebar?: ReactNode;
  children?: ReactNode;
  /** When true the sidebar collapses to a 0px rail. Default false. */
  sidebarCollapsed?: boolean;
  /** Optional className on the outermost grid. */
  className?: string;
};

export function AppShell({
  topbar,
  sidebar,
  children,
  sidebarCollapsed = false,
  className,
}: AppShellProps): React.JSX.Element {
  return (
    <div className={cx('bizar-app-shell', className)}>
      {topbar && (
        <div className="bizar-app-shell__topbar">{topbar}</div>
      )}
      {sidebar && !sidebarCollapsed && (
        <aside className="bizar-app-shell__sidebar">{sidebar}</aside>
      )}
      {sidebar && sidebarCollapsed && (
        <aside
          className="bizar-app-shell__sidebar bizar-app-shell__sidebar--collapsed"
          aria-hidden="true"
        />
      )}
      <main className="bizar-app-shell__main">
        <div className="bizar-app-shell__main-inner">{children}</div>
      </main>
    </div>
  );
}
