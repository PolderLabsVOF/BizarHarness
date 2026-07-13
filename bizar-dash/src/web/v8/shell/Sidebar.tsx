import { useState, type ReactNode } from 'react';
import { Box } from '../ui/primitives/Box.js';
import { Stack } from '../ui/primitives/Stack.js';
import { Separator } from '../ui/primitives/Separator.js';
import { ScrollArea } from '../ui/primitives/ScrollArea.js';
import {
  Activity,
  Bell,
  Bot,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
  FlaskConical,
  Folder,
  Goal,
  History,
  Layers,
  Library,
  Network,
  ServerCog,
  Settings as SettingsIcon,
  Stethoscope,
  ShieldCheck,
  Variable,
  Wrench,
  Target,
  Cpu,
  Archive,
  BarChart3,
  Terminal,
  MessageSquareText,
  MessageCircle,
  MessageSquare,
  Sparkles,
  Boxes,
  ArrowUpCircle,
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
  /**
   * Fires when the user activates a sidebar item (click, Enter, Space).
   * The Sidebar takes no opinion on what `id` does — `App.tsx` wires it
   * to `setActiveId`. `href` is not navigated (we preventDefault); use
   * a real `<a>` only if you want browser navigation.
   */
  onItemSelect?: (id: string) => void;
  /**
   * Override which item is currently active. If omitted, each item's
   * `active` flag is used as-is (set externally by the consumer).
   */
  activeId?: string;
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
      { id: 'chat', label: 'Chat', icon: MessageSquareText, live: true },
      { id: 'projects-list', label: 'Projects', icon: Folder },
      { id: 'claude-sessions', label: 'Claude sessions', icon: MessageCircle },
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
    items: [
      { id: 'history', label: 'History', icon: History },
      { id: 'admin', label: 'Admin', icon: Wrench },
      { id: 'auth', label: 'Auth', icon: ShieldCheck },
      { id: 'env-vars', label: 'Env vars', icon: Variable },
      { id: 'config', label: 'Config', icon: ServerCog },
      { id: 'dialogs', label: 'Dialogs', icon: MessageSquare },
      { id: 'providers', label: 'Providers', icon: Sparkles },
      { id: 'mods', label: 'Mods', icon: Boxes },
      { id: 'update', label: 'Update', icon: ArrowUpCircle },
      { id: 'doctor', label: 'Doctor', icon: Stethoscope },
      { id: 'usage', label: 'Usage', icon: BarChart3 },
      { id: 'backup', label: 'Backups', icon: Archive },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'diagnostics', label: 'Diagnostics', icon: Terminal },
      { id: 'headroom', label: 'Headroom', icon: Network },
      { id: 'eval', label: 'Eval', icon: FlaskConical },
      { id: 'settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
];

export function Sidebar({
  sections,
  defaultSections = true,
  footer,
  defaultCollapsed,
  onItemSelect,
  activeId,
  className,
}: SidebarProps): JSX.Element {
  const initial =
    defaultCollapsed ??
    (typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === '1');
  const [collapsed, setCollapsed] = useState<boolean>(initial);

  const data = sections ?? (defaultSections ? DEFAULT_SECTIONS : []);
  const width = collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)';

  // Resolve active state: prefer the consumer-supplied `activeId` (state
  // driven); fall back to each item's `active` flag (default sections).
  const isActive = (id: string): boolean =>
    activeId !== undefined ? id === activeId : false;

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
            <SidebarSectionView
              key={section.id}
              section={section}
              collapsed={collapsed}
              onItemSelect={onItemSelect}
              isItemActive={isActive}
            />
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
          <Stack align="center" gap={2}>
            <Box
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: 'var(--radius-pill)',
                background: 'var(--success)',
                boxShadow: '0 0 0 4px color-mix(in oklch, var(--success) 24%, transparent)',
              }}
            />
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
              aria-label="Expand sidebar"
              title="Expand sidebar"
              data-testid="sidebar-expand"
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
                cursor: 'pointer',
              }}
            >
              <ChevronsRight size={14} />
            </button>
          </Stack>
        ) : (
          <>
            <Box style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              <div>◉ online · v8.0.0</div>
              <div
                style={{ fontFamily: 'var(--font-mono)' }}
                title={`build ${import.meta.env.VITE_BUILD_SHA}`}
              >
                build {import.meta.env.VITE_BUILD_SHA}
              </div>
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
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              data-testid="sidebar-collapse"
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
                cursor: 'pointer',
              }}
            >
              <ChevronsLeft size={14} />
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
  onItemSelect,
  isItemActive,
}: {
  section: SidebarSection;
  collapsed: boolean;
  onItemSelect?: (id: string) => void;
  isItemActive: (id: string) => boolean;
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
        <SidebarItemView
          key={item.id}
          item={item}
          collapsed={collapsed}
          active={isItemActive(item.id)}
          onSelect={onItemSelect}
        />
      ))}
    </Stack>
  );
}

function SidebarItemView({
  item,
  collapsed,
  active,
  onSelect,
}: {
  item: SidebarItem;
  collapsed: boolean;
  active: boolean;
  onSelect?: (id: string) => void;
}): JSX.Element {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(item.id)}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      title={collapsed ? item.label : undefined}
      data-sidebar-item={item.id}
      className={cx('v8-sidebar-item', active && 'is-active')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: collapsed ? 'var(--space-2)' : 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--fs-13)',
        color: active ? 'var(--fg)' : 'var(--fg-muted)',
        background: active ? 'var(--sidebar-hover)' : 'transparent',
        fontWeight: active ? 500 : 400,
        justifyContent: collapsed ? 'center' : 'flex-start',
        minHeight: 32,
        // DESIGN.md §7.3 — single permitted edge bar (active item only).
        boxShadow: active ? 'inset 2px 0 0 0 var(--sidebar-accent)' : 'none',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
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
    </button>
  );
}