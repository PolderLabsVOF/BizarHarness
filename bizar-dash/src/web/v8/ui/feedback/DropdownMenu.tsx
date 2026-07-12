import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import * as RxMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * DropdownMenu — a menu attached to a trigger (button click).
 *
 * For right-click menus use ContextMenu. For menus inside a Card
 * (without a trigger) use Menu directly.
 */

export type DropdownMenuProps = ComponentPropsWithoutRef<typeof RxMenu.Root>;

export const DropdownMenu = ({ children, ...rest }: DropdownMenuProps) => (
  <RxMenu.Root {...rest}>{children}</RxMenu.Root>
);

export const DropdownMenuTrigger = RxMenu.Trigger;
export const DropdownMenuGroup = RxMenu.Group;
export const DropdownMenuPortal = RxMenu.Portal;
export const DropdownMenuSub = RxMenu.Sub;
export const DropdownMenuRadioGroup = RxMenu.RadioGroup;

export interface DropdownMenuContentProps extends ComponentPropsWithoutRef<typeof RxMenu.Content> {
  children: ReactNode;
}

export const DropdownMenuContent = forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  function DropdownMenuContent(props, ref) {
    const { className, children, sideOffset = 4, ...rest } = props;
    return (
      <RxMenu.Portal>
        <RxMenu.Content
          ref={ref}
          sideOffset={sideOffset}
          className={cx('v8-dropdown-menu', className)}
          style={{
            minWidth: 180,
            background: 'var(--surface-popover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-3)',
            padding: 'var(--space-1)',
            zIndex: 'var(--z-popover)',
          }}
          {...rest}
        >
          {children}
        </RxMenu.Content>
      </RxMenu.Portal>
    );
  },
);

export interface DropdownMenuItemProps extends ComponentPropsWithoutRef<typeof RxMenu.Item> {
  /** Shortcut shown on the right (e.g. "⌘ K"). */
  shortcut?: string;
  /** When true, render a left-aligned danger color (used for delete actions). */
  danger?: boolean;
  leftIcon?: ReactNode;
}

export const DropdownMenuItem = forwardRef<HTMLDivElement, DropdownMenuItemProps>(
  function DropdownMenuItem(props, ref) {
    const { className, children, shortcut, danger, leftIcon, disabled, ...rest } = props;
    return (
      <RxMenu.Item
        ref={ref}
        disabled={disabled}
        className={cx('v8-dropdown-menu__item', danger && 'is-danger', className)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          height: 28,
          padding: '0 var(--space-2) 0 var(--space-3)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--fs-13)',
          color: danger === true ? 'var(--danger)' : 'var(--fg)',
          cursor: disabled === true ? 'not-allowed' : 'pointer',
          outline: 0,
          userSelect: 'none',
        }}
        {...rest}
      >
        {leftIcon !== undefined && (
          <span style={{ width: 14, display: 'inline-flex', color: 'var(--fg-muted)' }}>{leftIcon}</span>
        )}
        <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
        {shortcut !== undefined && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-muted)',
              marginLeft: 'var(--space-2)',
            }}
          >
            {shortcut}
          </span>
        )}
      </RxMenu.Item>
    );
  },
);

export const DropdownMenuCheckboxItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxMenu.CheckboxItem> & { children: ReactNode }
>(function DropdownMenuCheckboxItem(props, ref) {
  const { className, children, ...rest } = props;
  return (
    <RxMenu.CheckboxItem
      ref={ref}
      className={cx('v8-dropdown-menu__checkbox', className)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        height: 28,
        padding: '0 var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--fs-13)',
        cursor: 'pointer',
        outline: 0,
      }}
      {...rest}
    >
      <RxMenu.ItemIndicator style={{ display: 'inline-flex', color: 'var(--accent)' }}>
        <Check size={14} aria-hidden="true" />
      </RxMenu.ItemIndicator>
      <span>{children}</span>
    </RxMenu.CheckboxItem>
  );
});

export const DropdownMenuLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxMenu.Label>
>(function DropdownMenuLabel(props, ref) {
  return (
    <RxMenu.Label
      ref={ref}
      style={{
        padding: 'var(--space-2) var(--space-3) var(--space-1)',
        fontSize: 'var(--fs-12)',
        fontWeight: 600,
        color: 'var(--fg-subtle)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-wide)',
      }}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxMenu.Separator>
>(function DropdownMenuSeparator(props, ref) {
  return (
    <RxMenu.Separator
      ref={ref}
      style={{
        height: 1,
        margin: 'var(--space-1) 0',
        background: 'var(--border)',
      }}
      {...props}
    />
  );
});

export interface DropdownMenuSubTriggerProps
  extends ComponentPropsWithoutRef<typeof RxMenu.SubTrigger> {
  children: ReactNode;
}

export const DropdownMenuSubTrigger = forwardRef<HTMLDivElement, DropdownMenuSubTriggerProps>(
  function DropdownMenuSubTrigger(props, ref) {
    const { className, children, ...rest } = props;
    return (
      <RxMenu.SubTrigger
        ref={ref}
        className={cx('v8-dropdown-menu__sub-trigger', className)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          height: 28,
          padding: '0 var(--space-2) 0 var(--space-3)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--fs-13)',
          cursor: 'pointer',
          outline: 0,
        }}
        {...rest}
      >
        <span style={{ flex: 1 }}>{children}</span>
        <ChevronRight size={14} aria-hidden="true" style={{ color: 'var(--fg-muted)' }} />
      </RxMenu.SubTrigger>
    );
  },
);

export const DropdownMenuSubContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxMenu.SubContent>
>(function DropdownMenuSubContent(props, ref) {
  const { className, ...rest } = props;
  return (
    <RxMenu.Portal>
      <RxMenu.SubContent
        ref={ref}
        sideOffset={2}
        className={cx('v8-dropdown-menu__sub-content', className)}
        style={{
          minWidth: 180,
          background: 'var(--surface-popover)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-3)',
          padding: 'var(--space-1)',
          zIndex: 'var(--z-popover)',
        }}
        {...rest}
      />
    </RxMenu.Portal>
  );
});