import { forwardRef, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Stack — vertical flexbox column with token-driven gap and align.
 *
 * Use this for the 90% case of "I need a column of stuff with space
 * between them". For horizontal use Inline/Cluster; for grid use Grid.
 */
export interface StackProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** Gap — uses --space-* tokens. */
  gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  wrap?: boolean;
  children?: ReactNode;
  className?: string;
}

const SPACE_VAR: Record<NonNullable<StackProps['gap']>, string> = {
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

const ALIGN_MAP = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' } as const;
const JUSTIFY_MAP = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
} as const;

export const Stack = forwardRef<HTMLElement, StackProps>(function Stack(props, ref) {
  const {
    as,
    gap = 3,
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
    flexDirection: 'column',
    gap: SPACE_VAR[gap],
    ...(align !== undefined && { alignItems: ALIGN_MAP[align] }),
    ...(justify !== undefined && { justifyContent: JUSTIFY_MAP[justify] }),
    ...(wrap && { flexWrap: 'wrap' }),
    ...style,
  };

  return (
    <Tag ref={ref} className={cx('v8-stack', className)} style={computedStyle} {...rest}>
      {children}
    </Tag>
  );
});