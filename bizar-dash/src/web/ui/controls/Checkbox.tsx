/*
 * Checkbox.tsx — tri-state checkbox (Wave 2A).
 *
 * Three visual states: unchecked, checked, indeterminate (set the
 * `indeterminate` boolean when partial selection applies — e.g. a
 * parent whose children are partially selected). Built as a label +
 * visually-hidden input pattern so the entire row is clickable and
 * keyboard activatable (space).
 *
 * Wrapper-level props (data-testid, id, aria-*, className) flow to the
 * <label>; the inner <input> only takes its own concerns.
 */

import {
  forwardRef,
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { Check, Minus } from 'lucide-react';
import { cx } from '../utils/cx';

export type CheckboxProps = Omit<
  HTMLAttributes<HTMLLabelElement>,
  'onChange' | 'children'
> & {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
  name?: string;
  autoFocus?: boolean;
  required?: boolean;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    {
      checked,
      onChange,
      label,
      indeterminate = false,
      disabled,
      name,
      autoFocus,
      required,
      className,
      ...labelProps
    },
    ref,
  ) {
    const innerRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);
    const setRef = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    };
    return (
      <label
        {...labelProps}
        className={cx(
          'checkbox',
          checked && 'checkbox-checked',
          indeterminate && 'checkbox-indeterminate',
          className,
        )}
      >
        <input
          ref={setRef}
          type="checkbox"
          name={name}
          checked={checked}
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.checked)}
          className="checkbox-input"
        />
        <span className="checkbox-box" aria-hidden>
          {indeterminate ? (
            <Minus strokeWidth={3} />
          ) : checked ? (
            <Check strokeWidth={3} />
          ) : null}
        </span>
        {label !== undefined && <span className="checkbox-label">{label}</span>}
      </label>
    );
  },
);
