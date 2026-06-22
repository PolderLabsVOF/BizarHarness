// src/mobile/components/MobileModal.tsx — full-screen mobile modal.
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

export function MobileModal({ open, onClose, title, children, actions }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const scrollLockYRef = useRef(0);

  useEffect(() => {
    if (!open) return;

    lastActiveRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;

      const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
      if (focusable.length === 0) {
        e.preventDefault();
        modalRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (!active || active === first || active === modalRef.current) {
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
    scrollLockYRef.current = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollLockYRef.current}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    requestAnimationFrame(() => {
      closeButtonRef.current?.focus() ?? modalRef.current?.focus();
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollLockYRef.current);
      lastActiveRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="mobile-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="mobile-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label={title ? undefined : 'Modal'}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <div className="mobile-modal-header">
          {title ? <h2 id={titleId} className="mobile-modal-title">{title}</h2> : <div />}
          <button
            ref={closeButtonRef}
            type="button"
            className="mobile-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="mobile-modal-content">
          {children}
        </div>
        {actions && (
          <div className="mobile-modal-actions">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
