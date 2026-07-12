import { forwardRef, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Inline — horizontal flexbox row with token-driven gap.
 *
 * Use for icon rows, button groups, breadcrumbs. For wrapping use Cluster.
 */
export interface InlineProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;
  align?: 'start' | 'center' | 'end' | 'baseline' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  wrap?: boolean;
  children?: ReactNode;
  className?: string;
}

const SPACE_VAR: Record<NonNullable<InlineProps['gap']>, string> = {
  0: '0',
  1: 'var(--space-1)',
  2: 'var(--space-2)',
  3: 'var(--space-3)',
  4: 'var(--space-4)',
  5: 'var(--space-5)',
  6: 'var(--space-6)',
  8: 'var(--space-8)',
  10: 'var(--space-10)',
  12: 'var(--space-12)',
  16: 'var(--space-16)',
};

const ALIGN_MAP = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  baseline: 'baseline',
  stretch: 'stretch',
} as const;
const JUSTIFY_MAP = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
} as const;

export const Inline = forwardRef<HTMLElement, InlineProps>(function Inline(props, ref) {
  const {
    as,
    gap = 2,
    align,
    justify,
    wrap,
    children,
    className,
    style,
    ...rest
  } = props;

  const Tag = (as ?? 'div') as ElementType;
  const computedStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    gap: SPACE_VAR[gap],
    ...(align !== undefined && { alignItems: ALIGN_MAP[align] }),
    ...(justify !== undefined && { justifyContent: JUSTIFY_MAP[justify] }),
    ...(wrap && { flexWrap: 'wrap' }),
    ...style,
  };

  return (
    <Tag ref={ref} className={cx('v8-inline', className)} style={computedStyle} {...rest}>
      {children}
    </Tag>
  );
});
