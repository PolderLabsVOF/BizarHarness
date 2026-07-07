// src/views/Settings.tsx — v4 settings shell: routes to focused sub-components.
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Sliders, Save, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { applyTheme, applyThemeTokens, type Settings, type SettingsResponse, type Snapshot, type TailscaleStatus } from '../lib/types';

import { SettingsSearch, type SettingsSection, type SettingsField } from '../components/SettingsSearch';
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
import { logger } from '../lib/logger';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
  /** v4.9.0 — When true, navigation uses the sidebar instead of the subnav bar. */
  settingsMode?: boolean;
  /** v4.9.0 — The active section. Null means "show all". Used when settingsMode is true. */
  settingsActiveSection?: string | null;
  /** v4.9.0 — Called when the user selects a section via the sidebar. */
  setSettingsActiveSection?: (id: string | null) => void;
};

const SECTION_LINKS = [
  { id: 'theme', label: 'Theme' },
  { id: 'updates', label: 'Updates' },
  { id: 'layout', label: 'Layout' },
  { id: 'general', label: 'General' },
  { id: 'env-vars', label: 'Env Vars' },
  { id: 'network', label: 'Network' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'auth', label: 'Auth' },
  { id: 'agents', label: 'Agents' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'background', label: 'Background' },
  { id: 'system-llm', label: 'System LLM' },
  { id: 'headroom', label: 'Headroom' },
  { id: 'activity-log', label: 'Activity' },
  { id: 'about', label: 'About' },
  { id: 'workspaces', label: 'Workspaces' },
] as const;

/* ─── Settings search sections metadata ─── */
const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'theme', label: 'Theme', fields: [
    { key: 'theme.presets', label: 'Accent presets', section: 'theme' },
    { key: 'theme.accent', label: 'Accent color', section: 'theme' },
    { key: 'theme.success', label: 'Success color', section: 'theme' },
    { key: 'theme.warning', label: 'Warning color', section: 'theme' },
    { key: 'theme.error', label: 'Error color', section: 'theme' },
    { key: 'theme.info', label: 'Info color', section: 'theme' },
    { key: 'theme.fontFamily', label: 'Font family', section: 'theme' },
    { key: 'theme.fontSize', label: 'Font size', section: 'theme' },
    { key: 'theme.compactMode', label: 'Compact mode', section: 'theme' },
    { key: 'theme.animations', label: 'Animations', section: 'theme' },
  ] },
  { id: 'updates', label: 'Updates', fields: [
    { key: 'updates.channel', label: 'Update channel', section: 'updates' },
  ] },
  { id: 'layout', label: 'Layout', fields: [
    { key: 'ui.layout', label: 'UI layout', section: 'layout' },
    { key: 'ui.showHeader', label: 'Show header', section: 'layout' },
    { key: 'ui.showStatusBar', label: 'Show status bar', section: 'layout' },
    { key: 'ui.defaultTab', label: 'Default tab', section: 'layout' },
  ] },
  { id: 'general', label: 'General', fields: [
    { key: 'defaultAgent', label: 'Default agent', section: 'general' },
    { key: 'defaultModel', label: 'Model override', section: 'general' },
  ] },
  { id: 'env-vars', label: 'Environment Variables', fields: [
    { key: 'env-vars.count', label: 'Env var count', section: 'env-vars' },
  ] },
  { id: 'network', label: 'Network', fields: [
    { key: 'tailscale.enabled', label: 'Tailscale Serve', section: 'network' },
    { key: 'tailscale.port', label: 'Tailscale port', section: 'network' },
    { key: 'tailscale.https', label: 'Tailscale HTTPS', section: 'network' },
    { key: 'tailscale.hostname', label: 'Tailscale hostname', section: 'network' },
  ] },
  { id: 'notifications', label: 'Notifications', fields: [
    { key: 'notifications.onAgentComplete', label: 'Notify on agent complete', section: 'notifications' },
    { key: 'notifications.onPlanApproval', label: 'Notify on plan approval', section: 'notifications' },
  ] },
  { id: 'auth', label: 'Auth', fields: [
    { key: 'auth.enabled', label: 'Auth enabled', section: 'auth' },
    { key: 'auth.loopback', label: 'Loopback mode', section: 'auth' },
    { key: 'auth.token', label: 'Auth token', section: 'auth' },
  ] },
  { id: 'agents', label: 'Agents', fields: [
    { key: 'agents.maxParallel', label: 'Max parallel agents', section: 'agents' },
    { key: 'agents.stuckThresholdMs', label: 'Stuck threshold', section: 'agents' },
    { key: 'agents.autoRestart', label: 'Auto restart', section: 'agents' },
    { key: 'workflow.artifactsEnabled', label: 'Artifacts enabled', section: 'agents' },
    { key: 'workflow.agentsDecideAutonomously', label: 'Autonomous decisions', section: 'agents' },
  ] },
  { id: 'dashboard', label: 'Dashboard', fields: [
    { key: 'dashboard.autoLaunchWeb', label: 'Auto-launch web', section: 'dashboard' },
    { key: 'dashboard.projectsDirectory', label: 'Projects directory', section: 'dashboard' },
    { key: 'dashboard.allowedRoots', label: 'Allowed roots', section: 'dashboard' },
  ] },
  { id: 'background', label: 'Background', fields: [
    { key: 'service.enabled', label: 'Background service', section: 'background' },
    { key: 'service.autostart', label: 'Auto-start service', section: 'background' },
  ] },
  { id: 'system-llm', label: 'System LLM', fields: [
    { key: 'systemLlm.enabled', label: 'System LLM enabled', section: 'system-llm' },
  ] },
  { id: 'headroom', label: 'Headroom', fields: [
    { key: 'headroom.enabled', label: 'Headroom enabled', section: 'headroom' },
    { key: 'headroom.port', label: 'Headroom port', section: 'headroom' },
    { key: 'headroom.budget', label: 'Headroom budget', section: 'headroom' },
    { key: 'headroom.backend', label: 'Headroom backend', section: 'headroom' },
  ] },
  { id: 'activity-log', label: 'Activity', fields: [
    { key: 'activity.log', label: 'Activity log', section: 'activity-log' },
  ] },
  { id: 'about', label: 'About', fields: [
    { key: 'about.version', label: 'Version', section: 'about' },
    { key: 'about.homepage', label: 'Homepage', section: 'about' },
    { key: 'about.license', label: 'License', section: 'about' },
  ] },
];

