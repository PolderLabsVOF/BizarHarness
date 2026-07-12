/*
 * Select.tsx — native select dropdown (Wave 2A).
 *
 * Built on the native <select> for keyboard nav, mobile picker, and
 * free accessibility. The native control is wrapped in a span that
 * owns sizing + caret positioning. CSS paints a chevron via the
 * `select-caret` sibling. Wrapper-level props (data-testid, id, className)
 * land on the outer span; form-related props (name, form, required) go
 * to the inner <select>.
 */

import {
  forwardRef,
  type HTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../utils/cx';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectSize = 'sm' | 'md' | 'lg';

export type SelectProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'children'
> & {
  inputSize?: SelectSize;
  options: SelectOption[];
  placeholder?: string;
  error?: string | null;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      inputSize = 'md',
      options,
      placeholder,
      error,
      value,
      defaultValue,
      disabled,
      name,
      required,
      onChange,
      className,
      ...wrapperProps
    },
    ref,
  ) {
    return (
      <span
        {...wrapperProps}
        className={cx('select', `select-size-${inputSize}`, className)}
      >
        <select
          ref={ref}
          disabled={disabled}
          name={name}
          required={required}
          value={value}
          defaultValue={defaultValue ?? (placeholder !== undefined ? '' : undefined)}
          onChange={onChange}
          aria-invalid={error ? true : undefined}
          className={cx('select-native', error && 'select-error')}
        >
          {placeholder !== undefined && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="select-caret" size={14} aria-hidden />
      </span>
    );
  },
);
