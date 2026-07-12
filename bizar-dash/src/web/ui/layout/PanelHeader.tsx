/*
 * PanelHeader.tsx — Standalone header block for use inside a Panel (Wave 2C).
 *
 * Splits a header into three regions (text on the left, actions on the
 * right, optional custom children prepended above all). The bottom border
 * that separates header from body is owned by Panel; this component only
 * renders the inner layout. Use `<Panel>` for the standard header shape
 * — drop down to `<PanelHeader>` only when you need a non-trivial header
 * (e.g. tab strip + filter chips stacked above the title).
 */

import type { ReactNode } from 'react';

export type PanelHeaderProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

export function PanelHeader({
  title,
  description,
  actions,
  children,
}: PanelHeaderProps): React.JSX.Element {
  return (
    <div className="bizar-panel__header">
      <div className="bizar-panel__header-text">
        {children}
        {title && <h3 className="bizar-panel__title">{title}</h3>}
        {description && (
          <p className="bizar-panel__description">{description}</p>
        )}
      </div>
      {actions && <div className="bizar-panel__actions">{actions}</div>}
    </div>
  );
}
