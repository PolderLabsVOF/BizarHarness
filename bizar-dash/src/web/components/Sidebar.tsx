// src/components/Sidebar.tsx — vertical navigation rail for sidebar/both layouts.
import type { TabDef } from './Topbar';
import { cn } from '../lib/utils';

export type SidebarProps = {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (id: string) => void;
};

export function Sidebar({ tabs, activeTab, onTabChange }: SidebarProps) {
  // Split tabs into built-in (no `isMod` flag) and mod-added entries.
  // Render a separator + small "Mods" label between them so users can
  // tell what's part of Bizar vs what an installed mod contributed.
  const builtIn = tabs.filter((t) => !(t as TabDef & { isMod?: boolean }).isMod);
  const modTabs = tabs.filter((t) => (t as TabDef & { isMod?: boolean }).isMod);

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <nav className="sidebar-nav" role="tablist">
        {builtIn.map((t) => {
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
        {modTabs.length > 0 && (
          <>
            <div className="sidebar-section-divider" aria-hidden="true" />
            <div className="sidebar-section-label">Mods</div>
            {modTabs.map((t) => {
              const Icon = t.icon;
              const active = t.id === activeTab;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={cn('sidebar-tab', 'sidebar-tab-mod', active && 'sidebar-tab-active')}
                  onClick={() => onTabChange(t.id)}
                  title={`${t.label} (mod)`}
                >
                  <Icon size={18} aria-hidden />
                  <span className="sidebar-tab-label">{t.label}</span>
                </button>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}
