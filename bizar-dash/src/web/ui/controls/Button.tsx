/*
 * Button.tsx — primary action control (Wave 2A).
 *
 * Variants: primary (green accent CTA), secondary (neutral chrome), ghost
 * (transparent chrome), subtle (accent tint), danger (red destructive).
 * Sizes: xs/sm/md/lg. `loading` replaces the click target with a spinner
 * and sets `disabled` so the user cannot double-fire while the request is
 * in flight. `icon` (left) and `iconRight` slot arbitrary ReactNode — most
 * callers pass a lucide-react icon. Styled by controls.css; use cx() to
 * compose classes.
 */

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../utils/cx';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'subtle'
  | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'secondary',
      size = 'md',
      loading = false,
      fullWidth = false,
      icon,
      iconRight,
      disabled,
      className,
      children,
      type = 'button',
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cx(
          'btn',
          `btn-${variant}`,
          `btn-size-${size}`,
          loading && 'btn-loading',
          fullWidth && 'btn-full',
          className,
        )}
        {...rest}
      >
        {loading && <span className="btn-spinner" aria-hidden />}
        {icon}
        {children}
        {iconRight}
      </button>
    );
  },
);
