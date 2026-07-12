/*
 * Breadcrumbs.tsx — Breadcrumb trail for the Bizar design system (Wave 2C).
 *
 * Renders a horizontal chain of clickable crumbs separated by a chevron.
 * Default separator is the lucide `ChevronRight` icon (15px, muted), but
 * callers can replace it with any ReactNode — including a custom glyph,
 * "/", or "›". The final crumb is rendered in `--text-primary` with
 * medium weight and is not interactive: it represents the current page.
 * Items with `href` render as <a>; items with only `onClick` render as
 * <button>; the current item renders as a non-interactive <span>.
 */

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cx } from '../utils/cx';

export type BreadcrumbItem = {
  label: string;
  href?: string;
  onClick?: () => void;
};

export type BreadcrumbsProps = {
  items: BreadcrumbItem[];
  separator?: ReactNode;
  className?: string;
};

export function Breadcrumbs({
  items,
  separator,
  className,
}: BreadcrumbsProps): React.JSX.Element {
  return (
    <nav className={cx('bizar-breadcrumbs', className)} aria-label="Breadcrumb">
      <ol
        style={{
          display: 'contents',
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {items.map((item, idx) => {
          const isCurrent = idx === items.length - 1;
          const sep =
            idx < items.length - 1 ? (
              <span className="bizar-breadcrumbs__separator" aria-hidden="true">
                {separator ?? <ChevronRight size={15} />}
              </span>
            ) : null;

          if (isCurrent) {
            return (
              <li
                key={idx}
                aria-current="page"
                className="bizar-breadcrumbs__item bizar-breadcrumbs__item--current"
              >
                {item.label}
                {sep}
              </li>
            );
          }

          if (item.href) {
            return (
              <li key={idx}>
                <a
                  href={item.href}
                  className="bizar-breadcrumbs__item"
                  onClick={() => item.onClick?.()}
                >
                  {item.label}
                </a>
                {sep}
              </li>
            );
          }

          return (
            <li key={idx}>
              <button
                type="button"
                className="bizar-breadcrumbs__item"
                onClick={() => item.onClick?.()}
              >
                {item.label}
              </button>
              {sep}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
