/*
 * EmptyState.tsx — Friendly empty-state placeholder (Wave 2B).
 *
 * Replaces the legacy components/EmptyState.tsx with a smaller, opinions-on
 * shape: title is the only required field, optional description paragraph,
 * default icon is a sad-cloud lucide glyph (drops in if no icon is passed),
 * and an optional single-action button whose whole row is a labelled ghost
 * CTA. `inline` mode removes the centred padding for use inside dense cards.
 */

import type { ReactNode } from 'react';
import { Cloud } from 'lucide-react';
import { cx } from '../utils/cx';

export type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
  inline?: boolean;
  className?: string;
};

export function EmptyState({
  title,
  description,
  icon,
  action,
  inline = false,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cx(
        'bd-state',
        inline && 'bd-state--inline',
        className,
      )}
    >
      {icon !== null && (
        <div className="bd-state__icon" aria-hidden="true">
          {icon ?? <Cloud size={32} />}
        </div>
      )}
      <div className="bd-state__title">{title}</div>
      {description && (
        <div className="bd-state__description">{description}</div>
      )}
      {action && (
        <button
          type="button"
          className="bd-state__action bd-state__action--ghost"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
