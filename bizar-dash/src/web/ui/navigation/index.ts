/*
 * index.ts — Barrel for the Navigation component family (Wave 2B).
 *
 * Imports navigation.css as a side-effect so consumers only need a single
 * `import { NavLink } from '../ui/navigation'` to ship the styles.
 */

import './navigation.css';

export { NavLink, type NavLinkProps } from './NavLink';
export { NavGroup, type NavGroupProps } from './NavGroup';
export {
  CommandPalette,
  type CommandPaletteProps,
  type CommandPaletteItem,
  type CommandPaletteItemType,
} from './CommandPalette';
