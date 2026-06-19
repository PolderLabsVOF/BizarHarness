// src/components/Sidebar.tsx — vertical navigation rail for sidebar/both layouts.
import type { TabDef } from './Topbar';
import { cn } from '../lib/utils';

export type SidebarProps = {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (id: string) => void;
};

export function Sidebar({ tabs, activeTab, onTabChange }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <nav className="sidebar-nav" role="tablist">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn('sidebar-tab', active && 'sidebar-tab-active')}
              onClick={() => onTabChange(t.id)}
              title={t.label}
            >
              <Icon size={18} aria-hidden />
              <span className="sidebar-tab-label">{t.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
