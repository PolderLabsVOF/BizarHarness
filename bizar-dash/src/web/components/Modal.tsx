// src/components/Modal.tsx — modal context + provider + portal.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export type ModalProps = {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  width?: number;
};

export type ModalApi = {
  open: (props: ModalProps) => string;
  close: (id?: string) => void;
};

const ModalContext = createContext<ModalApi | null>(null);

export function useModal(): ModalApi {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    return { open: () => '', close: () => undefined };
  }
  return ctx;
}

type OpenModal = ModalProps & { id: string };

export function ModalProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<OpenModal[]>([]);

  const close = useCallback((id?: string) => {
    setStack((cur) => {
      if (!id) return [];
      const idx = cur.findIndex((m) => m.id === id);
      if (idx === -1) return cur;
      // close only the top-most matching
      if (idx !== cur.length - 1) return cur;
      return cur.slice(0, -1);
    });
  }, []);

  const open = useCallback((props: ModalProps) => {
    const id = `m${Math.random().toString(36).slice(2, 9)}`;
    setStack((cur) => [...cur, { ...props, id }]);
    return id;
  }, []);

  // Escape key — close the topmost
  useEffect(() => {
    if (stack.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [stack.length, close]);

  return (
    <ModalContext.Provider value={{ open, close }}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="modal-stack" aria-hidden={stack.length === 0}>
            {stack.map((m, idx) => (
              <ModalShell
                key={m.id}
                modal={m}
                onClose={() => {
                  m.onClose?.();
                  close(m.id);
                }}
                depth={idx}
              />
            ))}
          </div>,
          document.body,
        )}
    </ModalContext.Provider>
  );
}

function ModalShell({
  modal,
  onClose,
  depth,
}: {
  modal: OpenModal;
  onClose: () => void;
  depth: number;
}) {
  // v3.3.0 — Backdrop click stops propagation. This stops a click on
  // the dim area from bubbling to the document/App level where it
  // could otherwise be misread by the digit-key shortcut handler
  // (the click that closes the modal would otherwise leave focus on
  // <body>, and any subsequent accidental digit press would fire
  // setActiveTab("overview")). The click itself only fires onClose()
  // when the user actually clicked the backdrop, not a child.
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      style={depth > 0 ? { background: 'rgba(0,0,0,0.4)' } : undefined}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={modal.width ? { maxWidth: modal.width } : undefined}
      >
        {modal.title && (
          <header className="modal-header">
            <h2 className="modal-title">{modal.title}</h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </header>
        )}
        <div className="modal-body">{modal.children}</div>
        {modal.footer && <footer className="modal-footer">{modal.footer}</footer>}
      </div>
    </div>
  );
}
