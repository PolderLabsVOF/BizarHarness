import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Input — single-line text input.
 *
 * Variants:
 *   - default:    bordered, surface-1 background
 *   - filled:     surface-2 background, no visible border until focus
 *   - flushed:    no border except a bottom rule (used inside cards/forms)
 *
 * Pair with <Field> for label + hint + error.
 */
export type InputSize = 'sm' | 'md' | 'lg';
export type InputVariant = 'default' | 'filled' | 'flushed';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  variant?: InputVariant;
  invalid?: boolean;
  leftAddon?: ReactNode;
  rightAddon?: ReactNode;
}

const SIZE: Record<InputSize, { h: number; fs: string; px: number }> = {
  sm: { h: 28, fs: 'var(--fs-12)', px: 10 },
  md: { h: 32, fs: 'var(--fs-13)', px: 12 },
  lg: { h: 40, fs: 'var(--fs-14)', px: 14 },
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(props, ref) {
  const {
    size = 'md',
    variant = 'default',
    invalid,
    leftAddon,
    rightAddon,
    disabled,
    className,
    style,
    ...rest
  } = props;
  const sz = SIZE[size];

  const wrapperStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    width: '100%',
    height: sz.h,
    paddingLeft: variant === 'flushed' ? 0 : sz.px,
    paddingRight: variant === 'flushed' ? 0 : sz.px,
    background:
      variant === 'filled'
        ? 'var(--surface-2)'
        : variant === 'flushed'
          ? 'transparent'
          : 'var(--input-bg)',
    border: variant === 'flushed' ? 'none' : '1px solid',
    borderBottom: variant === 'flushed' ? '1px solid var(--border)' : undefined,
    borderColor: invalid === true ? 'var(--danger)' : 'var(--border)',
    borderRadius: variant === 'flushed' ? 0 : 'var(--radius-sm)',
    opacity: disabled === true ? 0.55 : 1,
    transition: 'border-color var(--motion-fast) var(--ease-out)',
    ...style,
  } as const;

  return (
    <div className={cx('v8-input-wrap', className)} style={wrapperStyle}>
      {leftAddon !== undefined && (
        <span style={{ color: 'var(--fg-muted)', display: 'inline-flex' }}>{leftAddon}</span>
      )}
      <input
        ref={ref}
        disabled={disabled}
        aria-invalid={invalid === true ? 'true' : undefined}
        className="v8-input"
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: 0,
          outline: 0,
          fontSize: sz.fs,
          color: 'var(--fg)',
        }}
        {...rest}
      />
      {rightAddon !== undefined && (
        <span style={{ color: 'var(--fg-muted)', display: 'inline-flex' }}>{rightAddon}</span>
      )}
    </div>
  );
});