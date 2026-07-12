/*
 * Sidebar.tsx — Vertical nav rail for the Bizar design system (Wave 2C).
 *
 * Renders grouped vertical navigation: each group is an optional label +
 * a stack of items. Items are simple links/buttons; click an item to fire
 * `onItemSelect(id)` and toggle the `activeId` highlight. Footer slot is
 * pinned to the bottom of the rail and typically holds a settings link or
 * user avatar. Self-contained — does not depend on ui/navigation primitives
 * from sibling Wave 2 subagents, so this works regardless of dispatch order.
 */

import type { ReactNode } from 'react';
import { cx } from '../utils/cx';

export type NavItemIcon = React.ComponentType<{ size?: number | string }>;

export type NavLinkProps = {
  id: string;
  label: string;
  icon?: NavItemIcon;
  badge?: string | number;
  disabled?: boolean;
  href?: string;
  onClick?: (id: string) => void;
};

export type SidebarGroup = {
  label?: string;
  items: NavLinkProps[];
};

export type SidebarProps = {
  groups: SidebarGroup[];
  activeId?: string;
  onItemSelect?: (id: string) => void;
  footer?: ReactNode;
  width?: number;
  className?: string;
};

export function Sidebar({
  groups,
  activeId,
  onItemSelect,
  footer,
  width,
  className,
}: SidebarProps): React.JSX.Element {
  return (
    <nav
      className={cx('bizar-sidebar', className)}
      style={width ? { width } : undefined}
      aria-label="Primary"
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        {groups.map((group, gIdx) => (
          <div key={gIdx} className="bizar-sidebar__group">
            {group.label && (
              <div className="bizar-sidebar__label">{group.label}</div>
            )}
            <div className="bizar-sidebar__items" role="list">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeId === item.id;
                const className = cx(
                  'bizar-sidebar__item',
                  active && 'bizar-sidebar__item--active',
                );
                const ariaCurrent = active ? 'page' : undefined;
                const onClick = () => {
                  if (item.disabled) return;
                  item.onClick?.(item.id);
                  onItemSelect?.(item.id);
                };
                if (item.href) {
                  return (
                    <a
                      key={item.id}
                      href={item.href}
                      className={className}
                      aria-current={ariaCurrent}
                      aria-disabled={item.disabled || undefined}
                      onClick={(e) => {
                        if (item.disabled) {
                          e.preventDefault();
                          return;
                        }
                        onClick();
                      }}
                    >
                      {Icon && <Icon size={16} />}
                      <span className="bizar-sidebar__item-label">
                        {item.label}
                      </span>
                      {item.badge !== undefined && (
                        <span className="bizar-sidebar__item-badge">
                          {item.badge}
                        </span>
                      )}
                    </a>
                  );
                }
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={className}
                    aria-current={ariaCurrent}
                    disabled={item.disabled}
                    onClick={onClick}
                  >
                    {Icon && <Icon size={16} />}
                    <span className="bizar-sidebar__item-label">
                      {item.label}
                    </span>
                    {item.badge !== undefined && (
                      <span className="bizar-sidebar__item-badge">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {footer && <div className="bizar-sidebar__footer">{footer}</div>}
    </nav>
  );
}
