import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import * as RxAccordion from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * Accordion — collapsible content groups. Built on Radix for keyboard nav.
 *
 * Use for: Settings sections, long form grouping, FAQ-like content.
 */

export interface AccordionProps {
  /** 'single' opens one at a time, 'multiple' allows many. */
  type: 'single' | 'multiple';
  defaultValue?: string | string[];
  value?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  children: ReactNode;
  className?: string;
}

export const Accordion = forwardRef<HTMLDivElement, AccordionProps>(function Accordion(props, ref) {
  const { type, defaultValue, value, onValueChange, children, className, ...rest } = props;
  if (type === 'single') {
    return (
      <RxAccordion.Root
        ref={ref as React.Ref<HTMLDivElement>}
        type="single"
        collapsible
        defaultValue={defaultValue as string | undefined}
        value={value as string | undefined}
        onValueChange={onValueChange as ((value: string) => void) | undefined}
        className={cx('v8-accordion', className)}
        {...rest}
      >
        {children}
      </RxAccordion.Root>
    );
  }
  return (
    <RxAccordion.Root
      ref={ref as React.Ref<HTMLDivElement>}
      type="multiple"
      defaultValue={defaultValue as string[] | undefined}
      value={value as string[] | undefined}
      onValueChange={onValueChange as ((value: string[]) => void) | undefined}
      className={cx('v8-accordion', className)}
      {...rest}
    >
      {children}
    </RxAccordion.Root>
  );
});

export interface AccordionItemProps {
  value: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export const AccordionItem = forwardRef<HTMLDivElement, AccordionItemProps>(function AccordionItem(
  props,
  ref,
) {
  const { value, title, description, children, disabled, className } = props;
  return (
    <RxAccordion.Item
      ref={ref}
      value={value}
      disabled={disabled}
      className={cx('v8-accordion__item', className)}
      style={{
        borderBottom: '1px solid var(--border)',
      }}
    >
      <RxAccordion.Header asChild>
        <h3 style={{ margin: 0 }}>
          <RxAccordion.Trigger
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
              padding: 'var(--space-4) 0',
              background: 'transparent',
              border: 0,
              cursor: disabled === true ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 'var(--fs-14)',
              fontWeight: 500,
              color: 'var(--fg)',
              textAlign: 'left',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block' }}>{title}</span>
              {description !== undefined && (
                <span style={{ display: 'block', fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginTop: 2 }}>
                  {description}
                </span>
              )}
            </span>
            <ChevronDown
              size={16}
              aria-hidden="true"
              className="v8-accordion__chevron"
              style={{
                color: 'var(--fg-muted)',
                flexShrink: 0,
                transition: 'transform var(--motion-fast) var(--ease-out)',
              }}
            />
            <style>{`
              .v8-accordion__item button[data-state='open'] .v8-accordion__chevron { transform: rotate(180deg); }
            `}</style>
          </RxAccordion.Trigger>
        </h3>
      </RxAccordion.Header>
      <RxAccordion.Content
        style={{
          overflow: 'hidden',
          fontSize: 'var(--fs-13)',
          color: 'var(--fg-muted)',
        }}
      >
        <div style={{ paddingBottom: 'var(--space-4)' }}>{children}</div>
      </RxAccordion.Content>
    </RxAccordion.Item>
  );
});