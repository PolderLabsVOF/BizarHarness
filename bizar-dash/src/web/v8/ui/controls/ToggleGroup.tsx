import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import * as RxToggleGroup from '@radix-ui/react-toggle-group';
import { cx } from '../utils/cx.js';

/**
 * ToggleGroup — group of toggle buttons with single or multi selection.
 *
 * Use cases:
 *   - View switcher (Kanban / List / Calendar)
 *   - Filter pills (status: All / Active / Done)
 *   - Density toggle (Comfortable / Compact)
 */
export type ToggleGroupType = 'single' | 'multiple';

export interface ToggleGroupProps
  extends Omit<ComponentPropsWithoutRef<typeof RxToggleGroup.Root>, 'type'> {
  type: ToggleGroupType;
}

export const ToggleGroup = forwardRef<HTMLDivElement, ToggleGroupProps>(function ToggleGroup(
  props,
  ref,
) {
  const { type, className, ...rest } = props;
  return (
    <RxToggleGroup.Root
      ref={ref}
      type={type as 'single' | 'multiple'}
      className={cx('v8-toggle-group', className)}
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        background: 'var(--surface-1)',
      }}
      {...(rest as Record<string, unknown>)}
    />
  );
});

export interface ToggleGroupItemProps extends ComponentPropsWithoutRef<typeof RxToggleGroup.Item> {}

export const ToggleGroupItem = forwardRef<HTMLButtonElement, ToggleGroupItemItemProps>(
  function ToggleGroupItem(props, ref) {
    const { className, children, ...rest } = props;
    return (
      <RxToggleGroup.Item
        ref={ref}
        className={cx('v8-toggle-group__item', className)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 28,
          padding: '0 var(--space-3)',
          background: 'transparent',
          color: 'var(--fg-muted)',
          border: 0,
          borderRight: '1px solid var(--border)',
          fontSize: 'var(--fs-13)',
          cursor: 'pointer',
          transition: 'background var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out)',
        }}
        {...rest}
      >
        {children}
        <style>{`
          .v8-toggle-group__item:last-child { border-right: 0; }
          .v8-toggle-group__item[data-state='on'] {
            background: var(--accent-soft);
            color: var(--accent);
            font-weight: 500;
          }
        `}</style>
      </RxToggleGroup.Item>
    );
  },
);

interface ToggleGroupItemItemProps extends ToggleGroupItemProps {}

// Note: the empty interface above is intentional — we want ToggleGroupItemProps
// to be the public API surface. The duplicate `ToggleGroupItemItemProps` keeps
// the JSDoc happy without forcing callers to import both names.