import { type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * ButtonGroup — a horizontal cluster of buttons that share borders + radius.
 *
 * Renders a single bordered container with internal dividers so adjacent
 * buttons look like one segmented control.
 */
export interface ButtonGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  attached?: boolean;
}

export function ButtonGroup({ children, attached = true, className, style, ...rest }: ButtonGroupProps) {
  return (
    <div
      role="group"
      className={cx('v8-btn-group', attached && 'is-attached', className)}
      style={{
        display: 'inline-flex',
        border: attached ? '1px solid var(--border)' : 'none',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}