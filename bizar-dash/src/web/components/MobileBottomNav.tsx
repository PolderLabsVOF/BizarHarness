// src/web/components/MobileBottomNav.tsx — iOS/Android-style bottom tab bar.
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

export type MobileTab = {
  id: string;
  label: string;
  icon: LucideIcon;
};

type Props = {
  tabs: MobileTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
};

export function MobileBottomNav({ tabs, activeTab, onTabChange }: Props) {
  return (
    <nav className="mobile-bottom-nav" role="tablist" aria-label="Primary navigation">
      {tabs.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            className={cn('mobile-nav-item', activeTab === t.id && 'is-active')}
            onClick={() => onTabChange(t.id)}
            type="button"
          >
            <Icon size={20} />
            <span className="mobile-nav-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
