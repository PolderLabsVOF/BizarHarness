import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import * as RxDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * Dialog — modal panel.
 *
 * Built on Radix Dialog for focus trap + escape handling.
 *
 * Sizing:
 *   - sm  : 360px  (confirmations)
 *   - md  : 560px  (forms, kanban detail)
 *   - lg  : 800px  (rich content)
 *   - full: 100%   (rare; long-running tasks)
 *
 * No nested modals per DESIGN.md §10 (banned trope).
 */

export type DialogSize = 'sm' | 'md' | 'lg' | 'full';

export interface DialogProps extends ComponentPropsWithoutRef<typeof RxDialog.Root> {
  children: ReactNode;
}

export const Dialog = ({ children, ...rest }: DialogProps) => (
  <RxDialog.Root {...rest}>{children}</RxDialog.Root>
);

export const DialogTrigger = RxDialog.Trigger;
export const DialogClose = RxDialog.Close;
export const DialogPortal = RxDialog.Portal;

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof RxDialog.Content> {
  size?: DialogSize;
  /** Title used for the screen-reader announcement. Prefer visible title via `title` prop. */
  title: string;
  /** Optional description; paired with title for a11y. */
  description?: string;
  /** Hide the explicit close button. Useful for AlertDialog (only OK/Cancel). */
  hideClose?: boolean;
}

const WIDTH: Record<DialogSize, string> = {
  sm: '420px',
  md: '560px',
  lg: '800px',
  full: '100%',
};

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent(
  props,
  ref,
) {
  const { className, size = 'md', title, description, hideClose, children, ...rest } = props;
  return (
    <RxDialog.Portal>
      <RxDialog.Overlay
        className="v8-dialog-overlay"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'oklch(0 0 0 / 0.4)',
          backdropFilter: 'none',
          zIndex: 'var(--z-modal)',
          animation: 'v8-dialog-overlay-in var(--motion-base) var(--ease-out)',
        }}
      />
      <RxDialog.Content
        ref={ref}
        className={cx('v8-dialog-content', className)}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: WIDTH[size],
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 64px)',
          background: 'var(--surface-popover)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-4)',
          padding: 'var(--space-6)',
          overflow: 'auto',
          zIndex: 'calc(var(--z-modal) + 1)',
          animation: 'v8-dialog-content-in var(--motion-base) var(--ease-out)',
        }}
        {...rest}
      >
        <RxDialog.Title
          style={{
            fontSize: 'var(--fs-18)',
            fontWeight: 600,
            marginBottom: description !== undefined ? 'var(--space-1)' : 'var(--space-4)',
          }}
        >
          {title}
        </RxDialog.Title>
        {description !== undefined && (
          <RxDialog.Description
            style={{
              fontSize: 'var(--fs-13)',
              color: 'var(--fg-muted)',
              marginBottom: 'var(--space-4)',
            }}
          >
            {description}
          </RxDialog.Description>
        )}
        {children}
        {hideClose !== true && (
          <RxDialog.Close
            aria-label="Close"
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
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
        )}
      </RxDialog.Content>
    </RxDialog.Portal>
  );
});

/**
 * AlertDialog — a confirmation dialog (always has at least one Cancel-style action).
 *
 * Built on top of Dialog. The semantic difference matters for screen readers:
 * <AlertDialog> announces "alert" while <Dialog> doesn't.
 */
export const AlertDialog = RxDialog.Root;
export const AlertDialogTrigger = RxDialog.Trigger;
export const AlertDialogAction = RxDialog.Close;
export const AlertDialogCancel = RxDialog.Close;
export const AlertDialogContent = DialogContent;