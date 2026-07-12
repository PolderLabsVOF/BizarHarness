import { useState, type ReactNode } from 'react';
import { Box } from '../ui/primitives/Box.js';
import { Stack } from '../ui/primitives/Stack.js';
import { Separator } from '../ui/primitives/Separator.js';
import { ScrollArea } from '../ui/primitives/ScrollArea.js';
import {
  Activity,
  Bot,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
  Goal,
  Layers,
  Library,
  Settings as SettingsIcon,
  Target,
  Cpu,
  type LucideIcon,
} from 'lucide-react';
import { cx } from '../ui/utils/cx.js';

/**
 * Sidebar — the 260px collapsible navigation rail.
 *
 * Layout:
 *   ┌─ WORKSPACE ───────────┐
 *   │  Overview             │
 *   │  Tasks           47   │ ◀ active item gets accent-soft bg
 *   │  Goals            3   │
 *   ├─ OPERATIONS ──────────┤
 *   │  Agents          8/16 │
 *   │  Activity   ●  live   │
 *   │  Memory               │
 *   ├─ LIBRARIES ──────────┤
 *   │  Skills          18   │
 *   │  MCPs             3   │
 *   │  Hooks             5  │
 *   ├─ SYSTEM ──────────────┤
 *   │  Settings             │
 *   └───────────────────────┘
 *   ◉ online · v8.0.0
 *
 * Collapsed (60px) state keeps only icons + section dividers.
 * Footer collapses to just the status dot.
 */

export interface SidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Optional count badge (e.g. "47"). */
  count?: number | string;
  /** Active visual state. */
  active?: boolean;
  /** Indicates the item has live activity (pulsing dot). */
  live?: boolean;
  href?: string;
}

export interface SidebarSection {
  id: string;
  label: string;
  items: SidebarItem[];
}

export interface SidebarProps {
  sections?: SidebarSection[];
  /** Default sections if `sections` is omitted — keeps the shell self-contained for F-043. */
  defaultSections?: boolean;
  /** Footer content (e.g. version + build hash). */
  footer?: ReactNode;
  /** Default collapsed state. Persisted to localStorage. */
  defaultCollapsed?: boolean;
  className?: string;
}

const STORAGE_KEY = 'bizar:sidebar:collapsed';

const DEFAULT_SECTIONS: SidebarSection[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'overview', label: 'Overview', icon: Layers },
      { id: 'tasks', label: 'Tasks', icon: CheckSquare, count: 47, active: true },
      { id: 'goals', label: 'Goals', icon: Target, count: 3 },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'agents', label: 'Agents', icon: Bot, count: '8/16' },
      { id: 'activity', label: 'Activity', icon: Activity, live: true },
      { id: 'memory', label: 'Memory', icon: Cpu },
    ],
  },
  {
    id: 'libraries',
    label: 'Libraries',
    items: [
      { id: 'skills', label: 'Skills', icon: Goal, count: 18 },
      { id: 'mcps', label: 'MCPs', icon: Library, count: 3 },
      { id: 'hooks', label: 'Hooks', icon: Layers, count: 5 },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [{ id: 'settings', label: 'Settings', icon: SettingsIcon }],
  },
];

export function Sidebar({
  sections,
  defaultSections = true,
  footer,
  defaultCollapsed,
  className,
}: SidebarProps): JSX.Element {
  const initial =
    defaultCollapsed ??
    (typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === '1');
  const [collapsed, setCollapsed] = useState<boolean>(initial);

  const data = sections ?? (defaultSections ? DEFAULT_SECTIONS : []);
  const width = collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)';

  return (
    <Box
      as="aside"
      role="navigation"
      aria-label="Primary navigation"
      className={cx('v8-sidebar', className)}
      style={{
        width,
        flexShrink: 0,
        height: '100%',
        background: 'var(--sidebar-bg)',
        color: 'var(--sidebar-fg)',
        borderRight: '1px solid var(--sidebar-border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width var(--motion-base) var(--ease-out)',
      }}
    >
      <ScrollArea style={{ flex: 1, padding: 'var(--space-3) var(--space-2)' }}>
        <Stack gap={4}>
          {data.map((section) => (
            <SidebarSectionView key={section.id} section={section} collapsed={collapsed} />
          ))}
        </Stack>
      </ScrollArea>

      <Separator />

      <Box
        style={{
          padding: 'var(--space-3) var(--space-3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 'var(--space-2)',
        }}
      >
        {collapsed ? (
          <Box
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--success)',
            }}
          />
        ) : (
          <>
            <Box style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              <div>◉ online · v8.0.0</div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>build placeholder</div>
            </Box>
            <button
              type="button"
              onClick={() => {
                setCollapsed((c) => {
                  const next = !c;
                  if (typeof window !== 'undefined') {
                    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
                  }
                  return next;
                });
              }}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="v8-sidebar-collapse"
              style={{
                width: 24,
                height: 24,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--fg-muted)',
                background: 'transparent',
                border: '1px solid var(--border)',
              }}
            >
              {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
            </button>
          </>
        )}
      </Box>

      {!collapsed && footer}
    </Box>
  );
}

function SidebarSectionView({
  section,
  collapsed,
}: {
  section: SidebarSection;
  collapsed: boolean;
}): JSX.Element {
  return (
    <Stack gap={1}>
      {!collapsed && (
        <Box
          style={{
            padding: 'var(--space-1) var(--space-3)',
            fontSize: 'var(--fs-12)',
            fontWeight: 600,
            color: 'var(--fg-subtle)',
            letterSpacing: 'var(--tracking-wide)',
            textTransform: 'uppercase',
          }}
        >
          {section.label}
        </Box>
      )}
      {section.items.map((item) => (
        <SidebarItemView key={item.id} item={item} collapsed={collapsed} />
      ))}
    </Stack>
  );
}

function SidebarItemView({ item, collapsed }: { item: SidebarItem; collapsed: boolean }): JSX.Element {
  const Icon = item.icon;
  return (
    <a
      href={item.href ?? '#'}
      aria-current={item.active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={cx('v8-sidebar-item', item.active && 'is-active')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: collapsed ? 'var(--space-2)' : 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--fs-13)',
        color: item.active ? 'var(--fg)' : 'var(--fg-muted)',
        background: item.active ? 'var(--sidebar-hover)' : 'transparent',
        fontWeight: item.active ? 500 : 400,
        justifyContent: collapsed ? 'center' : 'flex-start',
        minHeight: 32,
        transition: 'background var(--motion-fast) var(--ease-out)',
      }}
    >
      <Icon size={16} aria-hidden="true" />
      {!collapsed && (
        <>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.label}
          </span>
          {item.live && (
            <Box
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: 'var(--radius-pill)',
                background: 'var(--success)',
              }}
            />
          )}
          {item.count !== undefined && (
            <Box
              style={{
                fontSize: 'var(--fs-12)',
                color: 'var(--fg-subtle)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {item.count}
            </Box>
          )}
        </>
      )}
    </a>
  );
}