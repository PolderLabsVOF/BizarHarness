import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Separator — a 1px divider, either horizontal or vertical.
 *
 * Renders as `<div role="separator">`. Use `decorative` to suppress the
 * role for purely visual dividers (still announces for AT).
 */
export interface SeparatorProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  orientation?: 'horizontal' | 'vertical';
  /** When true, treat as decorative — sets `role="presentation"` and aria-hidden. */
  decorative?: boolean;
  /** Token-based color override. */
  tone?: 'border' | 'border-strong';
  className?: string;
  style?: CSSProperties;
}

export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(function Separator(props, ref) {
  const { orientation = 'horizontal', decorative, tone = 'border', className, style, ...rest } = props;

  const computedStyle: CSSProperties = {
    background: `var(--${tone})`,
    ...(orientation === 'horizontal'
      ? { height: '1px', width: '100%' }
      : { width: '1px', height: '100%', alignSelf: 'stretch' }),
    ...style,
  };

  return (
    <div
      ref={ref}
      role={decorative ? 'presentation' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      aria-hidden={decorative ? 'true' : undefined}
      className={cx('v8-separator', className)}
      style={computedStyle}
      {...rest}
    />
  );
});