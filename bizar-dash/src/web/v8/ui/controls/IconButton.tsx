import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cx } from '../utils/cx.js';

/**
 * IconButton — square button for icon-only actions.
 *
 * Always pair with an accessible label via `aria-label` or `<VisuallyHidden>`.
 * The `variant` mirrors Button's so they compose visually.
 *
 * Use cases: topbar toolbars, kanban card actions, sidebar collapse, etc.
 */

export type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'danger' | 'outline';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required for a11y. The button is meaningless without a name. */
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  asChild?: boolean;
  active?: boolean;
  children: ReactNode;
}

const SIZE: Record<IconButtonSize, number> = { sm: 24, md: 32, lg: 40 };

const VARIANT_BG: Record<IconButtonVariant, string> = {
  primary: 'var(--accent)',
  secondary: 'var(--surface-1)',
  ghost: 'transparent',
  danger: 'var(--danger)',
  outline: 'transparent',
};

const VARIANT_FG: Record<IconButtonVariant, string> = {
  primary: 'var(--fg-on-accent)',
  secondary: 'var(--fg)',
  ghost: 'var(--fg-muted)',
  danger: 'var(--fg-on-accent)',
  outline: 'var(--fg)',
};

const VARIANT_BORDER: Record<IconButtonVariant, string> = {
  primary: 'transparent',
  secondary: 'var(--border)',
  ghost: 'transparent',
  danger: 'transparent',
  outline: 'var(--border)',
};

const VARIANT_ACTIVE_BG: Record<IconButtonVariant, string> = {
  primary: 'var(--accent-hover)',
  secondary: 'var(--surface-2)',
  ghost: 'var(--surface-1)',
  danger: 'color-mix(in oklch, var(--danger), black 10%)',
  outline: 'var(--surface-2)',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  props,
  ref,
) {
  const {
    variant = 'ghost',
    size = 'md',
    asChild,
    active,
    disabled,
    children,
    className,
    style,
    type,
    ...rest
  } = props;

  const Comp = (asChild ? Slot : 'button') as React.ElementType;
  const dim = SIZE[size];

  const computedStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: dim,
    height: dim,
    flexShrink: 0,
    background: active === true ? VARIANT_ACTIVE_BG[variant] : VARIANT_BG[variant],
    color: VARIANT_FG[variant],
    border: '1px solid',
    borderColor: VARIANT_BORDER[variant],
    borderRadius: 'var(--radius-sm)',
    cursor: disabled === true ? 'not-allowed' : 'pointer',
    opacity: disabled === true ? 0.55 : 1,
    transition: 'background var(--motion-fast) var(--ease-out)',
    ...style,
  } as const;

  return (
    <Comp
      ref={ref as React.Ref<HTMLElement>}
      type={asChild ? undefined : type ?? 'button'}
      disabled={disabled}
      data-active={active === true ? 'true' : undefined}
      className={cx('v8-icon-btn', `v8-icon-btn--${variant}`, `v8-icon-btn--${size}`, className)}
      style={computedStyle}
      {...rest}
    >
      {children}
    </Comp>
  );
});