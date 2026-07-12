/*
 * layout/index.ts — Barrel export for the Bizar layout primitives (Wave 2C).
 *
 * Side-effect imports ship `layout.css` alongside the JS so consumers
 * only need `import { Topbar, Sidebar } from '../ui/layout'` to mount
 * the visual surface. Exports are deliberately focused — no re-export
 * of legacy components, no prefix collisions.
 */

import './layout.css';

export { AppShell, type AppShellProps } from './AppShell';
export {
  Sidebar,
  type SidebarProps,
  type SidebarGroup,
  type NavLinkProps,
  type NavItemIcon,
} from './Sidebar';
export { Topbar, type TopbarProps } from './Topbar';
export {
  Panel,
  type PanelProps,
  type PanelPadding,
  type PanelVariant,
} from './Panel';
export { PanelHeader, type PanelHeaderProps } from './PanelHeader';
export { Tabs, type TabsProps, type TabDef } from './Tabs';
export {
  Breadcrumbs,
  type BreadcrumbsProps,
  type BreadcrumbItem,
} from './Breadcrumbs';
