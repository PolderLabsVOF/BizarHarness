import { forwardRef, type HTMLAttributes, type ReactNode, type ThHTMLAttributes, type TdHTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Table — semantic data table primitives.
 *
 * This is a thin wrapper around native <table> elements, providing the
 * v8 token-driven visuals. For sorting / pagination / virtualization,
 * wrap with TanStack Table at the call site (Sprint S3 follow-up).
 */

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
  /** Compact row height (default comfortable = 36px). */
  density?: 'comfortable' | 'compact';
}

export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(props, ref) {
  const { children, density = 'comfortable', className, ...rest } = props;
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        background: 'var(--surface-1)',
      }}
    >
      <table
        ref={ref}
        className={cx('v8-table', `v8-table--${density}`, className)}
        style={{
          width: '100%',
          borderCollapse: 'separate',
          borderSpacing: 0,
          fontSize: 'var(--fs-13)',
          color: 'var(--fg)',
        }}
        {...rest}
      >
        {children}
      </table>
    </div>
  );
});

export interface TableHeadProps extends HTMLAttributes<HTMLTableSectionElement> {
  children: ReactNode;
}

export const TableHead = forwardRef<HTMLTableSectionElement, TableHeadProps>(function TableHead(
  props,
  ref,
) {
  const { children, ...rest } = props;
  return (
    <thead
      ref={ref}
      style={{
        background: 'var(--surface-0)',
        borderBottom: '1px solid var(--border)',
        textAlign: 'left',
        fontSize: 'var(--fs-12)',
        fontWeight: 600,
        color: 'var(--fg-muted)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-wide)',
      }}
      {...rest}
    >
      {children}
    </thead>
  );
});

export interface TableBodyProps extends HTMLAttributes<HTMLTableSectionElement> {
  children: ReactNode;
}

export const TableBody = forwardRef<HTMLTableSectionElement, TableBodyProps>(function TableBody(
  props,
  ref,
) {
  return <tbody ref={ref} {...props} />;
});

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Highlight the row (e.g. selected). */
  selected?: boolean;
  /** Stripe the row background. */
  striped?: boolean;
}

export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow(
  props,
  ref,
) {
  const { selected, striped, className, style, ...rest } = props;
  return (
    <tr
      ref={ref}
      className={cx('v8-table__row', selected && 'is-selected', className)}
      style={{
        background: selected === true
          ? 'var(--accent-soft)'
          : striped === true
            ? 'var(--surface-0)'
            : 'transparent',
        borderBottom: '1px solid var(--border)',
        transition: 'background var(--motion-fast) var(--ease-out)',
        ...style,
      }}
      {...rest}
    />
  );
});

export interface TableHeaderProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Right-align numeric columns. */
  align?: 'left' | 'right' | 'center';
  /** Width constraint. */
  width?: number | string;
}

export const TableHeader = forwardRef<HTMLTableCellElement, TableHeaderProps>(function TableHeader(
  props,
  ref,
) {
  const { align = 'left', width, className, style, ...rest } = props;
  return (
    <th
      ref={ref}
      className={cx('v8-table__th', className)}
      style={{
        padding: 'var(--space-2) var(--space-3)',
        textAlign: align,
        width,
        ...style,
      }}
      {...rest}
    />
  );
});

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right' | 'center';
  /** Use the density-row-h height token (default true). */
  rowHeight?: boolean;
}

export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(function TableCell(
  props,
  ref,
) {
  const { align = 'left', rowHeight = true, className, style, ...rest } = props;
  return (
    <td
      ref={ref}
      className={cx('v8-table__td', className)}
      style={{
        padding: 'var(--space-2) var(--space-3)',
        textAlign: align,
        height: rowHeight === true ? 'var(--density-row-h)' : undefined,
        verticalAlign: 'middle',
        ...style,
      }}
      {...rest}
    />
  );
});