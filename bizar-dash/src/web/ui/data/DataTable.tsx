/*
 * DataTable.tsx — Sortable data table (Wave 2B).
 *
 * The most complex data component. Sticky header, click-to-sort columns,
 * controlled/uncontrolled sort state, custom cell renderers, empty and
 * loading states, optional compact row padding. Sort logic uses the column's
 * `accessor` (or falls back to identity) and handles string vs numeric
 * comparison correctly. Click-to-select rows via onRowClick. The table is a
 * two-element scroll container so the sticky header stays pinned even on
 * vertically-long data sets inside a constrained card.
 */

import {
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cx } from '../utils/cx';

export type DataTableColumn<T> = {
  key: string;
  header: string;
  width?: string | number;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  render?: (row: T) => ReactNode;
  accessor?: (row: T) => string | number;
};

export type DataTableSort = {
  key: string;
  direction: 'asc' | 'desc';
};

export type DataTableProps<T> = {
  columns: Array<DataTableColumn<T>>;
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;
  empty?: ReactNode;
  loading?: boolean;
  compact?: boolean;
  className?: string;
};

function defaultAccessor<T>(row: T): string | number {
  // Fall back to identity when an accessor isn't provided. T may be any
  // shape, so we use a best-effort cast.
  if (row == null) return '';
  if (typeof row === 'string' || typeof row === 'number') return row;
  return String(row);
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  sort: controlledSort,
  onSortChange,
  empty,
  loading = false,
  compact = false,
  className,
}: DataTableProps<T>): React.JSX.Element {
  const [internalSort, setInternalSort] = useState<DataTableSort | null>(null);
  const sort = controlledSort ?? internalSort;

  const sortedData = useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return data;
    const accessor = col.accessor ?? defaultAccessor;
    const copy = [...data];
    copy.sort((a, b) => {
      const cmp = compareValues(accessor(a), accessor(b));
      return sort.direction === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [data, columns, sort]);

  const handleSort = (key: string): void => {
    const next: DataTableSort | null =
      !sort || sort.key !== key
        ? { key, direction: 'asc' }
        : sort.direction === 'asc'
          ? { key, direction: 'desc' }
          : null;
    if (controlledSort === undefined) {
      setInternalSort(next);
    }
    onSortChange?.(next);
  };

  const renderBody = (): ReactNode => {
    if (loading) {
      const skeletonCols = columns.length;
      return (
        <>
          {Array.from({ length: 3 }).map((_, i) => (
            <tr key={`skel-${i}`} className="bd-data-table__skeleton-row">
              {Array.from({ length: skeletonCols }).map((__, j) => (
                <td key={`skel-${i}-${j}`}>
                  <div className="bd-data-table__skeleton" />
                </td>
              ))}
            </tr>
          ))}
        </>
      );
    }
    if (sortedData.length === 0) {
      return (
        <tr>
          <td colSpan={columns.length} className="bd-data-table__empty">
            {empty ?? 'No data'}
          </td>
        </tr>
      );
    }
    return sortedData.map((row) => (
      <tr
        key={rowKey(row)}
        className={cx(onRowClick && 'bd-data-table__row--clickable')}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
      >
        {columns.map((col) => (
          <td
            key={col.key}
            className={cx(
              'bd-data-table__td',
              col.align === 'right' && 'bd-data-table__td--right',
              col.align === 'center' && 'bd-data-table__td--center',
            )}
          >
            {col.render
              ? col.render(row)
              : String(col.accessor ? col.accessor(row) : '')}
          </td>
        ))}
      </tr>
    ));
  };

  return (
    <div
      className={cx(
        'bd-data-table',
        compact && 'bd-data-table--compact',
        className,
      )}
    >
      <div className="bd-data-table__scroll">
        <table className="bd-data-table__table">
          <thead className="bd-data-table__thead">
            <tr className="bd-data-table__tr">
              {columns.map((col) => {
                const isSorted = sort?.key === col.key;
                const style: CSSProperties | undefined =
                  col.width !== undefined
                    ? { width: col.width }
                    : undefined;
                return (
                  <th
                    key={col.key}
                    style={style}
                    className={cx(
                      'bd-data-table__th',
                      col.align === 'right' && 'bd-data-table__th--right',
                      col.align === 'center' && 'bd-data-table__th--center',
                      col.sortable && 'bd-data-table__th--sortable',
                      isSorted && 'bd-data-table__th--sorted',
                    )}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                    aria-sort={
                      isSorted
                        ? sort!.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    {col.header}
                    {col.sortable && (
                      <span className="bd-data-table__sort-icon">
                        {isSorted ? (
                          sort!.direction === 'asc' ? (
                            <ArrowUp size={12} aria-hidden="true" />
                          ) : (
                            <ArrowDown size={12} aria-hidden="true" />
                          )
                        ) : (
                          <ChevronsUpDown size={12} aria-hidden="true" />
                        )}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="bd-data-table__tbody">{renderBody()}</tbody>
        </table>
      </div>
    </div>
  );
}
