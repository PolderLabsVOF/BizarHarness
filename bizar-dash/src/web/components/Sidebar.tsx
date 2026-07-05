// src/components/Sidebar.tsx — vertical navigation rail for sidebar/both layouts.
import type { TabDef } from './Topbar';
import { SettingsNav } from './SettingsNav';
import { cn } from '../lib/utils';

export type SidebarProps = {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /** v4.9.0 — When true, show the full settings sidebar nav instead of tabs. */
  settingsMode?: boolean;
  /** v4.9.0 — The currently highlighted settings section. */
  settingsActiveSection?: string | null;
  /** v4.9.0 — Called when user clicks a section in the settings sidebar. */
  onSettingsSectionChange?: (id: string | null) => void;
  /** v4.9.0 — Called when user clicks the back button in settings mode. */
  onExitSettings?: () => void;
};

export function Sidebar({ tabs, activeTab, onTabChange, settingsMode, settingsActiveSection, onSettingsSectionChange, onExitSettings }: SidebarProps) {
  // v4.9.0 — When settingsMode is active, render the full settings nav instead
  // of the normal tab rail. This lets users see all sections at a glance.
  if (settingsMode) {
    return (
      <aside className="sidebar sidebar-settings-mode" aria-label="Settings navigation">
        <SettingsNav
          activeSection={settingsActiveSection ?? null}
          onSectionChange={onSettingsSectionChange ?? (() => {})}
          onExitSettings={onExitSettings ?? (() => {})}
        />
      </aside>
    );
  }

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

