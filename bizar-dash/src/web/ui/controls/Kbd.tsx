/*
 * Kbd.tsx — keyboard-shortcut affordance (Wave 2A).
 *
 * Renders a single key glyph (or short label) inside a <kbd> element
 * styled with a hairline border + monospace font. Use for inline
 * shortcut hints next to menu items, command palette entries, or any
 * place a user needs to see "this is a keyboard shortcut". Stacking
 * multiple Kbds inline renders a "⌘ K" / "Ctrl K" style hint.
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx';

export type KbdProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
};

export function Kbd({ children, className, ...rest }: KbdProps): React.JSX.Element {
  return (
    <kbd className={cx('kbd', className)} {...rest}>
      {children}
    </kbd>
  );
}
