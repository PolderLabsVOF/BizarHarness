// src/views/Settings.tsx — v6.x per-section settings view.
//
// v6.x — Each settings section is its own top-level tab. SettingsView
// accepts a `section` prop and renders ONLY that section. The page
// header reflects the section name. There is no in-page subnav or
// grouped section display — the sidebar rail already carries navigation.
//
// The Save / Reload / Reset buttons remain at the page level because
// most sections still share the global Settings object on the server
// (the auto-save behaviour in some section components is a UX nicety,
// not a substitute for explicit save).
import React, { useEffect, useState, useRef, useCallback, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  Palette,
  RefreshCw,
  RotateCcw,
  LayoutGrid,
  Sliders,
  Terminal,
  Wifi,
  Bell,
  Lock,
  Bot,
  Cpu,
  Gauge,
  Activity as ActivityIcon,
  Folder,
  Save,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { applyTheme, applyThemeTokens, type Settings, type SettingsResponse, type Snapshot, type TailscaleStatus } from '../lib/types';

import { ThemeSection } from './settings/ThemeSection';
import { UpdatesSection } from './settings/UpdatesSection';
import { GeneralSection } from './settings/GeneralSection';
import { NetworkSection } from './settings/NetworkSection';
import { TailscaleSettings } from '../components/TailscaleSettings';
import { NotificationsSection } from './settings/NotificationsSection';
import { AuthSection } from './settings/AuthSection';
import { AgentSection } from './settings/AgentSection';
import { SystemLlmSection } from './settings/SystemLlmSection';
import { HeadroomSection } from './settings/HeadroomSection';
import { ActivitySection } from './settings/ActivitySection';
import { WorkspacesSection } from './settings/WorkspacesSection';
import { EnvVarsSection } from './settings/EnvVarsSection';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
  /** v6.x — Which settings section to render. Each section is its own tab. */
  section?: string;
};

type TailscaleDraft = { port: number; https: boolean; hostname: string };
type AuthStatusShape = { required: boolean; loopback: boolean; peer: string };

type SectionDef = {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  render: (ctx: {
    sp: {
      settings: Settings;
      patchTheme: (patch: Partial<Settings['theme']>) => void;
      patchUi: (patch: Partial<Settings['ui']>) => void;
      patchTop: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
      patchNotifications: (patch: Partial<Settings['notifications']>) => void;
      patchAgents: (patch: Partial<Settings['agents']>) => void;
      patchDashboard: (patch: Partial<Settings['dashboard']>) => void;
    };
    autoSave: (key: keyof Settings, value: Settings[keyof Settings]) => Promise<void>;
    tailscale: TailscaleStatus | null;
    tailscaleDraft: TailscaleDraft;
    setTailscaleDraft: Dispatch<SetStateAction<TailscaleDraft>>;
    onTailscaleToggle: () => Promise<void>;
    authStatus: AuthStatusShape | null;
    setAuthStatus: Dispatch<SetStateAction<AuthStatusShape | null>>;
    setSettings: Dispatch<SetStateAction<Settings>>;
    setDirty: Dispatch<SetStateAction<boolean>>;
    about: { version: string; homepage: string; license: string };
  }) => ReactNode;
};

/* v6.x — Section definitions. Order here drives the order of the section
   tabs in VIEW_MAP (already registered in App.tsx). */
