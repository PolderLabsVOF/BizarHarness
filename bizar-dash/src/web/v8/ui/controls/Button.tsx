import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * Button — the v8 primary action surface.
 *
 * Variants:
 *   - primary    — the only loud button. Use sparingly (DESIGN.md §1).
 *   - secondary  — bordered, default for most actions.
 *   - ghost      — text-only, used inside surfaces (toolbars, cards).
 *   - danger     — destructive actions.
 *
 * Sizes:
 *   - sm (28px), md (32px), lg (40px), icon (32px square)
 *
 * Loading: shows a spinner and disables interaction. Default label stays visible
 * so the button doesn't reflow.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When true, render as a Slot so the child <a> / <Link> inherits styling. */
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const SIZE: Record<ButtonSize, { h: number; px: number; fs: string }> = {
  sm: { h: 28, px: 10, fs: 'var(--fs-12)' },
  md: { h: 32, px: 14, fs: 'var(--fs-13)' },
  lg: { h: 40, px: 18, fs: 'var(--fs-14)' },
  icon: { h: 32, px: 0, fs: 'var(--fs-13)' },
};

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: 'var(--accent)',
  secondary: 'var(--surface-1)',
  ghost: 'transparent',
  danger: 'var(--danger)',
  outline: 'transparent',
};

const VARIANT_FG: Record<ButtonVariant, string> = {
  primary: 'var(--fg-on-accent)',
  secondary: 'var(--fg)',
  ghost: 'var(--fg-muted)',
  danger: 'var(--fg-on-accent)',
  outline: 'var(--fg)',
};

const VARIANT_BORDER: Record<ButtonVariant, string> = {
  primary: 'transparent',
  secondary: 'var(--border)',
  ghost: 'transparent',
  danger: 'transparent',
  outline: 'var(--border)',
};

const VARIANT_HOVER_BG: Record<ButtonVariant, string> = {
  primary: 'var(--accent-hover)',
  secondary: 'var(--surface-2)',
  ghost: 'var(--surface-1)',
  danger: 'color-mix(in oklch, var(--danger), black 10%)',
  outline: 'var(--surface-1)',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const {
    variant = 'secondary',
    size = 'md',
    asChild,
    loading,
    disabled,
    leftIcon,
    rightIcon,
    fullWidth,
    children,
    className,
    style,
    type,
    ...rest
  } = props;

  const Comp = (asChild ? Slot : 'button') as React.ElementType;
  const sz = SIZE[size];
  const isDisabled = disabled === true || loading === true;

  const computedStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    height: sz.h,
    paddingLeft: sz.px,
    paddingRight: sz.px,
    width: fullWidth === true ? '100%' : undefined,
    fontSize: sz.fs,
    fontWeight: 500,
    lineHeight: 1,
    letterSpacing: 'var(--tracking-base)',
    background: VARIANT_BG[variant],
    color: VARIANT_FG[variant],
    border: '1px solid',
    borderColor: VARIANT_BORDER[variant],
    borderRadius: 'var(--radius-sm)',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.55 : 1,
    transition:
      'background var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out)',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    ...style,
  } as const;

  // For hover effect we have to inject a CSS variable that :hover can use.
  const hoverStyle = { '--btn-hover-bg': VARIANT_HOVER_BG[variant] } as React.CSSProperties;

  return (
    <Comp
      ref={ref as React.Ref<HTMLElement>}
      type={asChild ? undefined : type ?? 'button'}
      disabled={isDisabled}
      aria-busy={loading === true ? 'true' : undefined}
      className={cx('v8-btn', `v8-btn--${variant}`, `v8-btn--${size}`, className)}
      style={{ ...computedStyle, ...hoverStyle }}
      {...rest}
    >
      {loading === true ? <Loader2 size={14} aria-hidden="true" className="v8-btn__spinner" /> : leftIcon}
      {children}
      {rightIcon}
    </Comp>
  );
});