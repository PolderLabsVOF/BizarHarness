import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';
import { CheckCircle2, AlertCircle, Info, XCircle } from 'lucide-react';
import { type ReactNode } from 'react';

/**
 * Toast — transient feedback notifications.
 *
 * Built on `sonner` (the same library Linear + Vercel use). Wire the
 * `<Toaster />` once at the app root; then call `toast.*` from anywhere.
 *
 * Per DESIGN.md §9: optimistic mutations rollback with a toast.
 */

export interface ToasterProps {
  position?: 'top-right' | 'top-center' | 'top-left' | 'bottom-right' | 'bottom-center' | 'bottom-left';
}

export function Toaster({ position = 'bottom-right' }: ToasterProps): JSX.Element {
  return (
    <SonnerToaster
      position={position}
      theme="system"
      toastOptions={{
        style: {
          background: 'var(--surface-popover)',
          color: 'var(--fg)',
          border: '1px solid var(--border)',
          fontSize: 'var(--fs-13)',
        },
      }}
      icons={{
        success: <CheckCircle2 size={16} aria-hidden="true" style={{ color: 'var(--success)' }} />,
        info: <Info size={16} aria-hidden="true" style={{ color: 'var(--info)' }} />,
        warning: <AlertCircle size={16} aria-hidden="true" style={{ color: 'var(--warning)' }} />,
        error: <XCircle size={16} aria-hidden="true" style={{ color: 'var(--danger)' }} />,
      }}
    />
  );
}

export interface ToastOptions {
  description?: ReactNode;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export const toast = {
  success(message: string, opts?: ToastOptions): string | number {
    return sonnerToast.success(message, opts as never);
  },
  error(message: string, opts?: ToastOptions): string | number {
    return sonnerToast.error(message, opts as never);
  },
  info(message: string, opts?: ToastOptions): string | number {
    return sonnerToast.info(message, opts as never);
  },
  warning(message: string, opts?: ToastOptions): string | number {
    return sonnerToast.warning(message, opts as never);
  },
  message(message: string, opts?: ToastOptions): string | number {
    return sonnerToast.message(message, opts as never);
  },
  dismiss(id?: string | number): void {
    sonnerToast.dismiss(id);
  },
};