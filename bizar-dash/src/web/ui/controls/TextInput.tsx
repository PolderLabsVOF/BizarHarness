/*
 * TextInput.tsx — single-line text field (Wave 2A).
 *
 * Wraps the native <input type="text"> to keep autofocus / selection /
 * spellcheck / mobile keyboard behavior free of customization. Sizes sm/md/lg
 * match the rest of the controls' vertical rhythm. `error` paints the border
 * danger and shifts the focus ring to the danger-subtle tone. `leftIcon` and
 * `rightIcon` are ReactNode (typically a lucide-react icon) absolutely
 * positioned inside the field padding well.
 */

import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../utils/cx';

export type TextInputSize = 'sm' | 'md' | 'lg';

export type TextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'children'
> & {
  inputSize?: TextInputSize;
  error?: string | null;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput(
    {
      inputSize = 'md',
      error,
      leftIcon,
      rightIcon,
      disabled,
      className,
      ...rest
    },
    ref,
  ) {
    return (
      <span
        className={cx(
          'field',
          `field-size-${inputSize}`,
          leftIcon && 'field-has-left',
          rightIcon && 'field-has-right',
          className,
        )}
      >
        {leftIcon && <span className="field-icon-left">{leftIcon}</span>}
        <input
          ref={ref}
          type="text"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          className={cx('field-input', error && 'field-error')}
          {...rest}
        />
        {rightIcon && <span className="field-icon-right">{rightIcon}</span>}
      </span>
    );
  },
);
