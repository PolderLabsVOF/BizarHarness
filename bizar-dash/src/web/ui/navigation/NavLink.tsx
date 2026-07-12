/*
 * NavLink.tsx — Single sidebar nav item (Wave 2B).
 *
 * Renders as <a>, <button> or <div> depending on whether the caller wired
 * `href`, `onClick`, or neither. This matches the three affordances callers
 * actually need: a real navigation link, a click-triggered action (e.g. open
 * a modal) and a decorative marker (sub-item shown but not interactive).
 * The active row gets a 2px accent left-border + subtle background tint.
 *
 * The `to` prop is reserved for future client-side router wiring
 * (e.g. react-router) — left on the prop type so call-sites can pass
 * `to={...}` without TypeScript errors when the router is introduced. The
 * `_ = to` assignment immediately below is the no-op placeholder that
 * silences `noUnusedParameters` without touching the runtime.
 */

import type { LucideIcon } from 'lucide-react';
import { cx } from '../utils/cx';

export type NavLinkProps = {
  href?: string;
  to?: string;
  icon?: LucideIcon;
  label: string;
  badge?: string | number;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
};

export function NavLink({
  href,
  to,
  icon: Icon,
  label,
  badge,
  active = false,
  onClick,
  disabled = false,
  className,
}: NavLinkProps): React.JSX.Element {
  const _ = to; // reserved for future router; see file header.
  void _;
  const classes = cx(
    'bd-nav-link',
    active && 'bd-nav-link--active',
    disabled && 'bd-nav-link--disabled',
    className,
  );

  const content = (
    <>
      {Icon && (
        <span className="bd-nav-link__icon" aria-hidden="true">
          <Icon size={16} />
        </span>
      )}
      <span className="bd-nav-link__label">{label}</span>
      {badge !== undefined && badge !== null && (
        <span className="bd-nav-link__badge">{badge}</span>
      )}
    </>
  );

  if (href !== undefined) {
    return (
      <a
        href={disabled ? undefined : href}
        className={classes}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        aria-disabled={disabled || undefined}
      >
        {content}
      </a>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        disabled={disabled}
        aria-current={active ? 'page' : undefined}
      >
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}
