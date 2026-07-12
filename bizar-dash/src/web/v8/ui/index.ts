/**
 * v8 UI barrel — public surface of the v8 component library.
 *
 * Naming convention:
 *   - layouts/primitives → exported directly
 *   - controls/*         → Sprint S2
 *   - feedback/*         → Sprint S2
 *   - data/*             → Sprint S3
 *   - navigation/*       → Sprint S4
 *   - kanban/*           → Sprint S5 (centerpiece)
 *
 * Always import from this barrel — never reach into individual files.
 * That keeps refactors inside the v8 tree trivial.
 */

// primitives (Sprint S1)
export { Box, type BoxProps, type BoxStyleProps } from './primitives/Box.js';
export { Stack, type StackProps } from './primitives/Stack.js';
export { Inline, type InlineProps } from './primitives/Inline.js';
export { Cluster, type ClusterProps } from './primitives/Cluster.js';
export { Grid, type GridProps, type GridCols } from './primitives/Grid.js';
export { Center, type CenterProps } from './primitives/Center.js';
export { Separator, type SeparatorProps } from './primitives/Separator.js';
export { ScrollArea, type ScrollAreaProps } from './primitives/ScrollArea.js';
export { Portal, type PortalProps } from './primitives/Portal.js';
export { VisuallyHidden, type VisuallyHiddenProps } from './primitives/VisuallyHidden.js';

// utils
export { cx } from './utils/cx.js';

// theme
export {
  ThemeProvider,
  type ThemeProviderProps,
  type ThemeMode,
  type ResolvedTheme,
  type ThemeContextValue,
  ThemeContext,
} from './theme/ThemeProvider.js';
export { useTheme } from './theme/useTheme.js';
export {
  DensityProvider,
  type DensityProviderProps,
  type Density,
  type DensityContextValue,
  DensityContext,
} from './theme/DensityProvider.js';
export { useDensity } from './theme/useDensity.js';
export { ThemeToggle, DensityToggle } from './theme/ThemeToggle.js';