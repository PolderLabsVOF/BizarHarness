import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portal — render children into document.body.
 *
 * The v8 app uses Radix UI for most popups, but for some app-level surfaces
 * (e.g. the live Cmd+K command palette's focus trap fallback) we still need
 * a thin portal wrapper. This is that wrapper.
 *
 * SSR-safe: returns null on the server. Re-renders the portal after mount.
 */
export interface PortalProps {
  children: ReactNode;
  /** Override the container. Defaults to document.body. */
  container?: HTMLElement | null;
}

export function Portal({ children, container }: PortalProps): JSX.Element | null {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  if (typeof document === 'undefined') return null;

  const target = container ?? document.body;
  if (target === null) return null;

  return createPortal(children, target);
}