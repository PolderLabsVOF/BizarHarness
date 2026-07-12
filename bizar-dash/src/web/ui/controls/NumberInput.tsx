/*
 * NumberInput.tsx — numeric input (Wave 2A).
 *
 * Wraps <input type="number"> and accepts string | number for `value`
 * (the native input gives back a string from typing but consumers
 * typically want to work with numbers). `onChange` normalises: if the
 * field is empty, emit ''; otherwise coerce to Number. When the parsed
 * number is NaN we emit the raw string so the consumer can decide.
 */

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cx } from '../utils/cx';

export type NumberInputSize = 'sm' | 'md' | 'lg';

export type NumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'size' | 'children'
> & {
  inputSize?: NumberInputSize;
  error?: string | null;
  value: string | number;
  onChange: (next: string | number) => void;
  min?: number;
  max?: number;
  step?: number;
};

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    {
      inputSize = 'md',
      error,
      value,
      onChange,
      min,
      max,
      step,
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
          className,
        )}
      >
        <input
          ref={ref}
          type="number"
          disabled={disabled}
          value={value}
          min={min}
          max={max}
          step={step}
          aria-invalid={error ? true : undefined}
          className={cx('field-input', error && 'field-error')}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onChange('');
              return;
            }
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : raw);
          }}
          {...rest}
        />
      </span>
    );
  },
);
