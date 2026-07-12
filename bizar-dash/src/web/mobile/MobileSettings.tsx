// src/web/mobile/MobileSettings.tsx — v5.4 mobile settings with full desktop parity.
// All 9 sections in an accordion layout with search.
import { useState } from 'react';
import {
  Settings2, Brain, KeyRound, Cpu, RefreshCw, Globe, Info, ChevronRight,
} from 'lucide-react';
import { cx } from '../ui/utils/cx';
import type { Settings, Snapshot } from '../lib/types';

// Sub-section components — each renders its section content inline.
import { GeneralSection } from '../views/settings/GeneralSection';
import { EnvVarsSection } from '../views/settings/EnvVarsSection';
import { MemorySection } from '../views/settings/MemorySection';
import { SystemLlmSection } from '../views/settings/SystemLlmSection';
import { UpdatesSection } from '../views/settings/UpdatesSection';
import { HeadroomSection } from '../views/settings/HeadroomSection';
import { TailscaleSettings } from '../components/TailscaleSettings';
import { ActivitySection } from '../views/settings/ActivitySection';

// Lazy-load heavy sections that pull in large dependencies.
import React from 'react';

type Props = {
  settings: Settings;
  /** Called when the user changes any top-level setting */
  onSettingsChange?: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** Debounced auto-save to API (key, value) */
  autoSave?: (key: keyof Settings, value: Settings[keyof Settings]) => void;
  /** Optional snapshot for counts / agent list */
  snapshot?: Snapshot | null;
  /** v5.3 compatibility — called after settings are saved (MobileApp.tsx passes refreshSnapshot) */
  onRefresh?: () => Promise<void>;
};

// ─── Section definitions ─────────────────────────────────────────────────────

function GeneralSettings({ settings, onSettingsChange, autoSave }: Props) {
  const patchTop = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onSettingsChange?.(key, value);
    autoSave?.(key, value);
  };
  const patchUi = (patch: Partial<Settings['ui']>) => {
    onSettingsChange?.('ui', { ...settings.ui, ...patch });
    autoSave?.('ui', { ...settings.ui, ...patch });
  };
  return (
    <GeneralSection
      settings={settings}
      patchUi={patchUi}
      patchTop={patchTop}
      autoSave={autoSave}
    />
  );
}

function ProvidersSettings({ settings, onSettingsChange, autoSave }: Props) {
  // Providers are managed server-side; show a link to the desktop providers view.
  // Mobile can't add/edit providers without more complex auth flow.
  void settings; void onSettingsChange; void autoSave;
  return (
    <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: '8px 0' }}>
      <p style={{ marginBottom: 8 }}>
        Provider management is available on desktop.
      </p>
      <a href="/?desktop=1#settings-providers" className="mobile-btn mobile-btn-secondary" style={{ display: 'inline-block', fontSize: 12, padding: '6px 12px' }}>
        Open desktop to manage providers
      </a>
    </div>
  );
}

function EnvVarsSettings() {
  return <EnvVarsSection />;
}

function MemorySettings() {
  return <MemorySection />;
}

function SystemLlmSettings({ settings, onSettingsChange, autoSave }: Props) {
  const patchTop = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onSettingsChange?.(key, value);
    autoSave?.(key, value);
  };
  return <SystemLlmSection settings={settings} patchTop={patchTop} />;
}

function UpdatesSettings() {
  return <UpdatesSection />;
}

function HeadroomSettingsSection({ settings }: { settings: Settings }) {
  const [localSettings, setLocalSettings] = useState(settings);
  const [dirty, setDirty] = useState(false);
  return (
    <HeadroomSection
      settings={localSettings}
      setSettings={setLocalSettings as React.Dispatch<React.SetStateAction<Settings>>}
      setDirty={setDirty}
    />
  );
}

function TailscaleSettingsMobile() {
  return <TailscaleSettings />;
}

function AboutSection({ settings }: { settings: Settings }) {
  const about = settings.about || { version: '—', homepage: 'https://github.com/DrB0rk/BizarHarness', license: 'MIT' };
  return <ActivitySection about={about} />;
}

// ─── Main component ──────────────────────────────────────────────────────────

export function MobileSettings({ settings, onSettingsChange, autoSave, snapshot }: Props) {
  const [search, setSearch] = useState('');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const sections = [
    {
      id: 'general',
      title: 'General',
      icon: Settings2,
      description: 'Theme, accent, layout',
      component: <GeneralSettings settings={settings} onSettingsChange={onSettingsChange} autoSave={autoSave} />,
    },
    {
      id: 'providers',
      title: 'AI Providers',
      icon: Brain,
      description: `${snapshot?.providers?.length ?? 0} configured`,
      component: <ProvidersSettings settings={settings} onSettingsChange={onSettingsChange} autoSave={autoSave} />,
    },
    {
      id: 'env-vars',
      title: 'Environment Variables',
      icon: KeyRound,
      description: 'API keys, secrets',
      component: <EnvVarsSettings />,
    },
    {
      id: 'memory',
      title: 'Memory Vault',
      icon: Brain,
      description: 'Git remote, LightRAG config',
      component: <MemorySettings />,
    },
    {
      id: 'system-llm',
      title: 'System LLM',
      icon: Cpu,
      description: settings.systemLlm?.model || 'not set',
      component: <SystemLlmSettings settings={settings} onSettingsChange={onSettingsChange} autoSave={autoSave} />,
    },
    {
      id: 'updates',
      title: 'Updates',
      icon: RefreshCw,
      description: 'Check for updates',
      component: <UpdatesSettings />,
    },
    {
      id: 'headroom',
      title: 'Headroom',
      icon: Cpu,
      description: settings.headroom?.enabled ? 'Enabled' : 'Disabled',
      component: <HeadroomSettingsSection settings={settings} />,
    },
    {
      id: 'tailscale',
      title: 'Tailscale',
      icon: Globe,
      description: 'Tailscale serve & auth',
      component: <TailscaleSettingsMobile />,
    },
    {
      id: 'about',
      title: 'About',
      icon: Info,
      description: `Bizar v${settings.about?.version || '—'}`,
      component: <AboutSection settings={settings} />,
    },
  ];

  const filtered = sections.filter(
    (s) =>
      !search ||
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mobile-settings">
      <div className="mobile-settings-search">
        <SearchIcon />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search settings..."
          aria-label="Search settings"
        />
      </div>

      <div className="mobile-settings-list">
        {filtered.map((s) => {
          const Icon = s.icon;
          const isExpanded = expandedSection === s.id;
          return (
            <div key={s.id} className={cx('mobile-settings-item', isExpanded && 'is-expanded')}>
              <button
                className="mobile-settings-item-head"
                onClick={() => setExpandedSection(isExpanded ? null : s.id)}
                aria-expanded={isExpanded}
                aria-controls={`mobile-settings-body-${s.id}`}
              >
                <div className="mobile-settings-item-icon">
                  <Icon size={18} />
                </div>
                <div className="mobile-settings-item-text">
                  <div className="mobile-settings-item-title">{s.title}</div>
                  <div className="mobile-settings-item-desc">{s.description}</div>
                </div>
                <ChevronRight
                  size={16}
                  className={cx('mobile-settings-item-chevron', isExpanded && 'is-rotated')}
                />
              </button>
              {isExpanded && (
                <div id={`mobile-settings-body-${s.id}`} className="mobile-settings-item-body">
                  {s.component}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="mobile-settings-empty">No settings match "{search}"</div>
        )}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}
