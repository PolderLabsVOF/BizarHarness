/*
 * ViewHeader.tsx — top-of-view title row (F-041).
 *
 * Distinct from PanelHeader (which lives inside a Panel). Sits above the
 * view's content as the page-level header: a single row with the title on
 * the left, an optional subtitle, and a right-aligned actions slot. Used
 * at the top of every top-level view (Overview, Tasks, Agents, Chat,
 * Settings, MobileOverview, MobileTasks, etc.) so the dashboard reads as
 * one system instead of five bespoke title bars.
 *
 * Visual contract (see DESIGN.md §9.22):
 *   - Title: --fs-h3 (16px) weight 600, --text-primary
 *   - Subtitle: --text-sm (12px), --text-secondary
 *   - Actions: right-aligned via Inline; typically IconButton + Button
 *   - Padding: --space-3 from top, --space-4 horizontal
 *   - No bottom border (the first child panel provides the visual divider)
 */

import type { ReactNode } from 'react';
import { cx } from '../utils/cx';

export type ViewHeaderProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Optional eyebrow row above the title (e.g. breadcrumbs, view label). */
  eyebrow?: ReactNode;
  className?: string;
};

export function ViewHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  className,
}: ViewHeaderProps): React.JSX.Element {
  return (
    <header className={cx('bizar-view-header', className)}>
      <div className="bizar-view-header__text">
        {eyebrow && <div className="bizar-view-header__eyebrow">{eyebrow}</div>}
        {title && <h1 className="bizar-view-header__title">{title}</h1>}
        {subtitle && <p className="bizar-view-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="bizar-view-header__actions">{actions}</div>}
    </header>
  );
}