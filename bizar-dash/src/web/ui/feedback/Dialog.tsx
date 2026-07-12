/*
 * Dialog.tsx — Modal dialog for the Bizar design system (Wave 2C).
 *
 * Backed by `react-dom` portals: rendered into `document.body` so it sits
 * above the rest of the page chrome and stacking-context issues don't
 * trap it inside a parent with overflow / transform. Backdrop click +
 * Escape close the dialog unless `persistent` is true, in which case
 * the user must use the close button or the actions slot to dismiss.
 *
 * Accessibility:
 *   - `role="dialog"`, `aria-modal="true"`, `aria-labelledby` + `aria-describedby`
 *   - Focus is moved to the first focusable child (or the dialog itself) on open
 *   - Tab/Shift+Tab cycle within the dialog only
 *   - On close, focus is restored to the element that was active when the
 *     dialog opened
 *
 * Coexists with the legacy `<ModalProvider>` from src/components/Modal —
 * the two context names are different, so a single tree can hold both.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '../utils/cx';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  width?: number;
  /** When true, Escape and backdrop clicks do not close the dialog. */
  persistent?: boolean;
  className?: string;
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  width,
  persistent = false,
  className,
}: DialogProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Escape key — close unless persistent.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!persistent) onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, persistent, onClose]);

  // Lock body scroll while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Initial focus + focus trap + restore focus on close.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const root = dialogRef.current;
    if (!root) return;

    // Focus the first focusable child or the dialog itself.
    const initialFocus = (): void => {
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.tabIndex !== -1);
      const target = focusables[0] ?? root;
      target.focus();
    };
    initialFocus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.tabIndex !== -1);
      if (focusables.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !root.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const previous = previousFocusRef.current;
      if (previous && previous.isConnected) {
        previous.focus();
      }
    };
  }, [open]);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (persistent) return;
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [persistent, onClose],
  );

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="bizar-dialog-backdrop"
      onClick={onBackdropClick}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={cx('bizar-dialog', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        style={width ? { maxWidth: width } : undefined}
      >
        {(title || description) && (
          <div className="bizar-dialog__header">
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && (
                <h2 id={titleId} className="bizar-dialog__title">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descriptionId} className="bizar-dialog__description">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              className="bizar-dialog__close"
              aria-label="Close dialog"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="bizar-dialog__body">{children}</div>
        {actions && <div className="bizar-dialog__actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}
