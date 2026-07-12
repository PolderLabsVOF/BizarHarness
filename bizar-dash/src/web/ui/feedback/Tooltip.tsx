/*
 * Tooltip.tsx — Lightweight tooltip wrapper for the Bizar design system (Wave 2C).
 *
 * Wraps a single child element and shows a textual popup on hover or focus
 * after a configurable delay (default 200ms). The popup disappears on
 * pointerleave / blur. Positioning is hand-rolled using absolute CSS over
 * an internal `bizar-tooltip` positioning wrapper — the wrapper owns the
 * `position: relative` containing block so popup children can position
 * themselves against it via the four cardinal sides (top / right /
 * bottom / left). No Radix or Popper.js dep.
 *
 * Accessibility:
 *   - The wrapped child receives `aria-describedby` pointing at the popup id
 *   - The popup carries `role="tooltip"`
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cx } from '../utils/cx';

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

export type TooltipProps = {
  content: ReactNode;
  side?: TooltipSide;
  delay?: number;
  children: ReactElement;
  className?: string;
};

export function Tooltip({
  content,
  side = 'top',
  delay = 200,
  children,
  className,
}: TooltipProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Tear down any pending timer on unmount so we don't update unmounted state.
  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  const show = (): void => {
    clearTimer();
    timerRef.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = (): void => {
    clearTimer();
    setOpen(false);
  };

  if (!isValidElement(children)) {
    throw new Error('Tooltip requires a single React element child.');
  }

  // We pick the first ReactElement's props and add tooltip wiring. We
  // deliberately keep the wrapper element-agnostic — it can be a button,
  // an anchor, or a generic span — by attaching the triggers directly via
  // inline handlers + props. The positioning class lives on an OUTER
  // wrapper (the popup's parent), not on the cloned child, so absolutely-
  // positioned descendants resolve against the wrapper as their containing
  // block — siblings don't share a containing block in CSS.
  type ChildPropsHack = {
    onPointerEnter?: (e: React.PointerEvent) => void;
    onPointerLeave?: (e: React.PointerEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
    'aria-describedby'?: string;
  };

  const childProps = children.props as ChildPropsHack;
  const enhanced = cloneElement(children, {
    onPointerEnter: (e: React.PointerEvent): void => {
      childProps.onPointerEnter?.(e);
      show();
    },
    onPointerLeave: (e: React.PointerEvent): void => {
      childProps.onPointerLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent): void => {
      childProps.onFocus?.(e);
      show();
    },
    onBlur: (e: React.FocusEvent): void => {
      childProps.onBlur?.(e);
      hide();
    },
    'aria-describedby': open ? id : undefined,
  } as ChildPropsHack);

  return (
    <span className={cx('bizar-tooltip', className)}>
      {enhanced}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cx('bizar-tooltip__popup', `bizar-tooltip__popup--${side}`)}
        >
          {content}
        </span>
      )}
    </span>
  );
}