function SettingsViewInner({ settings: initial, refreshSnapshot, settingsMode, settingsActiveSection, setSettingsActiveSection, setActiveTab }: Props) {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tailscale, setTailscale] = useState<TailscaleStatus | null>(null);
  const [tailscaleDraft, setTailscaleDraft] = useState({ port: 4321, https: true, hostname: '' });
  const [authStatus, setAuthStatus] = useState<{ required: boolean; loopback: boolean; peer: string } | null>(null);

  // v4.9.0 — Exit settings mode by switching back to overview tab.
  const handleExitSettings = () => { setActiveTab('overview'); };

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
        logger.error('autoSave failed', err);
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

  // v4.9.0 — In settingsMode, section navigation is driven by the sidebar via
  // settingsActiveSection (shared state at App level). Outside settingsMode,
  // fall back to local hash-based state for backwards compatibility.
  const [localActiveSection, setLocalActiveSection] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const hash = window.location.hash.replace(/^#settings-/, '');
    return SECTION_LINKS.some((s) => s.id === hash) ? hash : null;
  });

  // The effective active section: use sidebar state in settingsMode, local state otherwise.
  const activeSection = settingsMode ? (settingsActiveSection ?? null) : localActiveSection;

  // v4.9.0 — In settingsMode, update the shared App-level state. Otherwise update local state.
  const handleJumpSection = (id: string | null) => {
    if (settingsMode) {
      setSettingsActiveSection?.(id);
    } else {
      setLocalActiveSection(id);
      try {
        history.replaceState(null, '', id ? `#settings-${id}` : window.location.pathname);
        if (id) { const el = document.getElementById(`settings-${id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch { /* ignore */ }
    }
    if (id) {
      const el = document.getElementById(`settings-${id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

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

  // v4.9.0 — showAll means no section is filtered (activeSection is null).
  const showAll = activeSection === null;
  const sectionOf = (id: string) => activeSection === id;

  return (
    <div className="view view-settings">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title"><Sliders size={18} /> Settings</h2>
          <p className="view-subtitle">Personal preferences. Changes are saved to <code>~/.config/bizar/settings.json</code>.</p>
        </div>
        <div className="view-actions">
          <Button variant="ghost" size="sm" onClick={onReset}><RotateCcw size={14} /> Reset</Button>
          <Button variant="secondary" size="sm" onClick={onReload}><RefreshCw size={14} /> Reload</Button>
          <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={onSave}>
            {saving ? <span className="btn-spinner" /> : <Save size={14} />}{saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </header>

      {settingsMode && (
        <div className="settings-mode-banner">
          <span>You're in settings mode. All sections are visible in the sidebar.</span>
          <Button variant="secondary" size="sm" onClick={handleExitSettings}>← Back to main view</Button>
        </div>
      )}

      <SettingsSearch sections={SETTINGS_SECTIONS} onJump={handleJumpSection} />

      {/* v4.9.0 — Subnav removed; section navigation is now driven by the sidebar */}
      {/*
      <nav className="settings-subnav" aria-label="Settings sections">
        <button type="button" className={cn('settings-subnav-button', 'settings-subnav-button-all', showAll && 'settings-subnav-button-active')} onClick={() => handleJumpSection(null)} title="Show all settings sections">All</button>
        {SECTION_LINKS.map((s) => (
          <button key={s.id} type="button" className={cn('settings-subnav-button', activeSection === s.id && 'settings-subnav-button-active')} onClick={() => handleJumpSection(s.id)}>{s.label}</button>
        ))}
      </nav>
      */}

      <div className={cn('settings-grid', activeSection && 'settings-grid-filtered')} data-active-section={activeSection || undefined}>
        {(showAll || sectionOf('theme')) && <div id="settings-theme"><ThemeSection {...sp} /></div>}
        {(showAll || sectionOf('updates')) && <div id="settings-updates"><UpdatesSection /></div>}
        {(showAll || sectionOf('layout')) && <div id="settings-general"><GeneralSection {...sp} autoSave={autoSave} /></div>}
        {(showAll || sectionOf('env-vars')) && <div id="settings-env-vars"><EnvVarsSection /></div>}
        {(showAll || sectionOf('network') || sectionOf('service') || sectionOf('tailscale')) && <div id="settings-network"><NetworkSection tailscale={tailscale} tailscaleDraft={tailscaleDraft} setTailscaleDraft={setTailscaleDraft} onTailscaleToggle={onTailscaleToggle} /></div>}
        {(showAll || sectionOf('network') || sectionOf('tailscale')) && <TailscaleSettings initialStatus={tailscale} />}
        {(showAll || sectionOf('notifications')) && <div id="settings-notifications"><NotificationsSection {...sp} /></div>}
        {(showAll || sectionOf('auth')) && <div id="settings-auth"><AuthSection settings={settings} authStatus={authStatus} setAuthStatus={setAuthStatus} /></div>}
        {(showAll || sectionOf('agents') || sectionOf('dashboard') || sectionOf('background')) && <div id="settings-agents"><AgentSection {...sp} autoSave={autoSave} /></div>}
        {(showAll || sectionOf('system-llm')) && <div id="settings-system-llm"><SystemLlmSection {...sp} /></div>}
        {(showAll || sectionOf('headroom')) && <div id="settings-headroom"><HeadroomSection settings={settings} setSettings={setSettings} setDirty={setDirty} /></div>}
        {(showAll || sectionOf('activity-log') || sectionOf('about')) && <div id="settings-activity-log"><ActivitySection about={about} /></div>}
        {(showAll || sectionOf('workspaces')) && <div id="settings-workspaces"><WorkspacesSection /></div>}
      </div>
    </div>
  );
}

export const SettingsView = React.memo(SettingsViewInner);
