import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * ListHeader — section header for list/grid views.
 *
 * Composes a label + count badge + optional sparkline + optional
 * filter chips + right-aligned actions. Use at the top of a Card
 * or as a standalone section divider.
 *
 * Two patterns supported:
 * - Minimal: `<title> <count?> <actions?>`
 * - Data-driven: `<title> <sparkline?> <chips?> <actions?>`
 */
export interface ListHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  /** Optional numeric badge — e.g. `42` rendered as `42 items`. */
  count?: number | null;
  /** Inline sparkline (pass a Sparkline node, not raw data). */
  sparkline?: ReactNode;
  /** Inline filter chips — rendered as a wrapping row. */
  filters?: ReactNode;
  /** Right-aligned action area (buttons, refresh, etc). */
  actions?: ReactNode;
  /** Optional helper text under the title. */
  description?: ReactNode;
  testid?: string;
}

export const ListHeader = forwardRef<HTMLDivElement, ListHeaderProps>(function ListHeader(props, ref) {
  const { title, count, sparkline, filters, actions, description, testid, className, ...rest } = props;
  return (
    <div
      ref={ref}
      data-testid={testid ?? 'list-header'}
      className={cx('v8-list-header', className)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-2)',
      }}
      {...rest}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-16)', fontWeight: 600 }}>{title}</h2>
          {count !== undefined && count !== null && (
            <span
              data-testid="list-header-count"
              style={{
                fontSize: 'var(--fs-12)',
                color: 'var(--fg-muted)',
                fontVariantNumeric: 'tabular-nums',
                background: 'var(--surface-1)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--border)',
              }}
            >
              {count}
            </span>
          )}
          {sparkline !== undefined && (
            <span data-testid="list-header-sparkline">{sparkline}</span>
          )}
          {description !== undefined && (
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-subtle)' }}>{description}</span>
          )}
        </div>
        {actions !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>
      {filters !== undefined && (
        <div
          data-testid="list-header-filters"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexWrap: 'wrap' }}
        >
          {filters}
        </div>
      )}
    </div>
  );
});