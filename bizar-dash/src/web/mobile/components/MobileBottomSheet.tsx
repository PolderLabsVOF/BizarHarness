// src/mobile/components/MobileBottomSheet.tsx — slide-up bottom sheet for mobile.
import { useEffect, useId, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  maxHeight?: string;
};

export function MobileBottomSheet({ open, onClose, title, children, actions, maxHeight = '85vh' }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const lastActiveRef = useRef<HTMLElement | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const dragDeltaRef = useRef(0);
  const scrollLockYRef = useRef(0);

  const getFocusable = () => {
    return sheetRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [];
  };

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    lastActiveRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;

      const focusable = Array.from(getFocusable());
      if (focusable.length === 0) {
        e.preventDefault();
        sheetRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (!active || active === first || active === sheetRef.current) {
          e.preventDefault();
          last?.focus();
        }
        return;
      }

      if (active === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      closeButtonRef.current?.focus() ?? sheetRef.current?.focus();
    });

    return () => {
      window.removeEventListener('keydown', onKey);
      lastActiveRef.current?.focus();
    };
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      scrollLockYRef.current = window.scrollY;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollLockYRef.current}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
    }
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollLockYRef.current);
    };
  }, [open]);

  if (!open) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    dragStartYRef.current = e.clientY;
    dragDeltaRef.current = 0;
    sheetRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartYRef.current == null || !sheetRef.current) return;
    const delta = Math.max(0, e.clientY - dragStartYRef.current);
    dragDeltaRef.current = delta;
    sheetRef.current.style.transform = `translateY(${delta}px)`;
  };

  const endDrag = (e?: ReactPointerEvent<HTMLDivElement>) => {
    if (!sheetRef.current) return;
    if (e && sheetRef.current.hasPointerCapture(e.pointerId)) {
      sheetRef.current.releasePointerCapture(e.pointerId);
    }
    const delta = dragDeltaRef.current;
    sheetRef.current.style.transform = '';
    dragStartYRef.current = null;
    dragDeltaRef.current = 0;
    if (delta > 72) onClose();
  };

  return (
    <div className="mobile-sheet-overlay" onClick={onClose}>
      <div
        ref={sheetRef}
        className="mobile-sheet"
        style={{ maxHeight }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label={title ? undefined : 'Sheet'}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        {/* Drag handle */}
        <div
          className="mobile-sheet-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-hidden="true"
        />

        <div className="mobile-sheet-header">
          {title ? <h3 id={titleId} className="mobile-sheet-title">{title}</h3> : <div />}
          <button
            ref={closeButtonRef}
            type="button"
            className="mobile-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mobile-sheet-content">
          {children}
        </div>

        {actions && (
          <div className="mobile-sheet-actions">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
