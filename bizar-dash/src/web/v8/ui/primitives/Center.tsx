import { forwardRef, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Center — centers its children both horizontally and vertically.
 *
 * Use for splash screens, loading states, modal bodies when there is a
 * single child to center. For full-viewport centering, set `full`.
 */
export interface CenterProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** When true, fills its parent and centers a child inside it. */
  full?: boolean;
  /** Center along main axis only (justifyContent). */
  inline?: boolean;
  /** Disable vertical centering (e.g. only horizontal). */
  noVertical?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export const Center = forwardRef<HTMLElement, CenterProps>(function Center(props, ref) {
  const { as, full, inline, noVertical, children, className, style, ...rest } = props;

  const Tag = (as ?? 'div') as ElementType;
  const computedStyle: CSSProperties = {
    display: inline ? 'inline-flex' : 'flex',
    alignItems: noVertical ? 'stretch' : 'center',
    justifyContent: 'center',
    ...(full && { width: '100%', height: '100%' }),
    ...style,
  };

  return (
    <Tag ref={ref} className={cx('v8-center', className)} style={computedStyle} {...rest}>
      {children}
    </Tag>
  );
});