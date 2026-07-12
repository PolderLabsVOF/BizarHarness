import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import * as RxTooltip from '@radix-ui/react-tooltip';
import { cx } from '../utils/cx.js';

/**
 * Tooltip — small popup with descriptive text.
 *
 * Built on Radix Tooltip. Per DESIGN.md §10:
 *   - tooltip on disabled controls is BANNED — use inline helper text
 *   - never put interactive content inside a tooltip
 */
export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';
export type TooltipAlign = 'start' | 'center' | 'end';

export interface TooltipProps extends Omit<ComponentPropsWithoutRef<typeof RxTooltip.Root>, 'children'> {
  children: ReactNode;
  content: ReactNode;
  side?: TooltipSide;
  align?: TooltipAlign;
  delayDuration?: number;
  shortcut?: string;
}

export const TooltipProvider = RxTooltip.Provider;

export const Tooltip = forwardRef<HTMLDivElement, TooltipProps>(function Tooltip(props, ref) {
  const {
    children,
    content,
    side = 'top',
    align = 'center',
    delayDuration = 250,
    shortcut,
    open,
    defaultOpen,
    onOpenChange,
  } = props;

  return (
    <RxTooltip.Root
      delayDuration={delayDuration}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      <RxTooltip.Trigger asChild>{children}</RxTooltip.Trigger>
      <RxTooltip.Portal>
        <RxTooltip.Content
          ref={ref}
          side={side}
          align={align}
          sideOffset={6}
          className={cx('v8-tooltip')}
          style={{
            background: 'var(--fg)',
            color: 'var(--bg)',
            fontSize: 'var(--fs-12)',
            fontWeight: 500,
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-2)',
            maxWidth: 280,
            zIndex: 'var(--z-tooltip)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            userSelect: 'none',
          }}
        >
          {content}
          {shortcut !== undefined && (
            <kbd
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-12)',
                padding: '0 4px',
                background: 'oklch(from var(--fg) l c h / 0.15)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {shortcut}
            </kbd>
          )}
          <RxTooltip.Arrow style={{ fill: 'var(--fg)' }} />
        </RxTooltip.Content>
      </RxTooltip.Portal>
    </RxTooltip.Root>
  );
});