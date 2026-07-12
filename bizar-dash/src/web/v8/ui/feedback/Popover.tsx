import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import * as RxPopover from '@radix-ui/react-popover';
import { cx } from '../utils/cx.js';

/**
 * Popover — a small floating panel anchored to a trigger.
 *
 * Use for: kanban filter dropdowns, date pickers, color pickers, info panels.
 * For menus (a list of actions) use DropdownMenu. For right-click use ContextMenu.
 */

export interface PopoverProps extends Omit<ComponentPropsWithoutRef<typeof RxPopover.Root>, 'children'> {
  children: ReactNode;
}

export const Popover = ({ children, ...rest }: PopoverProps) => (
  <RxPopover.Root {...rest}>{children}</RxPopover.Root>
);

export const PopoverTrigger = RxPopover.Trigger;
export const PopoverAnchor = RxPopover.Anchor;
export const PopoverClose = RxPopover.Close;

export interface PopoverContentProps extends ComponentPropsWithoutRef<typeof RxPopover.Content> {
  children: ReactNode;
}

export const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(function PopoverContent(
  props,
  ref,
) {
  const { className, children, sideOffset = 6, ...rest } = props;
  return (
    <RxPopover.Portal>
      <RxPopover.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cx('v8-popover', className)}
        style={{
          background: 'var(--surface-popover)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-3)',
          padding: 'var(--space-3)',
          minWidth: 200,
          maxWidth: 360,
          zIndex: 'var(--z-popover)',
        }}
        {...rest}
      >
        {children}
        <RxPopover.Arrow style={{ fill: 'var(--surface-popover)' }} />
      </RxPopover.Content>
    </RxPopover.Portal>
  );
});