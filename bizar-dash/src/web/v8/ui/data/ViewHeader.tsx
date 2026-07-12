import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cx } from '../utils/cx.js';

/**
 * ViewHeader — page-level header pattern (title, description, breadcrumb, actions).
 *
 * Layout:
 *   [Breadcrumb]
 *   [Title]                        [Primary action]
 *   [Description]                  [Secondary actions...]
 *
 * Use at the top of every view: Overview, Tasks, Goals, Agents, etc.
 */

export interface BreadcrumbItem {
  label: ReactNode;
  href?: string;
  onClick?: () => void;
}

export interface ViewHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Optional breadcrumb trail rendered above the title. */
  breadcrumb?: readonly BreadcrumbItem[];
  /** Primary action (e.g. "New task"). */
  action?: ReactNode;
  /** Secondary actions (e.g. filter, export). */
  actions?: ReactNode;
  /** Optional metadata row below the description (e.g. status pills, counts). */
  meta?: ReactNode;
}

export const ViewHeader = forwardRef<HTMLDivElement, ViewHeaderProps>(function ViewHeader(
  props,
  ref,
) {
  const { title, description, breadcrumb, action, actions, meta, className, style, ...rest } = props;
  return (
    <header
      ref={ref}
      className={cx('v8-view-header', className)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-4) 0 var(--space-5)',
        borderBottom: '1px solid var(--border)',
        marginBottom: 'var(--space-5)',
        ...style,
      }}
      {...rest}
    >
      {breadcrumb !== undefined && breadcrumb.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 'var(--fs-12)',
            color: 'var(--fg-subtle)',
            marginBottom: 'var(--space-1)',
          }}
        >
          {breadcrumb.map((item, i) => {
            const isLast = i === breadcrumb.length - 1;
            return (
              <span
                key={i}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                {item.onClick !== undefined ? (
                  <button
                    onClick={item.onClick}
                    style={{
                      background: 'transparent',
                      border: 0,
                      padding: 0,
                      font: 'inherit',
                      color: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    {item.label}
                  </button>
                ) : (
                  <span style={{ color: isLast ? 'var(--fg)' : 'inherit' }}>{item.label}</span>
                )}
                {!isLast && (
                  <ChevronRight size={12} aria-hidden="true" style={{ color: 'var(--fg-subtle)' }} />
                )}
              </span>
            );
          })}
        </nav>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--fs-24)', lineHeight: 'var(--lh-tight)', fontWeight: 600, margin: 0, color: 'var(--fg)' }}>
            {title}
          </h1>
          {description !== undefined && (
            <div style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginTop: 4 }}>
              {description}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
          {actions}
          {action}
        </div>
      </div>
      {meta !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {meta}
        </div>
      )}
    </header>
  );
});