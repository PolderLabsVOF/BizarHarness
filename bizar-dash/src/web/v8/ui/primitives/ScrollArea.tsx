import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * ScrollArea — a styled scroll container.
 *
 * The browser-native scrollbar is themed via globals.css (--border-strong,
 * --bg). Use this primitive when you want scroll containment with the
 * v8 look-and-feel and a stable scroll shadow at the edges.
 *
 * For Kanban columns (which need horizontal scrolling with sticky shadows),
 * prefer the dedicated KanbanColumn surface (added in Sprint S5).
 */
export interface ScrollAreaProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Direction of overflow. Default 'y' (vertical scroll). */
  direction?: 'x' | 'y' | 'both';
  /** Show a fading shadow at the top when scrolled down. */
  shadowTop?: boolean;
  /** Show a fading shadow at the bottom when content overflows. */
  shadowBottom?: boolean;
  /** Maximum height (e.g. '400px', 'calc(100vh - 200px)'). */
  maxHeight?: string;
  /** Maximum width. */
  maxWidth?: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  props,
  ref,
) {
  const {
    direction = 'y',
    shadowTop,
    shadowBottom,
    maxHeight,
    maxWidth,
    children,
    className,
    style,
    ...rest
  } = props;

  const overflowX = direction === 'x' || direction === 'both' ? 'auto' : 'hidden';
  const overflowY = direction === 'y' || direction === 'both' ? 'auto' : 'hidden';

  const computedStyle: CSSProperties = {
    overflowX,
    overflowY,
    ...(maxHeight !== undefined && { maxHeight }),
    ...(maxWidth !== undefined && { maxWidth }),
    ...style,
  };

  return (
    <div ref={ref} className={cx('v8-scroll-area', className)} style={computedStyle} {...rest}>
      {children}
    </div>
  );
});