// src/components/Modal.tsx — modal context + provider + portal.

import {
  createContext,
  useId,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
  isModalOpen: boolean;
};

const ModalContext = createContext<ModalApi | null>(null);

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useModal(): ModalApi {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    return { open: () => '', close: () => undefined, isModalOpen: false };
  }
  return ctx;
}

type OpenModal = ModalProps & { id: string };

export function ModalProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<OpenModal[]>([]);

  const close = useCallback((id?: string) => {
    setStack((cur) => {
      if (!id) return cur.slice(0, -1);
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
    <ModalContext.Provider value={{ open, close, isModalOpen: stack.length > 0 }}>
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
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const getFocusableElements = (): HTMLElement[] => {
    const root = modalRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
    );
  };

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusable = getFocusableElements();
    (focusable[0] ?? modalRef.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        e.preventDefault();
        modalRef.current?.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (e.shiftKey) {
        if (!active || active === first || !modalRef.current?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last || !modalRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const previous = previousFocusRef.current;
      if (previous && previous.isConnected) previous.focus();
    };
  }, []);

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
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={modal.title ? titleId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={modal.width ? { maxWidth: modal.width } : undefined}
      >
        {modal.title && (
          <header className="modal-header">
            <h2 id={titleId} className="modal-title">{modal.title}</h2>
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
