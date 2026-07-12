/*
 * Toast.tsx — Self-contained toast provider + hook (Wave 2C).
 *
 * Replaces the legacy useToast API in src/components/Toast.tsx but lives
 * under a different context name (`BizarToastContext`) so the legacy
 * provider and the new provider can coexist in the same tree. The hook
 * throws when used outside a provider — a missing provider is a developer
 * error, not a runtime fallback.
 *
 * Defaults: 4000ms duration, errors pin to 6000ms, viewport pinned to the
 * bottom-right (`fixed`), max 5 toasts visible at once. New toasts past
 * the cap evict the oldest. Manual dismiss via the close button or
 * imperatively via `useToast().dismiss(id)`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from 'lucide-react';
import { cx } from '../utils/cx';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

export type ToastApi = {
  info: (message: string, durationMs?: number) => number;
  success: (message: string, durationMs?: number) => number;
  warning: (message: string, durationMs?: number) => number;
  error: (message: string, durationMs?: number) => number;
  dismiss: (id: number) => void;
};

const BizarToastContext = createContext<ToastApi | null>(null);

const MAX_VISIBLE = 5;
const DEFAULT_DURATION = 4000;
const ERROR_DURATION = 6000;

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

export function useToast(): ToastApi {
  const ctx = useContext(BizarToastContext);
  if (!ctx) {
    throw new Error(
      'useToast must be used inside a <ToastProvider>. ' +
        'Wrap your app root in <ToastProvider> before calling useToast().',
    );
  }
  return ctx;
}

export type ToastProviderProps = {
  children: ReactNode;
  /** Override the cap for tests and unusual surfaces. Default 5. */
  maxVisible?: number;
};

export function ToastProvider({
  children,
  maxVisible = MAX_VISIBLE,
}: ToastProviderProps): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(1);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, durationMs?: number): number => {
      const id = idRef.current++;
      setToasts((cur) => {
        const next = [...cur, { id, kind, message }];
        // Evict oldest if we exceed the visible cap. Use queue-style FIFO.
        if (next.length > maxVisible) {
          const toEvict = next.slice(0, next.length - maxVisible);
          for (const t of toEvict) {
            const timer = timersRef.current.get(t.id);
            if (timer) {
              clearTimeout(timer);
              timersRef.current.delete(t.id);
            }
          }
          return next.slice(-maxVisible);
        }
        return next;
      });
      const effective =
        durationMs ??
        (kind === 'error' ? ERROR_DURATION : DEFAULT_DURATION);
      if (effective > 0) {
        const timer = setTimeout(() => dismiss(id), effective);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss, maxVisible],
  );

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      info: (m, d) => push('info', m, d),
      success: (m, d) => push('success', m, d),
      warning: (m, d) => push('warning', m, d),
      error: (m, d) => push('error', m, d),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <BizarToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </BizarToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}): React.JSX.Element {
  return (
    <div className="bizar-toast-viewport" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}): React.JSX.Element {
  const Icon = ICONS[toast.kind];
  return (
    <div
      className={cx('bizar-toast', `bizar-toast--${toast.kind}`)}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <span className="bizar-toast__icon">
        <Icon size={16} />
      </span>
      <span className="bizar-toast__message">{toast.message}</span>
      <button
        type="button"
        className="bizar-toast__close"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        <X size={14} />
      </button>
    </div>
  );
}
