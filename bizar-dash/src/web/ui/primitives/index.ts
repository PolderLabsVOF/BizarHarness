/*
 * index.ts — Barrel for the layout primitives (Wave 2A).
 *
 * Side-effect import of primitives.css ships the stylesheet to any
 * consumer that imports from this module graph. Wave 2's ui/index.ts
 * re-exports the exports below — leaving the CSS wiring in place means
 * styles arrive without an additional integration step.
 */

import './primitives.css';

export { Box } from './Box';
export type { BoxProps, BoxAs, BoxBg, BoxBorder, BoxRounded, BoxShadow, BoxDisplay, BoxPosition, BoxSpace } from './Box';
export { Stack } from './Stack';
export type { StackProps, StackSpace, StackAlign, StackJustify } from './Stack';
export { Inline } from './Inline';
export type { InlineProps, InlineSpace, InlineAlign, InlineJustify } from './Inline';
export { Grid } from './Grid';
export type { GridProps, GridSpace } from './Grid';
export { Separator } from './Separator';
export type { SeparatorProps } from './Separator';
export { VisuallyHidden } from './VisuallyHidden';
export type { VisuallyHiddenProps } from './VisuallyHidden';
