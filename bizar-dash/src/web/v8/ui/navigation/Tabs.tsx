import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import * as RxTabs from '@radix-ui/react-tabs';
import { cx } from '../utils/cx.js';

/**
 * Tabs — content switcher with keyboard navigation.
 *
 * Built on Radix Tabs (left/right arrow keys, focus management).
 *
 * Variants:
 *   - underline (default): 1px bottom border active indicator.
 *   - pill: rounded filled active state.
 */

export type TabsVariant = 'underline' | 'pill';

export interface TabsProps extends Omit<ComponentPropsWithoutRef<typeof RxTabs.Root>, 'children'> {
  variant?: TabsVariant;
  children: ReactNode;
}

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(props, ref) {
  const { variant = 'underline', className, ...rest } = props;
  return (
    <RxTabs.Root
      ref={ref}
      className={cx('v8-tabs', `v8-tabs--${variant}`, className)}
      {...rest}
    />
  );
});

export interface TabsListProps extends ComponentPropsWithoutRef<typeof RxTabs.List> {
  variant?: TabsVariant;
  children: ReactNode;
}

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(function TabsList(props, ref) {
  const { variant = 'underline', className, style, ...rest } = props;
  return (
    <RxTabs.List
      ref={ref}
      className={cx('v8-tabs__list', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: variant === 'pill' ? 4 : 0,
        borderBottom: variant === 'underline' ? '1px solid var(--border)' : 'none',
        padding: variant === 'pill' ? 4 : 0,
        background: variant === 'pill' ? 'var(--surface-1)' : 'transparent',
        borderRadius: variant === 'pill' ? 'var(--radius)' : 0,
        border: variant === 'pill' ? '1px solid var(--border)' : undefined,
        ...style,
      }}
      {...rest}
    />
  );
});

export interface TabsTriggerProps extends ComponentPropsWithoutRef<typeof RxTabs.Trigger> {
  variant?: TabsVariant;
  children: ReactNode;
}

export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(function TabsTrigger(
  props,
  ref,
) {
  const { variant = 'underline', className, style, ...rest } = props;
  return (
    <RxTabs.Trigger
      ref={ref}
      className={cx('v8-tabs__trigger', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        height: variant === 'pill' ? 28 : 32,
        padding: variant === 'pill' ? '0 var(--space-3)' : '0 var(--space-3)',
        background: 'transparent',
        color: 'var(--fg-muted)',
        border: 0,
        borderBottom: variant === 'underline' ? '2px solid transparent' : 'none',
        borderRadius: variant === 'pill' ? 'var(--radius-sm)' : 0,
        marginBottom: variant === 'underline' ? -1 : 0,
        fontSize: 'var(--fs-13)',
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'color var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out)',
        ...style,
      }}
      {...rest}
    >
      {props.children}
      <style>{`
        .v8-tabs__trigger[data-state='active'] {
          color: var(--fg);
        }
        .v8-tabs--underline .v8-tabs__trigger[data-state='active'] {
          border-bottom-color: var(--accent);
        }
        .v8-tabs--pill .v8-tabs__trigger[data-state='active'] {
          background: var(--surface-2);
          color: var(--fg);
        }
        .v8-tabs__trigger:hover:not([data-state='active']) {
          color: var(--fg);
        }
      `}</style>
    </RxTabs.Trigger>
  );
});

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RxTabs.Content>
>(function TabsContent(props, ref) {
  const { className, ...rest } = props;
  return (
    <RxTabs.Content
      ref={ref}
      className={cx('v8-tabs__content', className)}
      style={{ paddingTop: 'var(--space-4)' }}
      {...rest}
    />
  );
});