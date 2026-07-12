import { type ElementType, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * VisuallyHidden — hide content visually while keeping it accessible to
 * screen readers and search engines.
 *
 * Use for:
 *   - Labels on icon-only buttons (`<IconButton aria-label="…" />`)
 *   - "Skip to main content" links
 *   - Accessible names for icon groups
 */
export interface VisuallyHiddenProps {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  /** Render visibly if true (debug helper — NEVER true in production code). */
  forceVisible?: boolean;
}

export function VisuallyHidden({
  as,
  children,
  className,
  forceVisible,
}: VisuallyHiddenProps): JSX.Element {
  const Tag = (as ?? 'span') as ElementType;
  if (forceVisible === true) {
    return <Tag className={className}>{children}</Tag>;
  }
  return (
    <Tag
      className={cx('v8-visually-hidden', className)}
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {children}
    </Tag>
  );
}