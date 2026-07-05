// src/components/Toggle.tsx — toggle switch control.

import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils';

export type ToggleProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Called with the new checked value on change. */
  onChange?: (checked: boolean) => void;
};

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(
  function Toggle({ className, checked, onChange, onClick, ...rest }, ref) {
    return (
      <label className={cn('toggle', className)}>
        <input
          ref={ref}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
          onClick={(e) => {
            onClick?.(e as unknown as React.MouseEvent<HTMLInputElement>);
          }}
          {...rest}
        />
        <span className="toggle-slider" aria-hidden />
      </label>
    );
  },
);
