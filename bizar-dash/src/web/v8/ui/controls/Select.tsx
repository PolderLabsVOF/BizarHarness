import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import * as RxSelect from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * Select — native-feeling dropdown.
 *
 * Built on Radix Select for a11y (keyboard navigation, type-ahead, ARIA).
 *
 * Use cases: settings pickers, kanban filter dropdowns, table column filters.
 * For autocomplete use Combobox (S3). For chips use MultiSelect (S3).
 */

export type SelectProps = ComponentPropsWithoutRef<typeof RxSelect.Root>;

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(props, ref) {
  const { children, ...rest } = props;
  return (
    <RxSelect.Root {...rest}>
      {children}
      {/* Trigger is rendered separately by the consumer via SelectTrigger. */}
      <span hidden>
        <RxSelect.Trigger ref={ref} />
      </span>
    </RxSelect.Root>
  );
});

export interface SelectTriggerProps extends ComponentPropsWithoutRef<typeof RxSelect.Trigger> {
  placeholder?: string;
  size?: 'sm' | 'md';
}

export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(function SelectTrigger(
  props,
  ref,
) {
  const { className, placeholder, size = 'md', children, ...rest } = props;
  return (
    <RxSelect.Trigger
      ref={ref}
      className={cx('v8-select__trigger', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-2)',
        minWidth: 120,
        height: size === 'sm' ? 28 : 32,
        padding: '0 var(--space-3)',
        background: 'var(--input-bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--fs-13)',
        color: 'var(--fg)',
        cursor: 'pointer',
      }}
      {...rest}
    >
      <RxSelect.Value placeholder={placeholder} />
      <RxSelect.Icon>
        <ChevronDown size={14} aria-hidden="true" style={{ color: 'var(--fg-muted)' }} />
      </RxSelect.Icon>
      {children}
    </RxSelect.Trigger>
  );
});

export interface SelectContentProps extends ComponentPropsWithoutRef<typeof RxSelect.Content> {
  children: ReactNode;
}

export const SelectContent = forwardRef<HTMLDivElement, SelectContentProps>(function SelectContent(
  props,
  ref,
) {
  const { className, children, position = 'popper', ...rest } = props;
  return (
    <RxSelect.Portal>
      <RxSelect.Content
        ref={ref}
        position={position}
        sideOffset={4}
        className={cx('v8-select__content', className)}
        style={{
          background: 'var(--surface-popover)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-3)',
          padding: 'var(--space-1)',
          minWidth: 'var(--radix-select-trigger-width)',
          maxHeight: 'var(--radix-select-content-available-height, 320px)',
          overflow: 'hidden',
          zIndex: 'var(--z-popover)',
        }}
        {...rest}
      >
        <RxSelect.ScrollUpButton
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 20,
            color: 'var(--fg-muted)',
          }}
        >
          <ChevronUp size={14} aria-hidden="true" />
        </RxSelect.ScrollUpButton>
        <RxSelect.Viewport>{children}</RxSelect.Viewport>
        <RxSelect.ScrollDownButton
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 20,
            color: 'var(--fg-muted)',
          }}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </RxSelect.ScrollDownButton>
      </RxSelect.Content>
    </RxSelect.Portal>
  );
});

export interface SelectItemProps extends ComponentPropsWithoutRef<typeof RxSelect.Item> {
  children: ReactNode;
}

export const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(function SelectItem(props, ref) {
  const { className, children, ...rest } = props;
  return (
    <RxSelect.Item
      ref={ref}
      className={cx('v8-select__item', className)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        height: 28,
        padding: '0 var(--space-3) 0 var(--space-6)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--fs-13)',
        color: 'var(--fg)',
        cursor: 'pointer',
        outline: 0,
        userSelect: 'none',
        position: 'relative',
      }}
      {...rest}
    >
      <RxSelect.ItemIndicator
        style={{
          position: 'absolute',
          left: 6,
          display: 'inline-flex',
          alignItems: 'center',
          color: 'var(--accent)',
        }}
      >
        <Check size={14} aria-hidden="true" />
      </RxSelect.ItemIndicator>
      <RxSelect.ItemText>{children}</RxSelect.ItemText>
    </RxSelect.Item>
  );
});

export const SelectGroup = RxSelect.Group;
export const SelectLabel = RxSelect.Label;
export const SelectSeparator = RxSelect.Separator;