const SECTION_DEFS: Record<string, SectionDef> = {
  theme: {
    id: 'theme',
    label: 'Theme',
    icon: Palette,
    description: 'Accent colors, fonts, density, and animation preferences.',
    render: ({ sp }) => <ThemeSection {...sp} />,
  },
  updates: {
    id: 'updates',
    label: 'Updates',
    icon: RefreshCw,
    description: 'Choose the update channel and check for new Bizar versions.',
    render: () => <UpdatesSection />,
  },
  layout: {
    id: 'layout',
    label: 'Layout',
    icon: LayoutGrid,
    description: 'UI layout mode, default tab, and status bar visibility.',
    render: ({ sp, autoSave }) => <GeneralSection {...sp} autoSave={autoSave} />,
  },
  general: {
    id: 'general',
    label: 'General',
    icon: Sliders,
    description: 'Default agent and model overrides.',
    render: ({ sp, autoSave }) => <GeneralSection {...sp} autoSave={autoSave} />,
  },
  'env-vars': {
    id: 'env-vars',
    label: 'Env Vars',
    icon: Terminal,
    description: 'Inspect and edit environment variables exposed to agents.',
    render: () => <EnvVarsSection />,
  },
  network: {
    id: 'network',
    label: 'Network',
    icon: Wifi,
    description: 'Tailscale Serve, proxy settings, and dashboard network options.',
    render: ({ sp, tailscale, tailscaleDraft, setTailscaleDraft, onTailscaleToggle }) => (
      <>
        <NetworkSection
          tailscale={tailscale}
          tailscaleDraft={tailscaleDraft}
          setTailscaleDraft={setTailscaleDraft}
          onTailscaleToggle={onTailscaleToggle}
        />
        <TailscaleSettings initialStatus={tailscale} />
      </>
    ),
  },
  notifications: {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    description: 'When the dashboard should ping you.',
    render: ({ sp }) => <NotificationsSection {...sp} />,
  },
  auth: {
    id: 'auth',
    label: 'Auth',
    icon: Lock,
    description: 'Authentication and token-bearer settings.',
    render: ({ sp, authStatus, setAuthStatus }) => (
      <AuthSection settings={sp.settings} authStatus={authStatus} setAuthStatus={setAuthStatus} />
    ),
  },
  agents: {
    id: 'agents',
    label: 'Agents',
    icon: Bot,
    description: 'Agent runner config: parallelism, stuck thresholds, autonomy.',
    render: ({ sp, autoSave }) => <AgentSection {...sp} autoSave={autoSave} />,
  },
  'system-llm': {
    id: 'system-llm',
    label: 'System LLM',
    icon: Cpu,
    description: 'LLM used by the dashboard for auto-titling and enhancements.',
    render: ({ sp }) => <SystemLlmSection {...sp} />,
  },
  headroom: {
    id: 'headroom',
    label: 'Headroom',
    icon: Gauge,
    description: 'Context compression proxy settings.',
    render: ({ sp, setSettings, setDirty }) => (
      <HeadroomSection settings={sp.settings} setSettings={setSettings} setDirty={setDirty} />
    ),
  },
  'activity-log': {
    id: 'activity-log',
    label: 'Activity Log',
    icon: ActivityIcon,
    description: 'Per-agent activity retention and the About card.',
    render: ({ about }) => <ActivitySection about={about} />,
  },
  workspaces: {
    id: 'workspaces',
    label: 'Workspaces',
    icon: Folder,
    description: 'Manage workspace roots and shared directories.',
    render: () => <WorkspacesSection />,
  },
};

