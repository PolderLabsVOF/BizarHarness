// src/mobile/MobileBottomNav.tsx — bottom tab bar for mobile.
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
            className={cn('mobile-nav-btn', activeTab === t.id && 'mobile-nav-btn-active')}
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
