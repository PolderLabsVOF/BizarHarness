import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import * as RxSwitch from '@radix-ui/react-switch';
import { cx } from '../utils/cx.js';

/**
 * Switch — boolean toggle (vs Checkbox which selects).
 *
 * Use for: enable/disable settings, on/off toggles.
 * Built on Radix Switch for a11y.
 */

export type SwitchProps = ComponentPropsWithoutRef<typeof RxSwitch.Root>;

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(props, ref) {
  const { className, ...rest } = props;
  return (
    <RxSwitch.Root
      ref={ref}
      className={cx('v8-switch', className)}
      style={{
        width: 32,
        height: 18,
        background: 'var(--surface-2)',
        borderRadius: 'var(--radius-pill)',
        position: 'relative',
        border: '1px solid var(--border)',
        cursor: 'pointer',
        transition: 'background var(--motion-fast) var(--ease-out)',
      }}
      {...rest}
    >
      <RxSwitch.Thumb
        style={{
          display: 'block',
          width: 12,
          height: 12,
          background: 'var(--fg)',
          borderRadius: 'var(--radius-pill)',
          transform: 'translateX(2px)',
          transition: 'transform var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out)',
          willChange: 'transform',
        }}
      />
      <style>{`
        .v8-switch[data-state='checked'] {
          background: var(--accent);
          border-color: var(--accent);
        }
        .v8-switch[data-state='checked'] > span {
          transform: translateX(16px);
          background: var(--fg-on-accent);
        }
      `}</style>
    </RxSwitch.Root>
  );
});