// src/mobile/MobileBottomNav.tsx — bottom tab bar for mobile.
import type { LucideIcon } from 'lucide-react';
import { cx } from '../ui/utils/cx';

export type MobileTab = {
  id: string;
  label: string;
  icon: LucideIcon;
};

type Props = {
  tabs: MobileTab[];
  activeTab: string;
  onChange: (id: string) => void;
};

export function MobileBottomNav({ tabs, activeTab, onChange }: Props) {
  return (
    <nav className="mobile-bottom-nav" role="navigation" aria-label="Mobile navigation">
      {tabs.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            className={cx('mobile-nav-btn', { 'mobile-nav-btn-active': activeTab === t.id })}
            onClick={() => onChange(t.id)}
            aria-label={t.label}
            aria-current={activeTab === t.id ? 'page' : undefined}
          >
            <Icon size={22} />
            <span className="mobile-nav-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
