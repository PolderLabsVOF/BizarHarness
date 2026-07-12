/*
 * Box.tsx — polymorphic layout primitive (Wave 2A).
 *
 * The single source of truth for "I just want a div with padding / margin /
 * background / border / radius / shadow / display / position." Renders one of
 * eight semantic tags (div/section/article/aside/header/footer/main/nav) via
 * the `as` prop and composes utility classes from primitives.css. Every prop
 * maps 1:1 to a CSS class (e.g. `p={3}` → `box-p-3`), keeping styles in CSS
 * and the component surface narrow. `0` is a valid value — use explicit
 * `undefined` checks so falsy zero is not skipped.
 */

import { createElement, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx';

export type BoxAs =
  | 'div'
  | 'section'
  | 'article'
  | 'aside'
  | 'header'
  | 'footer'
  | 'main'
  | 'nav';
export type BoxSpace = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type BoxBg = '0' | '1' | '2' | '3' | 'overlay';
export type BoxBorder = 'none' | 'subtle' | 'default' | 'strong';
export type BoxRounded = 'none' | 'sm' | 'md' | 'lg' | 'full';
export type BoxShadow = 'none' | 'hairline' | 'overlay' | 'tooltip';
export type BoxDisplay = 'block' | 'flex' | 'inline-flex' | 'grid' | 'inline-block' | 'none';
export type BoxPosition = 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';

export type BoxProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  as?: BoxAs;
  p?: BoxSpace;
  px?: BoxSpace;
  py?: BoxSpace;
  m?: BoxSpace;
  mx?: BoxSpace;
  my?: BoxSpace;
  bg?: BoxBg;
  border?: BoxBorder;
  rounded?: BoxRounded;
  shadow?: BoxShadow;
  display?: BoxDisplay;
  position?: BoxPosition;
  children?: ReactNode;
};

export function Box({
  as = 'div',
  p,
  px,
  py,
  m,
  mx,
  my,
  bg,
  border,
  rounded,
  shadow,
  display,
  position,
  className,
  children,
  ...rest
}: BoxProps): React.JSX.Element {
  return createElement(
    as,
    {
      ...rest,
      className: cx(
        'box',
        p !== undefined && `box-p-${p}`,
        px !== undefined && `box-px-${px}`,
        py !== undefined && `box-py-${py}`,
        m !== undefined && `box-m-${m}`,
        mx !== undefined && `box-mx-${mx}`,
        my !== undefined && `box-my-${my}`,
        bg && `box-bg-${bg}`,
        border && `box-border-${border}`,
        rounded && `box-rounded-${rounded}`,
        shadow && `box-shadow-${shadow}`,
        display && `box-d-${display}`,
        position && `box-pos-${position}`,
        className,
      ),
    },
    children,
  );
}
