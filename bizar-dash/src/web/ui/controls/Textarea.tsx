/*
 * Textarea.tsx — multi-line text field (F-041).
 *
 * Sibling of TextInput. Wraps a native <textarea> so vertical resize,
 * mobile keyboard avoidance, and selection behave natively. Same focus
 * ring, error state, and disabled treatment as TextInput via the shared
 * .field wrapper in controls.css. Use for any free-form multi-line input
 * (prompts, descriptions, system prompts).
 */

import {
  forwardRef,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../utils/cx';

export type TextareaSize = 'sm' | 'md' | 'lg';

export type TextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'children'
> & {
  inputSize?: TextareaSize;
  error?: string | null;
  hint?: ReactNode;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      inputSize = 'md',
      error,
      hint,
      disabled,
      className,
      rows = 4,
      ...rest
    },
    ref,
  ) {
    return (
      <span className={cx('field', 'field-textarea', `field-size-${inputSize}`, className)}>
        <textarea
          ref={ref}
          rows={rows}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          className={cx('field-input', 'field-input-textarea', error && 'field-error')}
          {...rest}
        />
        {hint && <span className="field-hint">{hint}</span>}
      </span>
    );
  },
);