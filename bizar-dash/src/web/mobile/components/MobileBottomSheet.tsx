// src/mobile/components/MobileBottomSheet.tsx — slide-up bottom sheet for mobile.
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

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

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="mobile-sheet-overlay" onClick={onClose} aria-modal role="dialog">
      <div
        ref={sheetRef}
        className="mobile-sheet"
        style={{ maxHeight }}
        onClick={(e) => e.stopPropagation()}
        aria-label={title || 'Sheet'}
      >
        {/* Drag handle */}
        <div className="mobile-sheet-handle" />

        {title && (
          <div className="mobile-sheet-header">
            <h3 className="mobile-sheet-title">{title}</h3>
            <button
              type="button"
              className="mobile-icon-btn"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        )}

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
