import { forwardRef, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Box — the foundational layout primitive.
 *
 * A polymorphic `<div>` (or any element) that exposes design-token-driven
 * style props. Used everywhere a layout-only container is needed so we
 * never reach for raw className soup at call sites.
 *
 * Why polymorphic: lots of v8 surfaces (cards, alerts, banners) need to be
 * a `<section>` / `<article>` / `<aside>` semantically while sharing layout.
 */

export type BoxStyleProps = {
  /** Padding — uses --space-* tokens via inline mapping. */
  p?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;
  px?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;
  py?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;
  pt?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;
  pb?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;
  pl?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;
  pr?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;

  /** Background — token name. */
  bg?: 'bg' | 'surface-1' | 'surface-2' | 'surface-3' | 'surface-popover' | 'accent' | 'accent-soft' | 'transparent';

  /** Border — token name (color) + optional width (defaults to 1px). */
  border?: boolean;
  borderColor?: 'border' | 'border-strong' | 'accent' | 'transparent';

  /** Radius — token name. */
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'pill';

  /** Shadow — token name. */
  shadow?: 'none' | '1' | '2' | '3' | '4';

  /** Inline-flex helpers for icon rows, badges, etc. */
  inline?: boolean;
  display?: 'block' | 'inline-block' | 'flex' | 'inline-flex' | 'grid' | 'none';
};

const SPACE_VAR: Record<NonNullable<BoxStyleProps['p']>, string> = {
  0: 'var(--space-0, 0)',
  1: 'var(--space-1)',
  2: 'var(--space-2)',
  3: 'var(--space-3)',
  4: 'var(--space-4)',
  5: 'var(--space-5)',
  6: 'var(--space-6)',
  8: 'var(--space-8)',
  10: 'var(--space-10)',
  12: 'var(--space-12)',
  16: 'var(--space-16)',
};

function pad(value: BoxStyleProps['p']): string | undefined {
  if (value === undefined) return undefined;
  return SPACE_VAR[value];
}

const RADIUS_VAR: Record<NonNullable<BoxStyleProps['rounded']>, string> = {
  none: '0',
  sm: 'var(--radius-sm)',
  md: 'var(--radius)',
  lg: 'var(--radius-lg)',
  pill: 'var(--radius-pill)',
};

const SHADOW_VAR: Record<NonNullable<BoxStyleProps['shadow']>, string> = {
  none: 'none',
  '1': 'var(--shadow-1)',
  '2': 'var(--shadow-2)',
  '3': 'var(--shadow-3)',
  '4': 'var(--shadow-4)',
};

export type BoxProps = BoxStyleProps &
  Omit<HTMLAttributes<HTMLElement>, 'color'> & {
    as?: ElementType;
    children?: ReactNode;
    className?: string;
    style?: React.CSSProperties;
  };

export const Box = forwardRef<HTMLElement, BoxProps>(function Box(props, ref) {
  const {
    as,
    p,
    px,
    py,
    pt,
    pb,
    pl,
    pr,
    bg,
    border,
    borderColor,
    rounded,
    shadow,
    inline,
    display,
    className,
    style,
    children,
    ...rest
  } = props;

  const Tag = (as ?? 'div') as ElementType;

  const computedStyle: React.CSSProperties = { ...style };
  if (p !== undefined) computedStyle.padding = SPACE_VAR[p];
  if (px !== undefined) {
    computedStyle.paddingLeft = SPACE_VAR[px];
    computedStyle.paddingRight = SPACE_VAR[px];
  }
  if (py !== undefined) {
    computedStyle.paddingTop = SPACE_VAR[py];
    computedStyle.paddingBottom = SPACE_VAR[py];
  }
  if (pt !== undefined) computedStyle.paddingTop = SPACE_VAR[pt];
  if (pb !== undefined) computedStyle.paddingBottom = SPACE_VAR[pb];
  if (pl !== undefined) computedStyle.paddingLeft = SPACE_VAR[pl];
  if (pr !== undefined) computedStyle.paddingRight = SPACE_VAR[pr];

  if (bg !== undefined && bg !== 'transparent') {
    computedStyle.background = `var(--${bg})`;
  }
  if (border) {
    computedStyle.borderWidth = '1px';
    computedStyle.borderStyle = 'solid';
    computedStyle.borderColor = `var(--${borderColor ?? 'border'})`;
  }
  if (rounded !== undefined) computedStyle.borderRadius = RADIUS_VAR[rounded];
  if (shadow !== undefined) computedStyle.boxShadow = SHADOW_VAR[shadow];
  if (display !== undefined) computedStyle.display = display;
  else if (inline) computedStyle.display = 'inline-flex';

  return (
    <Tag ref={ref} className={cx('v8-box', className)} style={computedStyle} {...rest}>
      {children}
    </Tag>
  );
});