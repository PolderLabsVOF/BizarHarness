/*
 * Inline.tsx — horizontal flex container with gap (Wave 2A).
 *
 * Mirror of Stack tuned for horizontal layouts: defaults to
 * flex-direction:row with wrap-on overflow (rows of chips / tags /
 * buttons). Switch direction to column by setting `direction='column'`.
 * All gap / align / justify modifiers share the same utility classes
 * as Stack so a single className namespace covers both.
 */

import { createElement, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx';

export type InlineSpace = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type InlineAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type InlineJustify = 'start' | 'center' | 'end' | 'between' | 'around';

export type InlineProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  direction?: 'row' | 'column';
  gap?: InlineSpace;
  align?: InlineAlign;
  justify?: InlineJustify;
  wrap?: boolean;
  as?: 'div' | 'span' | 'ul' | 'ol' | 'p';
  children?: ReactNode;
};

export function Inline({
  direction = 'row',
  gap = 3,
  align,
  justify,
  wrap = true,
  as = 'div',
  className,
  children,
  ...rest
}: InlineProps): React.JSX.Element {
  return createElement(
    as,
    {
      ...rest,
      className: cx(
        'inline',
        direction === 'column' && 'inline-col',
        `gap-${gap}`,
        align && `align-${align}`,
        justify && `justify-${justify}`,
        wrap ? 'wrap' : 'nowrap',
        className,
      ),
    },
    children,
  );
}
