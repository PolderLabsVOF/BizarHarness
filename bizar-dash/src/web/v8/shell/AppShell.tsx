import { type ReactNode } from 'react';
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
 * Children render inside SidebarInset. The shell does NOT own the route
 * tree — that's the job of `App.tsx` (which composes AppShell + RouterProvider).
 */

export interface AppShellProps {
  topbar?: ReactNode;
  sidebar?: ReactNode;
  children?: ReactNode;
}

export function AppShell({ topbar, sidebar, children }: AppShellProps): JSX.Element {
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
          id="main"
          className="v8-sidebar-inset"
          role="main"
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'auto',
            background: 'var(--bg)',
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
}