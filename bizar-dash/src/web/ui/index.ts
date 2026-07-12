/*
 * index.ts — Barrel export for the Bizar design system.
 *
 * One stop for every primitive, control, data, layout, navigation, and
 * feedback component. Side-effect CSS imports ship every stylesheet
 * (reset + tokens + globals) to any consumer that imports from this
 * module graph. The legacy main.css also imports globals.css directly
 * so non-TS code paths still get the tokens via the CSS pipeline alone.
 *
 * Naming collision: `layout/Sidebar` re-exports its own `NavLinkProps`
 * (self-contained Sidebar.tsx, doesn't depend on navigation/NavLink to
 * avoid a parallel-Wave 2 dependency cycle). We intentionally drop
 * layout's `NavLinkProps` here and re-export `navigation/NavLink`'s
 * canonical `NavLinkProps` instead — the two have identical shape but
 * the navigation one is the public API.
 */

// foundation styles (side-effect)
import './styles/reset.css';
import './styles/tokens.css';
import './styles/globals.css';

// theme
export { ThemeProvider, type Theme } from './theme/ThemeProvider';
export type { ThemeContextValue } from './theme/ThemeProvider';
export { useTheme } from './theme/useTheme';
export * as tokens from './theme/tokens';

// utils
export { cx, type ClassValue } from './utils/cx';

// primitives
export * from './primitives';

// controls
export * from './controls';

// data
export * from './data';

// navigation (must come before layout — its NavLinkProps is canonical)
export * from './navigation';

// layout (selective: drop layout's shadow NavLinkProps in favour of navigation's)
export {
  AppShell, type AppShellProps,
  Sidebar, type SidebarProps, type SidebarGroup, type NavItemIcon,
  Topbar, type TopbarProps,
  Panel, type PanelProps, type PanelPadding, type PanelVariant,
  PanelHeader, type PanelHeaderProps,
  ViewHeader, type ViewHeaderProps,
  Tabs, type TabsProps, type TabDef,
  Breadcrumbs, type BreadcrumbsProps, type BreadcrumbItem,
} from './layout';

// feedback
export * from './feedback';
