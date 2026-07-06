// src/components/SettingsNav.tsx — v4.9.0 full-sidebar settings navigation.
// Shown in the sidebar rail when settingsMode is active. All sections are
// visible at once; clicking one scrolls the Settings view to that section.
import {
  ChevronRight, Palette, Terminal, Cpu, RefreshCw, Gauge, ArrowLeft,
  LayoutGrid, Wifi, Bell, Shield, Users, Activity, FolderGit2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';

export type SettingsSection = {
  id: string;
  label: string;
  icon?: LucideIcon;
};

export type SettingsSectionGroup = {
  label: string;
  sections: SettingsSection[];
};

const SECTION_GROUPS: SettingsSectionGroup[] = [
  {
    label: 'General',
    sections: [
      { id: 'theme', label: 'Theme', icon: Palette },
      // Layout & General are both rendered by GeneralSection; one nav item covers both
      { id: 'layout', label: 'Layout', icon: LayoutGrid },
    ],
  },
  {
    label: 'Core',
    sections: [
      { id: 'env-vars', label: 'Env Vars', icon: Terminal },
      { id: 'network', label: 'Network', icon: Wifi },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'auth', label: 'Auth', icon: Shield },
      { id: 'system-llm', label: 'System LLM', icon: Cpu },
    ],
  },
  {
    label: 'Agents',
    sections: [
      { id: 'agents', label: 'Agents', icon: Users },
    ],
  },
  {
    label: 'Experience',
    sections: [
      { id: 'updates', label: 'Updates', icon: RefreshCw },
      { id: 'headroom', label: 'Headroom', icon: Gauge },
    ],
  },
  {
    label: 'Data',
    sections: [
      { id: 'activity-log', label: 'Activity', icon: Activity },
      { id: 'workspaces', label: 'Workspaces', icon: FolderGit2 },
    ],
  },
];

export type SettingsNavProps = {
  activeSection: string | null;
  onSectionChange: (id: string | null) => void;
  onExitSettings: () => void;
};

export function SettingsNav({ activeSection, onSectionChange, onExitSettings }: SettingsNavProps) {
  return (
    <div className="settings-nav-root" aria-label="Settings sections">
      {/* Back button */}
      <button
        type="button"
        className="sidebar-tab"
        onClick={onExitSettings}
        aria-label="Exit settings"
      >
        <ArrowLeft size={14} aria-hidden />
        <span className="sidebar-tab-label">Back</span>
      </button>

      <div className="settings-nav-divider" aria-hidden="true" />

      {/* Section groups */}
      {SECTION_GROUPS.map((group) => (
        <div key={group.label} className="settings-nav-group">
          <div className="settings-nav-group-label">{group.label}</div>
          {group.sections.map((s) => {
            const Icon = s.icon;
            const active = activeSection === s.id;
            return (
              <button
                key={s.id}
                type="button"
                className={cn('sidebar-tab', active && 'sidebar-tab-active')}
                onClick={() => onSectionChange(active ? null : s.id)}
                aria-current={active ? 'page' : undefined}
              >
                {Icon && <Icon size={14} aria-hidden />}
                <span className="sidebar-tab-label">{s.label}</span>
                {active && (
                  <ChevronRight size={12} aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
