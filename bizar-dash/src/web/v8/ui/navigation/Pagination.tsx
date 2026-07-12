import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * Pagination — numbered pages with prev/next/first/last controls.
 *
 * Use cases: Tasks list, Activity feed, Memory browser.
 *
 * For infinite-scroll lists use ScrollArea + sentinel instead.
 */
export interface PaginationProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  /** Show first/last buttons (default true). */
  showEdges?: boolean;
  /** Sibling count around current page (default 1). */
  siblingCount?: number;
}

function buildPages(current: number, total: number, siblings: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const left = Math.max(2, current - siblings);
  const right = Math.min(total - 1, current + siblings);
  const pages: (number | 'ellipsis')[] = [1];
  if (left > 2) pages.push('ellipsis');
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push('ellipsis');
  pages.push(total);
  return pages;
}

export const Pagination = forwardRef<HTMLDivElement, PaginationProps>(function Pagination(
  props,
  ref,
) {
  const {
    page,
    totalPages,
    onChange,
    showEdges = true,
    siblingCount = 1,
    className,
    style,
    ...rest
  } = props;

  const pages = buildPages(page, totalPages, siblingCount);

  const go = (next: number) => {
    if (next >= 1 && next <= totalPages && next !== page) onChange(next);
  };

  return (
    <nav
      ref={ref}
      className={cx('v8-pagination', className)}
      aria-label="Pagination"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        ...style,
      }}
      {...rest}
    >
      {showEdges === true && (
        <PageButton aria-label="First page" disabled={page === 1} onClick={() => go(1)}>
          <ChevronsLeft size={14} aria-hidden="true" />
        </PageButton>
      )}
      <PageButton aria-label="Previous page" disabled={page === 1} onClick={() => go(page - 1)}>
        <ChevronLeft size={14} aria-hidden="true" />
      </PageButton>
      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span
            key={`e-${i}`}
            style={{ padding: '0 6px', color: 'var(--fg-subtle)', fontSize: 'var(--fs-13)' }}
            aria-hidden="true"
          >
            …
          </span>
        ) : (
          <PageButton
            key={p}
            aria-current={p === page ? 'page' : undefined}
            aria-label={`Page ${p}`}
            selected={p === page}
            onClick={() => go(p)}
          >
            {p}
          </PageButton>
        ),
      )}
      <PageButton
        aria-label="Next page"
        disabled={page === totalPages}
        onClick={() => go(page + 1)}
      >
        <ChevronRight size={14} aria-hidden="true" />
      </PageButton>
      {showEdges === true && (
        <PageButton
          aria-label="Last page"
          disabled={page === totalPages}
          onClick={() => go(totalPages)}
        >
          <ChevronsRight size={14} aria-hidden="true" />
        </PageButton>
      )}
    </nav>
  );
});

interface PageButtonProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'children'> {
  selected?: boolean;
  disabled?: boolean;
  children: ReactNode;
  'aria-label'?: string;
  'aria-current'?: 'page';
}

function PageButton(props: PageButtonProps) {
  const { selected, disabled, children, className, style, ...rest } = props;
  return (
    <button
      type="button"
      disabled={disabled}
      className={cx('v8-pagination__btn', selected === true && 'is-selected', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 28,
        height: 28,
        padding: '0 8px',
        background: selected === true ? 'var(--accent-soft)' : 'transparent',
        color: selected === true ? 'var(--accent)' : 'var(--fg-muted)',
        border: 0,
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--fs-13)',
        fontWeight: selected === true ? 600 : 500,
        cursor: disabled === true ? 'not-allowed' : 'pointer',
        opacity: disabled === true ? 0.45 : 1,
        fontFamily: 'inherit',
        transition: 'background var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out)',
        ...style,
      }}
      {...rest}
    >
      {children}
      <style>{`
        .v8-pagination__btn:hover:not(:disabled):not(.is-selected) {
          background: var(--surface-1);
          color: var(--fg);
        }
      `}</style>
    </button>
  );
}