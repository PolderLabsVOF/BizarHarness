import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * NavLink — semantic navigation link with active state.
 *
 * Use for sidebar nav items and inline breadcrumb-style navigation.
 * For command palette actions use CommandPalette (cmdk).
 *
 * Active state is controlled via `aria-current="page"` from the parent
 * (i.e. the router decides). The component only styles what's announced.
 */
export interface NavLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: ReactNode;
  /** Show left-aligned accent bar when active (sidebar pattern). */
  showActiveBar?: boolean;
  /** Left-aligned icon (Lucide icon). */
  leading?: ReactNode;
}

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink(props, ref) {
  const { href, children, showActiveBar, leading, className, style, ...rest } = props;
  return (
    <a
      ref={ref}
      href={href}
      className={cx('v8-nav-link', className)}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: '0 var(--space-3)',
        height: 28,
        borderRadius: 'var(--radius-sm)',
        color: 'var(--fg-muted)',
        fontSize: 'var(--fs-13)',
        fontWeight: 500,
        textDecoration: 'none',
        transition: 'background var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out)',
        ...style,
      }}
      {...rest}
    >
      {showActiveBar === true && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 4,
            bottom: 4,
            width: 2,
            borderRadius: 'var(--radius-pill)',
            background: 'transparent',
            transition: 'background var(--motion-fast) var(--ease-out)',
          }}
          data-nav-active-bar="true"
        />
      )}
      {leading !== undefined && (
        <span style={{ width: 14, display: 'inline-flex', color: 'inherit' }}>{leading}</span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      <style>{`
        .v8-nav-link:hover {
          background: var(--surface-1);
          color: var(--fg);
        }
        .v8-nav-link[aria-current='page'] {
          background: var(--surface-1);
          color: var(--fg);
        }
        .v8-nav-link[aria-current='page'] [data-nav-active-bar='true'] {
          background: var(--accent);
        }
      `}</style>
    </a>
  );
});