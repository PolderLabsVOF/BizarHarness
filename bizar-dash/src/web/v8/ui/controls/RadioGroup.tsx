import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import * as RxRadio from '@radix-ui/react-radio-group';
import { cx } from '../utils/cx.js';

/**
 * RadioGroup — mutually exclusive single-choice input.
 *
 * Built on Radix RadioGroup for keyboard arrow navigation.
 */
export type RadioGroupProps = ComponentPropsWithoutRef<typeof RxRadio.Root>;

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(function RadioGroup(
  props,
  ref,
) {
  const { className, ...rest } = props;
  return (
    <RxRadio.Root
      ref={ref}
      className={cx('v8-radio-group', className)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
      {...rest}
    />
  );
});

export interface RadioGroupItemProps extends ComponentPropsWithoutRef<typeof RxRadio.Item> {
  label?: string;
}

export const RadioGroupItem = forwardRef<HTMLButtonElement, RadioGroupItemProps>(
  function RadioGroupItem(props, ref) {
    const { className, value, label, ...rest } = props;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <RxRadio.Item
          ref={ref}
          value={value}
          className={cx('v8-radio-group__item', className)}
          style={{
            width: 16,
            height: 16,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--input-bg)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-pill)',
            cursor: 'pointer',
          }}
          {...rest}
        >
          <RxRadio.Indicator
            style={{
              width: 8,
              height: 8,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--accent)',
            }}
          />
        </RxRadio.Item>
        {label !== undefined && (
          <label htmlFor={rest.id} style={{ fontSize: 'var(--fs-13)', cursor: 'pointer' }}>
            {label}
          </label>
        )}
      </div>
    );
  },
);