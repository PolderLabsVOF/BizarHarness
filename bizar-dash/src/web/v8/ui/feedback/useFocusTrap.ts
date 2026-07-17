/**
 * useFocusTrap — traps Tab/Shift+Tab focus inside a container.
 *
 * Used by popover/dialog primitives that don't use @radix-ui/react-dialog.
 * Radix Dialog components get this for free; this hook covers the few
 * custom role="dialog" surfaces that remain.
 *
 * ponytail: edge-case (disabled elements, inert) — upgrade to focus-trap npm pkg when needed.
 */

import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
].join(',');

export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean): void {
  const previousFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;

    // Restore focus on unmount.
    previousFocus.current = document.activeElement;
    const container = containerRef.current;

    // Focus first focusable child on mount.
    const first = container.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) { e.preventDefault(); return; }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus();
    };
  }, [active, containerRef]);
}
