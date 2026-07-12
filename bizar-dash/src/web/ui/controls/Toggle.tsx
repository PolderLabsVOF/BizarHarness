/*
 * Toggle.tsx — boolean switch (Wave 2A).
 *
 * Built as a label-wrapping-input pattern (visually hidden checkbox) so
 * screen readers announce role=switch without extra ARIA. The CSS track +
 * thumb are absolutely positioned inside the label; checked/disabled states
 * toggle classes on the wrapping label. `size` sm/md governs the track.
 *
 * Wrapper-level props (data-testid, id, aria-*, className) flow to the
 * <label>; the inner <input> only takes its own concerns (name, form,
 * autoFocus, etc).
 */

import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../utils/cx';

export type ToggleSize = 'sm' | 'md';

export type ToggleProps = Omit<
  HTMLAttributes<HTMLLabelElement>,
  'onChange' | 'children'
> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  size?: ToggleSize;
  name?: string;
  disabled?: boolean;
  autoFocus?: boolean;
};

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(
  function Toggle(
    {
      checked,
      onChange,
      label,
      disabled,
      size = 'md',
      name,
      autoFocus,
      className,
      ...labelProps
    },
    ref,
  ) {
    return (
      <label
        {...labelProps}
        className={cx(
          'toggle',
          size === 'sm' && 'toggle-sm',
          checked && 'toggle-checked',
          className,
        )}
      >
        <input
          ref={ref}
          type="checkbox"
          role="switch"
          name={name}
          checked={checked}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.checked)}
          className="toggle-input"
        />
        <span className="toggle-track" aria-hidden>
          <span className="toggle-thumb" />
        </span>
        {label !== undefined && <span className="toggle-label">{label}</span>}
      </label>
    );
  },
);