function SettingsViewInner({
  settings: initial,
  refreshSnapshot,
  section = 'theme',
}: Props) {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tailscale, setTailscale] = useState<TailscaleStatus | null>(null);
  const [tailscaleDraft, setTailscaleDraft] = useState({ port: 4321, https: true, hostname: '' });
  const [authStatus, setAuthStatus] = useState<{ required: boolean; loopback: boolean; peer: string } | null>(null);

  const def = SECTION_DEFS[section] ?? SECTION_DEFS.theme;

  useEffect(() => { setSettings(initial); setDirty(false); if (initial.theme) applyThemeTokens(initial.theme); }, [initial]);
  useEffect(() => { if (!tailscale) return; setTailscaleDraft({ port: tailscale.settings.port, https: tailscale.settings.https !== false, hostname: tailscale.settings.hostname || '' }); }, [tailscale]);
  useEffect(() => { api.get<TailscaleStatus>('/tailscale/status').then(setTailscale).catch(() => undefined); }, []);

  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const autoSave = useCallback(async (key: keyof Settings, value: Settings[keyof Settings]) => {
    setSettings((cur) => ({ ...cur, [key]: value }));
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await api.put('/settings', { ...settings, [key]: value });
      } catch (err) {
        console.error('autoSave failed', err);
      }
    }, 300);
  }, [settings]);

  useEffect(() => () => {
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
  }, []);

  const patchTheme = (patch: Partial<Settings['theme']>) => { setSettings((cur) => { const next = { ...cur, theme: { ...cur.theme, ...patch } }; applyThemeTokens(next.theme); return next; }); setDirty(true); };
  const patchUi = (patch: Partial<Settings['ui']>) => { setSettings((cur) => ({ ...cur, ui: { ...cur.ui, ...patch } })); setDirty(true); };
  const patchTop = <K extends keyof Settings>(key: K, value: Settings[K]) => { setSettings((cur) => ({ ...cur, [key]: value })); setDirty(true); };
  const patchNotifications = (patch: Partial<Settings['notifications']>) => { setSettings((cur) => ({ ...cur, notifications: { ...cur.notifications, ...patch } })); setDirty(true); };
  const patchAgents = (patch: Partial<Settings['agents']>) => { setSettings((cur) => ({ ...cur, agents: { ...cur.agents, ...patch } })); setDirty(true); };
  const patchDashboard = (patch: Partial<Settings['dashboard']>) => { setSettings((cur) => ({ ...cur, dashboard: { ...cur.dashboard, ...patch } })); setDirty(true); };

  const onTailscaleToggle = async () => {
    try {
      if (tailscale?.settings.enabled) { await api.post('/tailscale/disable'); toast.success('Tailscale serve disabled.'); }
      else { await api.post('/tailscale/enable', { port: tailscaleDraft.port || 4321, https: tailscaleDraft.https, hostname: tailscaleDraft.hostname || '' }); toast.success('Tailscale serve enabled.'); }
      setTailscale(await api.get<TailscaleStatus>('/tailscale/status'));
    } catch (err) { toast.error(`Tailscale failed: ${(err as Error).message}`); }
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const r = await api.put<SettingsResponse>('/settings', settings);
      setSettings(r.data); setDirty(false); applyTheme(r.data.theme); applyThemeTokens(r.data.theme);
      toast.success('Settings saved.'); await refreshSnapshot();
    } catch (err) { toast.error(`Save failed: ${(err as Error).message}`); }
    finally { setSaving(false); }
  };

  const onReload = async () => {
    try {
      const r = await api.get<SettingsResponse>('/settings');
      setSettings(r.data); setDirty(false); applyTheme(r.data.theme); applyThemeTokens(r.data.theme);
      toast.info('Settings reloaded.', 1500);
    } catch (err) { toast.error(`Reload failed: ${(err as Error).message}`); }
  };

  const onReset = async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    try {
      const r = await api.post<SettingsResponse>('/settings/reset');
      setSettings(r.data); setDirty(false); applyTheme(r.data.theme); applyThemeTokens(r.data.theme);
      toast.success('Settings reset.'); await refreshSnapshot();
    } catch (err) { toast.error(`Reset failed: ${(err as Error).message}`); }
  };

  const sp = { settings, patchTheme, patchUi, patchTop, patchNotifications, patchAgents, patchDashboard };
  const about = settings.about || { version: '3.0.4', homepage: 'https://github.com/DrB0rk/BizarHarness', license: 'MIT' };
  const Icon = def.icon;

  return (
    <div className="view view-settings">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Icon size={18} aria-hidden /> {def.label}
          </h2>
          <p className="view-subtitle">{def.description}</p>
        </div>
        <div className="view-actions">
          <Button variant="ghost" size="sm" onClick={onReset} aria-label="Reset all settings">
            <RotateCcw size={14} /> Reset
          </Button>
          <Button variant="secondary" size="sm" onClick={onReload} aria-label="Reload settings from disk">
            <RefreshCw size={14} /> Reload
          </Button>
          <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={onSave}>
            {saving ? <span className="btn-spinner" /> : <Save size={14} aria-hidden />}{saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </header>

      <div className="settings-body" data-section={def.id}>
        <div id={`settings-${def.id}`}>
          {def.render({
            sp,
            autoSave,
            tailscale,
            tailscaleDraft,
            setTailscaleDraft,
            onTailscaleToggle,
            authStatus,
            setAuthStatus,
            setSettings,
            setDirty,
            about,
          })}
        </div>
      </div>
    </div>
  );
}

export const SettingsView = React.memo(SettingsViewInner);
export const __SETTINGS_SECTION_IDS = Object.keys(SECTION_DEFS);