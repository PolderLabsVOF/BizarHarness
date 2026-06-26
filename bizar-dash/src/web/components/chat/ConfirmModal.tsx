// src/components/chat/ConfirmModal.tsx — wraps the shared useModal hook.

import { useModal } from '../Modal';
import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onClose,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}: Props) {
  const modal = useModal();

  if (open && !modal.isModalOpen) {
    modal.open({
      title,
      children: (
        <div className="confirm-modal-body">
          {destructive && (
            <div className="confirm-modal-warning"><AlertTriangle size={20} /></div>
          )}
          <p>{message}</p>
          <div className="confirm-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{cancelLabel}</button>
            <button
              type="button"
              className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => { onConfirm(); modal.close(); }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      ),
      onClose,
    });
  }
  return null;
}