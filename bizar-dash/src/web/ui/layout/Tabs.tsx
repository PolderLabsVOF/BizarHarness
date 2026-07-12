/*
 * Tabs.tsx — Horizontal tab strip for the Bizar design system (Wave 2C).
 *
 * Two visual variants:
 *   - `underline` (default): the active tab carries a 2px accent border
 *     on the bottom edge, no background fill. Used in page-level
 *     navigation where space is tight and the active state should be
 *     unmistakable but quiet.
 *   - `pill`: the active tab has a filled surface-3 background. Used for
 *     tool palettes and switchers where every tab should feel clickable.
 *
 * Keyboard support: Left/Right arrows move the active id across non-disabled
 * tabs (matches the WAI-ARIA Authoring Practices for the tabs pattern).
 * Tabs use `role="tab"` + `aria-selected`; the strip carries
 * `role="tablist"`. Disabled tabs receive the `disabled` attribute on the
 * underlying <button> and are skipped during keyboard navigation.
 *
 * `aria-controls` is intentionally NOT set here — the Tabs primitive owns
 * only the strip, not the tabpanels, so we cannot point to a real id. The
 * component that owns both the strip and its panels should set
 * `aria-controls` itself (or wrap this Tabs and add the attribute on the
 * rendered buttons).
 */

import { useCallback, type KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../utils/cx';

export type TabDef = {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: string | number;
  disabled?: boolean;
};

export type TabsProps = {
  tabs: TabDef[];
  activeId: string;
  onChange: (id: string) => void;
  variant?: 'underline' | 'pill';
  size?: 'sm' | 'md';
  className?: string;
};

export function Tabs({
  tabs,
  activeId,
  onChange,
  variant = 'underline',
  size = 'md',
  className,
}: TabsProps): React.JSX.Element {
  const enabledIds = tabs.filter((t) => !t.disabled).map((t) => t.id);

  const moveActive = useCallback(
    (dir: 1 | -1) => {
      if (enabledIds.length === 0) return;
      const idx = enabledIds.indexOf(activeId);
      // If current is not enabled, treat the "right" neighbor as the next
      // enabled tab after the (missing) current.
      const startIdx = idx === -1 ? -1 : idx;
      let nextIdx = startIdx + dir;
      if (nextIdx < 0) nextIdx = enabledIds.length - 1;
      if (nextIdx >= enabledIds.length) nextIdx = 0;
      const next = enabledIds[nextIdx];
      if (next && next !== activeId) onChange(next);
    },
    [activeId, enabledIds, onChange],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (enabledIds[0]) onChange(enabledIds[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = enabledIds[enabledIds.length - 1];
      if (last) onChange(last);
    }
  };

  return (
    <div
      className={cx(
        'bizar-tabs',
        `bizar-tabs--${variant}`,
        size === 'sm' && 'bizar-tabs--sm',
        className,
      )}
      role="tablist"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tab.id === activeId;
        const selectedRef = active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selectedRef}
            tabIndex={selectedRef ? 0 : -1}
            disabled={tab.disabled}
            className={cx(
              'bizar-tab',
              active && 'bizar-tab--active',
            )}
            onClick={() => {
              if (tab.disabled) return;
              onChange(tab.id);
            }}
            onKeyDown={(e) => {
              if (active && !tab.disabled) onKeyDown(e);
            }}
          >
            {Icon && <Icon size={14} className="bizar-tab__icon" />}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span className="bizar-tab__badge">{tab.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
