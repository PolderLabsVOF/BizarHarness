/*
 * SearchInput.tsx — text field with search affordances (Wave 2A).
 *
 * Composes TextInput: bakes in a left Search icon and a conditional
 * Clear button on the right when `value` is non-empty. `onClear` fires
 * only when the user activates the explicit Clear button — not on
 * backspace keystrokes, which are reported through the regular
 * `onChange` callback. `aria-label` should be supplied by the caller
 * (visual label is optional).
 */

import {
  forwardRef,
  useCallback,
  type ChangeEvent,
} from 'react';
import { Search, X } from 'lucide-react';
import { cx } from '../utils/cx';
import { TextInput } from './TextInput';

export type SearchInputSize = 'sm' | 'md' | 'lg';

export type SearchInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size' | 'children' | 'type'
> & {
  inputSize?: SearchInputSize;
  value: string;
  onChange: (next: string) => void;
  onClear?: () => void;
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      inputSize = 'md',
      value,
      onChange,
      onClear,
      placeholder = 'Search…',
      disabled,
      className,
      ...rest
    },
    ref,
  ) {
    const handleClear = useCallback(() => {
      onChange('');
      onClear?.();
    }, [onChange, onClear]);
    const handleChange = useCallback(
      (e: ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
      },
      [onChange],
    );
    return (
      <span className={cx('field', className)}>
        <Search
          size={14}
          className="field-icon-left"
          aria-hidden
        />
        <input
          ref={ref}
          type="search"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          className="field-input field-has-left"
          {...rest}
        />
        {value !== '' && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="field-clear"
            aria-label="Clear search"
            tabIndex={-1}
          >
            <X size={12} aria-hidden />
          </button>
        )}
      </span>
    );
  },
);
