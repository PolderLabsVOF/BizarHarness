import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import * as RxToggle from '@radix-ui/react-toggle';
import { cx } from '../utils/cx.js';

/**
 * Toggle — pressed/unpressed button (single, not grouped).
 *
 * Use for: "favorite", "pin", "watch" toolbar buttons.
 * For grouped selections (single or multi) use ToggleGroup.
 */
export type ToggleProps = ComponentPropsWithoutRef<typeof RxToggle.Root>;

export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(props, ref) {
  const { className, ...rest } = props;
  return (
    <RxToggle.Root
      ref={ref}
      className={cx('v8-toggle', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 32,
        padding: '0 var(--space-3)',
        background: 'transparent',
        color: 'var(--fg-muted)',
        border: '1px solid transparent',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--fs-13)',
        cursor: 'pointer',
        transition: 'background var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out)',
      }}
      {...rest}
    />
  );
});