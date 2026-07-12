import { type ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * SettingsNav — left rail inside the Settings page.
 *
 * Lists each section so the user can jump (or scroll) to it. The active
 * section is highlighted. The nav is a vertical list with section ids
 * as the anchor target; no JS router needed.
 */

export interface SettingsNavItem {
  id: string;
  title: string;
  icon?: ReactNode;
}

export interface SettingsNavProps {
  items: readonly SettingsNavItem[];
  /** The id of the currently-visible section. */
  activeId?: string;
  /** Click handler — usually `() => document.getElementById(id)?.scrollIntoView()`. */
  onSelect?: (id: string) => void;
  className?: string;
}

export function SettingsNav(props: SettingsNavProps) {
  const { items, activeId, onSelect, className } = props;
  return (
    <nav aria-label="Settings sections" className={cx('v8-settings-nav', className)}>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {items.map((item) => {
          const isActive = activeId === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect?.(item.id)}
                aria-current={isActive ? 'true' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  width: '100%',
                  padding: 'var(--space-2) var(--space-3)',
                  background: isActive ? 'var(--surface-2)' : 'transparent',
                  border: 0,
                  borderRadius: 'var(--radius-sm)',
                  color: isActive ? 'var(--fg)' : 'var(--fg-muted)',
                  font: 'inherit',
                  fontSize: 'var(--fs-13)',
                  fontWeight: isActive ? 500 : 400,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {item.icon !== undefined && (
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-flex',
                      color: isActive ? 'var(--accent)' : 'var(--fg-subtle)',
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </span>
                )}
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <style>{`
        .v8-settings-nav button:hover { background: var(--surface-2); color: var(--fg); }
      `}</style>
    </nav>
  );
}