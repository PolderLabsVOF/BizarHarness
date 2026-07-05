// src/web/components/MobileDrawer.tsx — slide-in drawer for secondary navigation.
import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

export type DrawerTab = {
  id: string;
  label: string;
  icon: LucideIcon;
};

type Props = {
  open: boolean;
  onClose: () => void;
  tabs: DrawerTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
};

export function MobileDrawer({ open, onClose, tabs, activeTab, onTabChange }: Props) {
  return (
    <>
      {open && (
        <div
          className="mobile-drawer-overlay"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn('mobile-drawer', open && 'is-open')}
        role="dialog"
        aria-modal="true"
        aria-label="All views"
      >
        <div className="mobile-drawer-head">
          <h2>All Views</h2>
          <button
            onClick={onClose}
            aria-label="Close menu"
            type="button"
            className="mobile-drawer-close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="mobile-drawer-grid">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={activeTab === t.id}
                className={cn('mobile-drawer-item', activeTab === t.id && 'is-active')}
                onClick={() => onTabChange(t.id)}
                type="button"
              >
                <Icon size={22} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
}
