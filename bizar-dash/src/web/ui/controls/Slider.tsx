/*
 * Slider.tsx — range input (Wave 2A).
 *
 * Thin wrapper around <input type="range"> that adds a labelled header
 * row and an optional value badge. The native range control delivers
 * keyboard arrow-keys / page-up / home / end for free. `showValue` adds
 * a tabular-numeric readout to the right of the label.
 */

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cx } from '../utils/cx';

export type SliderProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'children'
> & {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  showValue?: boolean;
  disabled?: boolean;
};

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  function Slider(
    {
      value,
      onChange,
      min = 0,
      max = 100,
      step = 1,
      label,
      showValue = false,
      disabled,
      className,
      ...rest
    },
    ref,
  ) {
    return (
      <div className={cx('slider', className)}>
        {(label !== undefined || showValue) && (
          <div className="slider-header">
            {label !== undefined && (
              <span className="slider-label">{label}</span>
            )}
            {showValue && (
              <span className="slider-value">{String(value)}</span>
            )}
          </div>
        )}
        <input
          ref={ref}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="slider-input"
          {...rest}
        />
      </div>
    );
  },
);
