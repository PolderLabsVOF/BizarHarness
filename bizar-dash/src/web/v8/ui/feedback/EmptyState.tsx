import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * EmptyState — placeholder for empty lists / zero-data views.
 *
 * Use when a view has no rows. Never use a spinner; the data is
 * genuinely empty.
 */
export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  props,
  ref,
) {
  const { icon, title, description, action, className, ...rest } = props;
  return (
    <div
      ref={ref}
      className={cx('v8-empty-state', className)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-12) var(--space-6)',
        textAlign: 'center',
        color: 'var(--fg-muted)',
      }}
      {...rest}
    >
      {icon !== undefined && (
        <div style={{ color: 'var(--fg-subtle)', display: 'inline-flex' }}>{icon}</div>
      )}
      <div style={{ fontSize: 'var(--fs-16)', fontWeight: 600, color: 'var(--fg)' }}>{title}</div>
      {description !== undefined && (
        <div style={{ fontSize: 'var(--fs-13)', maxWidth: 480 }}>{description}</div>
      )}
      {action !== undefined && <div style={{ marginTop: 'var(--space-2)' }}>{action}</div>}
    </div>
  );
});