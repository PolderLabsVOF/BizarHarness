/*
 * IconButton.tsx — square icon-only button (Wave 2A).
 *
 * Use for toolbar actions, dialog close buttons, and other in-line controls
 * that need only a glyph. Always pair with `aria-label` (or `aria-labelledby`)
 * — the rendered children are the icon, so sighted-only labels are absent.
 * Mirrors Button's variant taxonomy (primary/secondary/ghost/danger/subtle)
 * with sizes sm/md/lg (24/32/40 px squares).
 */

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../utils/cx';

export type IconButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'subtle';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> & {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  icon: ReactNode;
  'aria-label': string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      variant = 'secondary',
      size = 'md',
      icon,
      disabled,
      className,
      type = 'button',
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={cx(
          'icon-btn',
          `icon-btn-${variant}`,
          `icon-btn-size-${size}`,
          className,
        )}
        {...rest}
      >
        {icon}
      </button>
    );
  },
);
