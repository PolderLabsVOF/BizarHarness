/*
 * Panel.tsx — Bordered card surface for the Bizar design system (Wave 2C).
 *
 * The workhorse container for grouped content. Renders an optional
 * header (title + description + actions) with a hairline separator from
 * the body, then any children inside a padded region. Two surface tones
 * — `outlined` (default, surface-1) and `filled` (surface-2 + stronger
 * border) — handle the two densities found across the dashboard. Padding
 * accepts a 0..5 scale that maps to the `--space-N` tokens (default 4).
 *
 * The header is only rendered when at least one of `title`, `description`,
 * `actions` is set, so an empty Panel renders just the body.
 */

import type { ReactNode } from 'react';
import { cx } from '../utils/cx';

export type PanelPadding = 0 | 1 | 2 | 3 | 4 | 5;
export type PanelVariant = 'outlined' | 'filled';

export type PanelProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  padding?: PanelPadding;
  variant?: PanelVariant;
  className?: string;
};

export function Panel({
  title,
  description,
  actions,
  children,
  padding = 4,
  variant = 'outlined',
  className,
}: PanelProps): React.JSX.Element {
  const hasHeader =
    title !== undefined || description !== undefined || actions !== undefined;
  return (
    <section
      className={cx(
        'bizar-panel',
        variant === 'filled' && 'bizar-panel--filled',
        className,
      )}
    >
      {hasHeader && (
        <div className="bizar-panel__header">
          {(title || description) && (
            <div className="bizar-panel__header-text">
              {title && <h3 className="bizar-panel__title">{title}</h3>}
              {description && (
                <p className="bizar-panel__description">{description}</p>
              )}
            </div>
          )}
          {actions && <div className="bizar-panel__actions">{actions}</div>}
        </div>
      )}
      <div
        className={cx(
          'bizar-panel__body',
          `bizar-panel__padding--${padding}`,
        )}
      >
        {children}
      </div>
    </section>
  );
}
