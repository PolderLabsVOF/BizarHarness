/*
 * NavGroup.tsx — Collapsible group of NavLinks (Wave 2B).
 *
 * Header is a labelled bar that toggles the open state on click. When
 * `collapsible={false}` the header becomes a static label (no chevron, no
 * click, no pointer-events). Open/closed is uncontrolled by default
 * (`defaultOpen`) but switches to controlled when `open` is passed. The
 * children are rendered via a wrapped <NavGroup.Items> approach — to keep
 * the public surface simple we accept `items` as NavLinkProps[] and project
 * them through NavLink internally.
 */

import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../utils/cx';
import { NavLink, type NavLinkProps } from './NavLink';

export type NavGroupProps = {
  label: string;
  icon?: LucideIcon;
  items: NavLinkProps[];
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapsible?: boolean;
  children?: ReactNode;
  className?: string;
};

export function NavGroup({
  label,
  icon: Icon,
  items,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  collapsible = true,
  children,
  className,
}: NavGroupProps): React.JSX.Element {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen! : internalOpen;

  const toggle = (): void => {
    if (!collapsible) return;
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <section
      className={cx(
        'bd-nav-group',
        isOpen && 'bd-nav-group--open',
        !collapsible && 'bd-nav-group--non-collapsible',
        className,
      )}
    >
      <button
        type="button"
        className="bd-nav-group__header"
        onClick={toggle}
        aria-expanded={collapsible ? isOpen : undefined}
      >
        {Icon && (
          <span className="bd-nav-group__header-icon" aria-hidden="true">
            <Icon size={14} />
          </span>
        )}
        <span className="bd-nav-group__label">{label}</span>
        {collapsible && (
          <ChevronRight
            size={12}
            className="bd-nav-group__chevron"
            aria-hidden="true"
          />
        )}
      </button>
      <div className="bd-nav-group__items" role="group">
        {items.map((item, i) => (
          <NavLink key={`${item.label}-${i}`} {...item} />
        ))}
        {/*
          Reserved escape hatch for callers that want to inject custom
          content (e.g. a divider or a footer link) below the auto
          -projected items.
        */}
        {typeof children !== 'undefined' && <>{children}</>}
      </div>
    </section>
  );
}
