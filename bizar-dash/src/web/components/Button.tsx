// src/components/Button.tsx — typed button with variants + sizes.

import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'secondary',
      size = 'md',
      iconOnly = false,
      loading = false,
      disabled,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={rest.type ?? 'button'}
        disabled={disabled || loading}
        className={cn(
          'btn',
          `btn-${variant}`,
          `btn-size-${size}`,
          iconOnly && 'btn-icon',
          loading && 'btn-loading',
          className,
        )}
        {...rest}
      >
        {loading ? <span className="btn-spinner" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);
