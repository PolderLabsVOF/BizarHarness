import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Kbd — keyboard key chip. Use inside Tooltips, ContextMenu shortcuts,
 * Settings — Keyboard page, etc.
 */
export interface KbdProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Use on a dark surface where the default light bg won't show. */
  inverted?: boolean;
}

export const Kbd = forwardRef<HTMLElement, KbdProps>(function Kbd(props, ref) {
  const { children, inverted, className, style, ...rest } = props;
  return (
    <kbd
      ref={ref}
      className={cx('v8-kbd', inverted && 'is-inverted', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '1.4em',
        height: '1.4em',
        padding: '0 6px',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-12)',
        fontWeight: 500,
        color: inverted === true ? 'var(--bg)' : 'var(--fg-muted)',
        background: inverted === true ? 'var(--fg)' : 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderBottomWidth: 2,
        borderRadius: 'var(--radius-sm)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </kbd>
  );
});