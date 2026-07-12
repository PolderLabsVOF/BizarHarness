import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import * as RxDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * Sheet — a side-anchored panel.
 *
 * Use for: task detail, agent detail, settings panels (mobile), kanban card
 * expanded. Use a Dialog when the content is best presented centered.
 */

export type SheetSide = 'top' | 'right' | 'bottom' | 'left';

export interface SheetProps extends Omit<ComponentPropsWithoutRef<typeof RxDialog.Root>, 'children'> {
  children: ReactNode;
}

export const Sheet = ({ children, ...rest }: SheetProps) => (
  <RxDialog.Root {...rest}>{children}</RxDialog.Root>
);

export const SheetTrigger = RxDialog.Trigger;
export const SheetClose = RxDialog.Close;

export interface SheetContentProps extends ComponentPropsWithoutRef<typeof RxDialog.Content> {
  side?: SheetSide;
  title: string;
  description?: string;
  children: ReactNode;
}

const SIDE_STYLE: Record<SheetSide, React.CSSProperties> = {
  top: { top: 0, left: 0, right: 0, height: '60vh', borderBottom: '1px solid var(--border)', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)' },
  right: { top: 0, right: 0, bottom: 0, width: 'min(560px, 100vw)', borderLeft: '1px solid var(--border)' },
  bottom: { bottom: 0, left: 0, right: 0, height: '60vh', borderTop: '1px solid var(--border)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' },
  left: { top: 0, left: 0, bottom: 0, width: 'min(560px, 100vw)', borderRight: '1px solid var(--border)' },
};

export const SheetContent = forwardRef<HTMLDivElement, SheetContentProps>(function SheetContent(
  props,
  ref,
) {
  const { className, side = 'right', title, description, children, ...rest } = props;
  return (
    <RxDialog.Portal>
      <RxDialog.Overlay
        style={{
          position: 'fixed',
          inset: 0,
          background: 'oklch(0 0 0 / 0.4)',
          zIndex: 'var(--z-modal)',
        }}
      />
      <RxDialog.Content
        ref={ref}
        data-side={side}
        className={cx('v8-sheet', className)}
        style={{
          position: 'fixed',
          background: 'var(--surface-popover)',
          padding: 'var(--space-6)',
          overflow: 'auto',
          boxShadow: 'var(--shadow-4)',
          zIndex: 'calc(var(--z-modal) + 1)',
          ...SIDE_STYLE[side],
        }}
        {...rest}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <div>
            <RxDialog.Title style={{ fontSize: 'var(--fs-18)', fontWeight: 600 }}>{title}</RxDialog.Title>
            {description !== undefined && (
              <RxDialog.Description
                style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginTop: 'var(--space-1)' }}
              >
                {description}
              </RxDialog.Description>
            )}
          </div>
          <RxDialog.Close
            aria-label="Close"
            style={{
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 0,
              borderRadius: 'var(--radius-sm)',
              color: 'var(--fg-muted)',
              cursor: 'pointer',
            }}
          >
            <X size={16} aria-hidden="true" />
          </RxDialog.Close>
        </div>
        {children}
      </RxDialog.Content>
    </RxDialog.Portal>
  );
});