import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import * as RxCheckbox from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * Checkbox — controlled or uncontrolled boolean input.
 *
 * Built on Radix Checkbox for keyboard + screen reader correctness.
 * Use inside <Field> for label/hint/error.
 */

export type CheckboxProps = ComponentPropsWithoutRef<typeof RxCheckbox.Root>;

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  props,
  ref,
) {
  const { className, disabled, ...rest } = props;
  return (
    <RxCheckbox.Root
      ref={ref}
      disabled={disabled}
      className={cx('v8-checkbox', className)}
      style={{
        width: 16,
        height: 16,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--input-bg)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-sm)',
        cursor: disabled === true ? 'not-allowed' : 'pointer',
        opacity: disabled === true ? 0.55 : 1,
        transition: 'background var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out)',
      }}
      {...rest}
    >
      <RxCheckbox.Indicator>
        {rest.checked === 'indeterminate' ? (
          <Minus size={12} aria-hidden="true" style={{ color: 'var(--fg-on-accent)' }} />
        ) : (
          <Check size={12} aria-hidden="true" style={{ color: 'var(--fg-on-accent)' }} />
        )}
      </RxCheckbox.Indicator>
    </RxCheckbox.Root>
  );
});