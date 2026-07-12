import { forwardRef, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Grid — CSS grid wrapper with token-driven gap and template columns.
 *
 * For responsive grids: pass `cols` as an object { base, sm, md, lg }.
 * Otherwise pass a single number (1..12) for a uniform grid.
 */
export type GridCols =
  | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 12
  | { base?: number; sm?: number; md?: number; lg?: number; xl?: number };

export interface GridProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  as?: ElementType;
  gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;
  rowGap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;
  colGap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;
  cols?: GridCols;
  rows?: 1 | 2 | 3 | 4;
  autoFlow?: 'row' | 'column' | 'dense';
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'stretch';
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

const SPACE_VAR: Record<NonNullable<GridProps['gap']>, string> = {
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

const COLS_VAR: Record<number, string> = {
  1: 'repeat(1, minmax(0, 1fr))',
  2: 'repeat(2, minmax(0, 1fr))',
  3: 'repeat(3, minmax(0, 1fr))',
  4: 'repeat(4, minmax(0, 1fr))',
  5: 'repeat(5, minmax(0, 1fr))',
  6: 'repeat(6, minmax(0, 1fr))',
  8: 'repeat(8, minmax(0, 1fr))',
  12: 'repeat(12, minmax(0, 1fr))',
};

function colsToStyle(cols: GridCols | undefined): CSSProperties {
  if (cols === undefined) return {};
  if (typeof cols === 'number') return { gridTemplateColumns: COLS_VAR[cols] };
  // Responsive object — apply base as the default gridTemplateColumns; the
  // breakpoint variants should be handled by the parent component or a
  // generated class. We export the base here; responsive overrides can
  // compose via additional style overrides at the call site.
  const base = cols.base ?? 1;
  return { gridTemplateColumns: COLS_VAR[base] };
}

const ALIGN_MAP = { start: 'start', center: 'center', end: 'end', stretch: 'stretch' } as const;
const JUSTIFY_MAP = { start: 'start', center: 'center', end: 'end', stretch: 'stretch' } as const;

export const Grid = forwardRef<HTMLElement, GridProps>(function Grid(props, ref) {
  const {
    as,
    gap = 4,
    rowGap,
    colGap,
    cols,
    rows,
    autoFlow,
    align,
    justify,
    children,
    className,
    style,
    ...rest
  } = props;

  const Tag = (as ?? 'div') as ElementType;
  const computedStyle: CSSProperties = {
    display: 'grid',
    gap: SPACE_VAR[gap],
    ...(rowGap !== undefined && { rowGap: SPACE_VAR[rowGap] }),
    ...(colGap !== undefined && { columnGap: SPACE_VAR[colGap] }),
    ...colsToStyle(cols),
    ...(rows !== undefined && { gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }),
    ...(autoFlow !== undefined && { gridAutoFlow: autoFlow }),
    ...(align !== undefined && { alignItems: ALIGN_MAP[align] }),
    ...(justify !== undefined && { justifyItems: JUSTIFY_MAP[justify] }),
    ...style,
  };

  return (
    <Tag ref={ref} className={cx('v8-grid', className)} style={computedStyle} {...rest}>
      {children}
    </Tag>
  );
});