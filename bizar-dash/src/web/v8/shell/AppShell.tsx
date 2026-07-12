import { forwardRef, type ReactNode } from 'react';
import { Box } from '../ui/primitives/Box.js';
import { Topbar } from './Topbar.js';
import { Sidebar } from './Sidebar.js';

/**
 * AppShell — the v8 layout skeleton.
 *
 *       ┌──────────────────────────────────────────────────┐
 *       │  Topbar (56px, sticky)                           │
 *       ├────────────┬─────────────────────────────────────┤
 *       │  Sidebar   │  SidebarInset (main content)         │
 *       │  260px     │                                     │
 *       │            │                                     │
 *       │            │                                     │
 *       └────────────┴─────────────────────────────────────┘
 *
 * The SidebarInset caps at max-width 1440px (DESIGN.md §7) and centers
 * itself, with 24px gutters on either side at >=1440px viewports.
 *
 * The ref forwarded from `App.tsx` lands on the `<main>` element so the
 * caller can re-focus it when the route changes (and announce the new
 * route to screen readers). `tabIndex={-1}` makes `<main>` focusable
 * without putting it in the keyboard tab order.
 */

export interface AppShellProps {
  topbar?: ReactNode;
  sidebar?: ReactNode;
  children?: ReactNode;
}

export const AppShell = forwardRef<HTMLElement, AppShellProps>(function AppShell(
  { topbar, sidebar, children },
  ref,
) {
  return (
    <Box
      className="v8-app-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--bg)',
        color: 'var(--fg)',
      }}
    >
      {topbar ?? <Topbar />}

      <Box
        className="v8-app-shell-body"
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0, // critical: lets the body actually scroll instead of expanding
        }}
      >
        {sidebar ?? <Sidebar />}

        <Box
          as="main"
          ref={ref}
          id="main"
          tabIndex={-1}
          className="v8-sidebar-inset"
          role="main"
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'auto',
            background: 'var(--bg)',
            outline: 'none', // visible focus ring handled by :focus-visible
          }}
        >
          <Box
            className="v8-sidebar-inset-inner"
            style={{
              maxWidth: 1440,
              margin: '0 auto',
              padding: 'var(--space-6) var(--space-6)',
              width: '100%',
            }}
          >
            {children}
          </Box>
        </Box>
      </Box>
    </Box>
  );
});
