import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import * as RxContextMenu from '@radix-ui/react-context-menu';
import { cx } from '../utils/cx.js';

/**
 * ContextMenu — right-click menu. Rule #1 of the v8 dashboard.
 *
 * "Right-click is sacred" — every interactive surface that has meaningful
 * actions must use ContextMenu. The keyboard equivalent is Shift+F10.
 *
 * Built on Radix ContextMenu. Reuses the same Item / Separator / Label
 * primitives as DropdownMenu so visuals are identical (only the trigger
 * differs — left-click for DropdownMenu, right-click for ContextMenu).
 */

export type ContextMenuProps = ComponentPropsWithoutRef<typeof RxContextMenu.Root>;

export const ContextMenu = ({ children, ...rest }: ContextMenuProps) => (
  <RxContextMenu.Root {...rest}>{children}</RxContextMenu.Root>
);

export const ContextMenuTrigger = forwardRef<
  HTMLSpanElement,
  ComponentPropsWithoutRef<typeof RxContextMenu.Trigger>
>(function ContextMenuTrigger(props, ref) {
  return <RxContextMenu.Trigger ref={ref} {...props} />;
});

export interface ContextMenuContentProps
  extends ComponentPropsWithoutRef<typeof RxContextMenu.Content> {
  children: ReactNode;
}

export const ContextMenuContent = forwardRef<HTMLDivElement, ContextMenuContentProps>(
  function ContextMenuContent(props, ref) {
    const { className, children, ...rest } = props;
    return (
      <RxContextMenu.Portal>
        <RxContextMenu.Content
          ref={ref}
          className={cx('v8-context-menu', className)}
          style={{
            minWidth: 200,
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
        </RxContextMenu.Content>
      </RxContextMenu.Portal>
    );
  },
);

export interface ContextMenuItemProps extends ComponentPropsWithoutRef<typeof RxContextMenu.Item> {
  shortcut?: string;
  danger?: boolean;
  leftIcon?: ReactNode;
}

export const ContextMenuItem = forwardRef<HTMLDivElement, ContextMenuItemProps>(
  function ContextMenuItem(props, ref) {
    const { className, children, shortcut, danger, leftIcon, disabled, ...rest } = props;
    return (
      <RxContextMenu.Item
        ref={ref}
        disabled={disabled}
        className={cx('v8-context-menu__item', danger && 'is-danger', className)}
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
      </RxContextMenu.Item>
    );
  },
);

export const ContextMenuSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxContextMenu.Separator>
>(function ContextMenuSeparator(props, ref) {
  return (
    <RxContextMenu.Separator
      ref={ref}
      style={{ height: 1, margin: 'var(--space-1) 0', background: 'var(--border)' }}
      {...props}
    />
  );
});

export const ContextMenuLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxContextMenu.Label>
>(function ContextMenuLabel(props, ref) {
  return (
    <RxContextMenu.Label
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

export const ContextMenuGroup = RxContextMenu.Group;