import { type ReactNode } from 'react';
import { Box } from '../ui/primitives/Box.js';
import { Inline } from '../ui/primitives/Inline.js';
import { Cluster } from '../ui/primitives/Cluster.js';
import { Separator } from '../ui/primitives/Separator.js';
import { ThemeToggle, DensityToggle } from '../ui/theme/ThemeToggle.js';

/**
 * Topbar — the 56px horizontal bar at the top of the v8 shell.
 *
 * Slots (left → right):
 *   - brand:    Bizar mark + workspace selector
 *   - center:   breadcrumb / page title (filled by parent via `center`)
 *   - actions:  search trigger, command palette hint, theme toggle, density toggle, notifications
 *
 * The topbar is sticky. Border lives at the bottom only (per DESIGN.md §7).
 *
 * This is the foundation shell — concrete slot content is wired in Sprint S4
 * (the navigation sprint). For now, slots are accepted as props so the v8
 * root can render an empty topbar that proves the layout works.
 */

export interface TopbarProps {
  brand?: ReactNode;
  center?: ReactNode;
  /** Right-aligned action cluster. */
  actions?: ReactNode;
  /** Status pill (live/offline). Lives in the right cluster. */
  status?: ReactNode;
}

export function Topbar({ brand, center, actions, status }: TopbarProps): JSX.Element {
  return (
    <Box
      as="header"
      role="banner"
      className="v8-topbar"
      style={{
        height: 'var(--topbar-h)',
        flexShrink: 0,
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        paddingLeft: 'var(--space-4)',
        paddingRight: 'var(--space-4)',
      }}
    >
      <Inline align="center" justify="between" gap={4} style={{ height: '100%' }}>
        {/* left: brand */}
        <Cluster align="center" gap={3}>
          {brand ?? <BrandPlaceholder />}
        </Cluster>

        {/* center: page title / breadcrumb */}
        <Box style={{ flex: 1, minWidth: 0 }}>{center ?? null}</Box>

        {/* right: actions cluster */}
        <Cluster align="center" gap={2}>
          {actions ?? <DefaultActions status={status} />}
        </Cluster>
      </Inline>
    </Box>
  );
}

function BrandPlaceholder(): JSX.Element {
  return (
    <Inline align="center" gap={2}>
      <Box
        style={{
          width: 24,
          height: 24,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--accent)',
          color: 'var(--fg-on-accent)',
          fontWeight: 700,
          fontSize: 'var(--fs-14)',
          lineHeight: '24px',
          textAlign: 'center',
        }}
        aria-hidden="true"
      >
        ᛒ
      </Box>
      <Box style={{ fontWeight: 600, fontSize: 'var(--fs-14)' }}>Bizar</Box>
      <Separator orientation="vertical" style={{ height: 16 }} />
      <Box style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>workspace ▾</Box>
    </Inline>
  );
}

function DefaultActions({ status }: { status?: ReactNode }): JSX.Element {
  return (
    <>
      {status ?? (
        <Inline align="center" gap={1} style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          <Box
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--success)',
            }}
          />
          <span>live</span>
        </Inline>
      )}
      <Separator orientation="vertical" style={{ height: 16 }} />
      <DensityToggle />
      <ThemeToggle />
    </>
  );
}