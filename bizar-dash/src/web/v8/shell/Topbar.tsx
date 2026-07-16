import { useState, type ReactNode } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Box } from '../ui/primitives/Box.js';
import { Inline } from '../ui/primitives/Inline.js';
import { Cluster } from '../ui/primitives/Cluster.js';
import { Separator } from '../ui/primitives/Separator.js';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/feedback/Popover.js';
import { ThemeToggle, DensityToggle } from '../ui/theme/ThemeToggle.js';
import { useFetch } from '../data/useFetch.js';
import { useConnectionState } from '../data/useWebSocket.js';
import { NotificationsPopover } from '../ui/feedback/NotificationsPopover.js';
import { fetchJson, FetchError } from '../data/fetcher.js';

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
  /** Leading slot — renders before brand (hamburger on mobile). */
  leading?: ReactNode;
  center?: ReactNode;
  /** Right-aligned action cluster. */
  actions?: ReactNode;
  /** Status pill (live/offline). Lives in the right cluster. */
  status?: ReactNode;
}

export function Topbar({ leading, brand, center, actions, status }: TopbarProps): JSX.Element {
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
        {/* left: leading (hamburger) + brand */}
        <Cluster align="center" gap={3}>
          {leading}
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
  const projects = useFetch<{ projects?: Array<{ id: string; name?: string }>; active?: string | { id: string } }>('/api/projects');
  const list = projects.data?.projects ?? [];
  const activeId = typeof projects.data?.active === 'string' ? projects.data.active : projects.data?.active?.id;
  const active = list.find((p) => p.id === activeId);
  const label = active?.name || activeId || 'workspace';
  const [open, setOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activate = async (id: string): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await fetchJson(`/api/projects/${encodeURIComponent(id)}/activate`, { method: 'POST' });
      projects.refetch();
      setOpen(false);
    } catch (err) {
      setError(err instanceof FetchError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

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
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Switch project (current: ${label})`}
            aria-haspopup="menu"
            aria-expanded={open}
            data-testid="topbar-project-selector"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface-1)',
              color: 'var(--fg)',
              fontSize: 'var(--fs-13)',
              cursor: 'pointer',
            }}
          >
            <span data-testid="topbar-active-project" title={activeId ?? undefined}>{label}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6}>
          <Box style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 8 }}>
            Switch project
          </Box>
          {list.length === 0 ? (
            <Box style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>No projects registered</Box>
          ) : (
            <ul role="menu" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {list.map((p) => {
                const isActive = p.id === activeId;
                return (
                  <li key={p.id} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={busy !== null}
                      onClick={() => { void activate(p.id); }}
                      data-testid={`topbar-project-option-${p.id}`}
                      aria-current={isActive ? 'true' : undefined}
                      style={{
                        display: 'flex',
                        width: '100%',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 8px',
                        background: isActive ? 'var(--surface-2)' : 'transparent',
                        border: 0,
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--fg)',
                        cursor: busy !== null ? 'wait' : 'pointer',
                        fontSize: 'var(--fs-13)',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name || p.id}
                      </span>
                      {isActive && <span style={{ fontSize: 'var(--fs-11)', color: 'var(--accent)' }}>●</span>}
                      {!isActive && busy === p.id && <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>…</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {error !== null && (
            <Box role="alert" data-testid="topbar-project-error" style={{ marginTop: 8, fontSize: 'var(--fs-12)', color: 'var(--danger)' }}>
              {error}
            </Box>
          )}
        </PopoverContent>
      </Popover>
    </Inline>
  );
}

function DefaultActions({ status }: { status?: ReactNode }): JSX.Element {
  const connected = useConnectionState();
  return (
    <>
      {status ?? (
        <Inline
          align="center"
          gap={1}
          aria-live="polite"
          data-testid="topbar-connection-state"
          style={{
            fontSize: 'var(--fs-12)',
            color: connected ? 'var(--success)' : 'var(--warning)',
          }}
        >
          <Box
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 'var(--radius-pill)',
              background: connected ? 'var(--success)' : 'var(--warning)',
            }}
          />
          <span>{connected ? 'live' : 'offline'}</span>
        </Inline>
      )}
      <Separator orientation="vertical" style={{ height: 16 }} />
      <CommandPaletteTrigger />
      <Separator orientation="vertical" style={{ height: 16 }} />
      <NotificationsPopover />
      <Separator orientation="vertical" style={{ height: 16 }} />
      <DensityToggle />
      <ThemeToggle />
    </>
  );
}

/**
 * CommandPaletteTrigger — a single inline button that opens the command
 * palette. Renders a kbd hint next to the magnifier icon so users discover
 * the ⌘K shortcut. The full palette is wired through `useCommandPaletteHotkey`
 * in App.tsx; this trigger just dispatches the same shortcut keydown.
 */
function CommandPaletteTrigger(): JSX.Element {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const kbd = isMac ? '⌘K' : 'Ctrl K';
  return (
    <button
      type="button"
      onClick={() => {
        // Dispatch the same key the global hotkey listens for so we don't
        // duplicate the open/close logic.
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: isMac, ctrlKey: !isMac, bubbles: true }));
      }}
      aria-label="Open command palette"
      title={`Open command palette (${kbd})`}
      data-testid="topbar-palette-trigger"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        height: 28,
        padding: '0 8px 0 6px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        background: 'var(--surface-1)',
        color: 'var(--fg-muted)',
        fontSize: 'var(--fs-12)',
        cursor: 'pointer',
      }}
    >
      <Search size={14} aria-hidden="true" />
      <span>Search…</span>
      <kbd
        aria-hidden="true"
        style={{
          padding: '1px 4px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          background: 'var(--surface-2)',
          fontSize: 'var(--fs-11)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--fg)',
        }}
      >
        {kbd}
      </kbd>
    </button>
  );
}