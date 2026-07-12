/**
 * v8 shell barrel.
 *
 * The shell owns the topbar + sidebar + main content layout. Routing
 * lives in `../App.tsx`; routing only renders shell slots, not vice versa.
 */
export { AppShell, type AppShellProps } from './AppShell.js';
export { Topbar, type TopbarProps } from './Topbar.js';
export {
  Sidebar,
  type SidebarProps,
  type SidebarSection,
  type SidebarItem,
} from './Sidebar.js';
export { StatusBar, type StatusBarProps, type StatusBarTone } from './StatusBar.js';