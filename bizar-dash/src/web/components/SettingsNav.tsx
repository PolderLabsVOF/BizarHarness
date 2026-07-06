// src/components/SettingsNav.tsx — v4.9.0 full-sidebar settings navigation.
// Shown in the sidebar rail when settingsMode is active. All sections are
// visible at once; clicking one scrolls the Settings view to that section.
import { ChevronRight, Palette, Terminal, Cpu, RefreshCw, Gauge, ArrowLeft, LayoutGrid, type LucideIcon } from 'lucide-react';
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
      { id: 'layout', label: 'Layout', icon: LayoutGrid },
      { id: 'general', label: 'General', icon: LayoutGrid },
    ],
  },
  {
    label: 'Core',
    sections: [
      { id: 'env-vars', label: 'Env Vars', icon: Terminal },
      { id: 'system-llm', label: 'System LLM', icon: Cpu },
    ],
  },
  {
    label: 'Experience',
    sections: [
      { id: 'updates', label: 'Updates', icon: RefreshCw },
      { id: 'headroom', label: 'Headroom', icon: Gauge },
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
        className="settings-nav-back"
        onClick={onExitSettings}
        aria-label="Exit settings"
      >
        <ArrowLeft size={14} />
        <span>Back</span>
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
                className={cn('settings-nav-item', active && 'settings-nav-item-active')}
                onClick={() => onSectionChange(active ? null : s.id)}
                aria-current={active ? 'page' : undefined}
              >
                {Icon && <Icon size={14} className="settings-nav-item-icon" aria-hidden />}
                <span className="settings-nav-item-label">{s.label}</span>
                {active && (
                  <ChevronRight size={12} className="settings-nav-item-chevron" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
