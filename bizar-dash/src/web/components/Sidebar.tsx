// src/components/Sidebar.tsx — vertical navigation rail.
//
// v8.0 — Minimalist overhaul.
//   - 200px wide with labels always visible.
//   - Tabs are grouped into named sections (Workspace / Agents & Work /
//     Knowledge / System) with a small uppercase label above each group.
//   - Settings lives inside the 'system' section (no duplicate footer
//     entry). The only duplicate Settings button that existed in v7.x
//     is removed here.
//   - Mod-added tabs render under a separate 'Mods' section beneath the
//     built-in groups.
//   - Active state: `--bg-elev-2` background + 2px solid `--accent`
//     left edge + `--text-strong` text. This is the ONE place in the
//     design where a left-edge accent is used (it's the navigational
//     anchor — see DESIGN.md §2).
//   - Settings mode (rendered when settingsMode=true) uses the same
//     `.sidebar` shell, the same `.sidebar-tab` rows, and the same
//     200px width so the visual transition into settings is invisible.

import type { TabDef, SidebarSection } from './Topbar';
import { SIDEBAR_SECTIONS } from './Topbar';
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

export function Sidebar({
  tabs,
  activeTab,
  onTabChange,
  settingsMode,
  settingsActiveSection,
  onSettingsSectionChange,
  onExitSettings,
}: SidebarProps) {
  // v4.9.0 — Settings mode reuses the same .sidebar shell so the visual
  // transition is invisible (same width, same background, same padding,
  // same tab-row styles). Only the content differs.
  if (settingsMode) {
    return (
      <aside className="sidebar" aria-label="Settings navigation">
        <SettingsNav
          activeSection={settingsActiveSection ?? null}
          onSectionChange={onSettingsSectionChange ?? (() => {})}
          onExitSettings={onExitSettings ?? (() => {})}
        />
      </aside>
    );
  }

  // Split tabs into built-in (no `isMod` flag) and mod-added entries.
  const builtIn = tabs.filter((t) => !(t as TabDef & { isMod?: boolean }).isMod);
  const modTabs = tabs.filter((t) => (t as TabDef & { isMod?: boolean }).isMod);

  // Group built-in tabs by their `section` field. Tabs without a section
  // are dropped from the rail — every built-in tab in TABS now declares
  // a section, so this is a defensive fallback only.
  const sectionGroups = SIDEBAR_SECTIONS
    .map((s) => ({ ...s, items: builtIn.filter((t) => t.section === s.id) }))
    .filter((g) => g.items.length > 0);

  const ungrouped = builtIn.filter((t) => !t.section);

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <nav className="sidebar-nav" role="tablist">
        {sectionGroups.map((group) => (
          <div key={group.id} className="sidebar-section">
            <div className="sidebar-section-label">{group.label}</div>
            {group.items.map((t) => (
              <SidebarRow
                key={t.id}
                tab={t}
                active={t.id === activeTab}
                onClick={() => onTabChange(t.id)}
              />
            ))}
          </div>
        ))}
        {ungrouped.length > 0 && (
          <div className="sidebar-section">
            {ungrouped.map((t) => (
              <SidebarRow
                key={t.id}
                tab={t}
                active={t.id === activeTab}
                onClick={() => onTabChange(t.id)}
              />
            ))}
          </div>
        )}
        {modTabs.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-divider" aria-hidden="true" />
            <div className="sidebar-section-label">Mods</div>
            {modTabs.map((t) => (
              <SidebarRow
                key={t.id}
                tab={t}
                active={t.id === activeTab}
                onClick={() => onTabChange(t.id)}
                isMod
              />
            ))}
          </div>
        )}
      </nav>
    </aside>
  );
}

function SidebarRow({
  tab,
  active,
  onClick,
  isMod,
}: {
  tab: TabDef;
  active: boolean;
  onClick: () => void;
  isMod?: boolean;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'sidebar-tab',
        active && 'sidebar-tab-active',
        isMod && 'sidebar-tab-mod',
      )}
      onClick={onClick}
      title={isMod ? `${tab.label} (mod)` : tab.label}
    >
      <Icon size={16} aria-hidden />
      <span className="sidebar-tab-label">{tab.label}</span>
    </button>
  );
}