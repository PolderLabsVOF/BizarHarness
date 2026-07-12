/*
 * RadioGroup.tsx — single-select radio group (Wave 2A).
 *
 * Renders a radiogroup shell and lays out one label-wrapping-input per
 * option. Keyboard navigation (arrow keys) is inherited from native
 * <input type="radio"> inside a single name group. `orientation`
 * controls horizontal vs vertical layout; CSS handles the actual flex
 * direction. Wrapper-level props (data-testid, id, aria-*, className)
 * land on the radiogroup container, not on each input.
 */

import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../utils/cx';

export type RadioOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export type RadioOrientation = 'horizontal' | 'vertical';

export type RadioGroupProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'onChange' | 'children'
> & {
  name: string;
  value: string;
  onChange: (next: string) => void;
  options: RadioOption[];
  orientation?: RadioOrientation;
  legend?: ReactNode;
  disabled?: boolean;
  required?: boolean;
};

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
  function RadioGroup(
    {
      name,
      value,
      onChange,
      options,
      orientation = 'vertical',
      legend,
      disabled: groupDisabled,
      required,
      className,
      ...wrapperProps
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        role="radiogroup"
        {...wrapperProps}
        className={cx(
          'radio-group',
          orientation === 'horizontal' && 'radio-group-horizontal',
          className,
        )}
      >
        {legend !== undefined && (
          <p className="radio-option-label" style={{ marginBottom: 4 }}>
            {legend}
          </p>
        )}
        {options.map((opt) => {
          const isChecked = opt.value === value;
          return (
            <label
              key={opt.value}
              className={cx(
                'radio-option',
                isChecked && 'radio-option-checked',
              )}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={isChecked}
                disabled={groupDisabled || opt.disabled}
                required={required}
                onChange={() => onChange(opt.value)}
                className="radio-option-input"
              />
              <span className="radio-option-box" aria-hidden>
                <span className="radio-option-dot" />
              </span>
              <span className="radio-option-content">
                <span className="radio-option-label">{opt.label}</span>
                {opt.description !== undefined && (
                  <span className="radio-option-desc">{opt.description}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    );
  },
);
