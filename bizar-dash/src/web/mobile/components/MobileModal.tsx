// src/mobile/components/MobileModal.tsx — full-screen mobile modal.
import { useEffect } from 'react';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

export function MobileModal({ open, onClose, title, children, actions }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="mobile-modal-overlay" onClick={onClose}>
      <div
        className="mobile-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label={title}
      >
        <div className="mobile-modal-header">
          <h2 className="mobile-modal-title">{title}</h2>
          <button
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
