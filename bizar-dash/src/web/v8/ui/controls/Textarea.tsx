import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Textarea — multi-line input.
 *
 * Use for: descriptions, comments, chat input.
 * Pair with <Field> for label + hint + error.
 */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  autoResize?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(props, ref) {
  const {
    invalid,
    autoResize,
    disabled,
    rows = 4,
    className,
    style,
    onInput,
    ...rest
  } = props;

  const computedStyle = {
    width: '100%',
    minHeight: 64,
    padding: 'var(--space-3)',
    fontSize: 'var(--fs-13)',
    lineHeight: 'var(--lh-base)',
    color: 'var(--fg)',
    background: 'var(--input-bg)',
    border: '1px solid',
    borderColor: invalid === true ? 'var(--danger)' : 'var(--border)',
    borderRadius: 'var(--radius-sm)',
    outline: 0,
    resize: autoResize === true ? 'none' : 'vertical',
    opacity: disabled === true ? 0.55 : 1,
    fontFamily: 'inherit',
    ...style,
  } as const;

  return (
    <textarea
      ref={ref}
      rows={rows}
      disabled={disabled}
      aria-invalid={invalid === true ? 'true' : undefined}
      className={cx('v8-textarea', className)}
      style={computedStyle}
      onInput={(e) => {
        if (autoResize === true) {
          const el = e.currentTarget;
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }
        onInput?.(e);
      }}
      {...rest}
    />
  );
});