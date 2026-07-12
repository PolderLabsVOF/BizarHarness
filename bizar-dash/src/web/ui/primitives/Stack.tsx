/*
 * Stack.tsx — vertical flex container with gap (Wave 2A).
 *
 * Defaults to flex-direction:column with gap=3. Switch to row by setting
 * `direction='row'` (renders the same `stack-row` class). gap / align /
 * justify / wrap all map to single-purpose utility classes so the React
 * layer stays declarative and CSS holds the visual truth.
 */

import { createElement, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx';

export type StackSpace = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type StackAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type StackJustify = 'start' | 'center' | 'end' | 'between' | 'around';

export type StackProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  direction?: 'row' | 'column';
  gap?: StackSpace;
  align?: StackAlign;
  justify?: StackJustify;
  wrap?: boolean;
  as?: 'div' | 'section' | 'article' | 'main' | 'ul' | 'ol' | 'li';
  children?: ReactNode;
};

export function Stack({
  direction = 'column',
  gap = 3,
  align,
  justify,
  wrap,
  as = 'div',
  className,
  children,
  ...rest
}: StackProps): React.JSX.Element {
  return createElement(
    as,
    {
      ...rest,
      className: cx(
        'stack',
        direction === 'row' && 'stack-row',
        `gap-${gap}`,
        align && `align-${align}`,
        justify && `justify-${justify}`,
        wrap === true && 'wrap',
        className,
      ),
    },
    children,
  );
}
