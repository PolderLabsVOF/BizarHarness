import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * Banner — a top-of-page contextual announcement.
 *
 * Use sparingly. Distinct from StatusBar (which is system-level) and
 * Alert (which is inline). Banner occupies its own row above the page header.
 */
export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'info' | 'warning' | 'success' | 'danger';
  children: ReactNode;
  action?: ReactNode;
}

export const Banner = forwardRef<HTMLDivElement, BannerProps>(function Banner(props, ref) {
  const { tone = 'info', children, action, className, ...rest } = props;
  return (
    <div
      ref={ref}
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('v8-banner', `v8-banner--${tone}`, className)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: `color-mix(in oklch, var(--${tone}) 8%, var(--surface-1))`,
        borderBottom: '1px solid var(--border)',
        fontSize: 'var(--fs-13)',
        color: 'var(--fg)',
      }}
      {...rest}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action !== undefined && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
});