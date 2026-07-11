// src/components/Sidebar.tsx — vertical navigation rail.
//
// v8.0 — Minimalist overhaul. Now 200px wide with label always visible
// (no collapse-to-icons mode). Active state is a 2px solid `--accent`
// left edge plus `--bg-elev-2` background plus `--text-strong` text —
// the only place in the design where a left-edge accent is used (it's
// the navigational anchor). Settings is rendered through SettingsNav
// (still pinned to the bottom of the rail via that component's own
// structure).

import type { TabDef } from './Topbar';
import { SettingsNav } from './SettingsNav';
import { Settings } from 'lucide-react';
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
  /** v8.0 — Called when user clicks the Settings entry pinned to the bottom. */
  onOpenSettings?: () => void;
};

export function Sidebar({
  tabs,
  activeTab,
  onTabChange,
  settingsMode,
  settingsActiveSection,
  onSettingsSectionChange,
  onExitSettings,
  onOpenSettings,
}: SidebarProps) {
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
              aria-current={active ? 'page' : undefined}
              className={cn('sidebar-tab', active && 'sidebar-tab-active')}
              onClick={() => onTabChange(t.id)}
              title={t.label}
            >
              <Icon size={16} aria-hidden />
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
                  aria-current={active ? 'page' : undefined}
                  className={cn('sidebar-tab', 'sidebar-tab-mod', active && 'sidebar-tab-active')}
                  onClick={() => onTabChange(t.id)}
                  title={`${t.label} (mod)`}
                >
                  <Icon size={16} aria-hidden />
                  <span className="sidebar-tab-label">{t.label}</span>
                </button>
              );
            })}
          </>
        )}
      </nav>
      <div className="sidebar-footer">
        <button
          type="button"
          className={cn('sidebar-tab', 'sidebar-tab-settings', activeTab === 'settings' && 'sidebar-tab-active')}
          onClick={() => (onOpenSettings ? onOpenSettings() : onTabChange('settings'))}
          title="Settings"
        >
          <Settings size={16} aria-hidden />
          <span className="sidebar-tab-label">Settings</span>
        </button>
      </div>
    </aside>
  );
}