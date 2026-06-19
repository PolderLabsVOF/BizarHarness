// src/views/Settings.tsx — v3 settings: theme colors, UI layout, defaults, Tailscale, service.
import { useEffect, useState } from 'react';
import {
  Sliders,
  Save,
  RefreshCw,
  Sun,
  Moon,
  Monitor,
  Info,
  Globe,
  Palette,
  Layout as LayoutIcon,
  Server as ServerIcon,
  RotateCcw,
  Plug,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  applyTheme,
  applyThemeTokens,
  type Settings,
  type SettingsResponse,
  type Snapshot,
  type ThemeName,
  type TailscaleStatus,
} from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

const THEMES: { id: ThemeName; label: string; Icon: typeof Sun }[] = [
  { id: 'dark', label: 'Dark', Icon: Moon },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'system', label: 'System', Icon: Monitor },
];

const FONT_FAMILIES = [
  'Inter',
  'system-ui',
  'Segoe UI',
  'Roboto',
  'JetBrains Mono',
  'SF Mono',
  'Cascadia Code',
];

const LAYOUTS = [
  { id: 'topnav', label: 'Top nav' },
  { id: 'sidebar', label: 'Sidebar' },
  { id: 'both', label: 'Both' },
] as const;

export function SettingsView({ settings: initial, refreshSnapshot }: Props) {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tailscale, setTailscale] = useState<TailscaleStatus | null>(null);

  useEffect(() => {
    setSettings(initial);
    setDirty(false);
    if (initial.theme) applyThemeTokens(initial.theme);
  }, [initial]);

  useEffect(() => {
    api.get<TailscaleStatus>('/tailscale/status').then(setTailscale).catch(() => undefined);
  }, []);

  const patchTheme = (patch: Partial<Settings['theme']>) => {
    setSettings((cur) => {
      const next = { ...cur, theme: { ...cur.theme, ...patch } };
      applyThemeTokens(next.theme);
      return next;
    });
    setDirty(true);
  };

  const patchUi = (patch: Partial<Settings['ui']>) => {
    setSettings((cur) => ({ ...cur, ui: { ...cur.ui, ...patch } }));
    setDirty(true);
  };

  const patchTop = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((cur) => ({ ...cur, [key]: value }));
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const r = await api.put<SettingsResponse>('/settings', settings);
      setSettings(r.data);
      setDirty(false);
      applyTheme(r.data.theme);
      applyThemeTokens(r.data.theme);
      toast.success('Settings saved.');
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const onReload = async () => {
    try {
      const r = await api.get<SettingsResponse>('/settings');
      setSettings(r.data);
      setDirty(false);
      applyTheme(r.data.theme);
      applyThemeTokens(r.data.theme);
      toast.info('Settings reloaded.', 1500);
    } catch (err) {
      toast.error(`Reload failed: ${(err as Error).message}`);
    }
  };

  const onReset = async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    try {
      const r = await api.post<SettingsResponse>('/settings/reset');
      setSettings(r.data);
      setDirty(false);
      applyTheme(r.data.theme);
      applyThemeTokens(r.data.theme);
      toast.success('Settings reset.');
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Reset failed: ${(err as Error).message}`);
    }
  };

  const onTailscaleToggle = async () => {
    try {
      if (tailscale?.settings.enabled) {
        await api.post('/tailscale/disable');
        toast.success('Tailscale serve disabled.');
      } else {
        await api.post('/tailscale/enable', {
          port: tailscale?.settings.port || 4321,
          https: tailscale?.settings.https !== false,
          hostname: tailscale?.settings.hostname || '',
        });
        toast.success('Tailscale serve enabled.');
      }
      const r = await api.get<TailscaleStatus>('/tailscale/status');
      setTailscale(r);
    } catch (err) {
      toast.error(`Tailscale failed: ${(err as Error).message}`);
    }
  };

  const about = settings.about || {
    version: '3.0.3',
    homepage: 'https://github.com/DrB0rk/BizarHarness',
    license: 'MIT',
  };

  return (
    <div className="view view-settings">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Sliders size={18} /> Settings
          </h2>
          <p className="view-subtitle">
            Personal preferences. Changes are saved to{' '}
            <code>~/.config/bizar/settings.json</code>.
          </p>
        </div>
        <div className="view-actions">
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw size={14} /> Reset
          </Button>
          <Button variant="secondary" size="sm" onClick={onReload}>
            <RefreshCw size={14} /> Reload
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || saving}
            onClick={onSave}
          >
            {saving ? <span className="btn-spinner" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </header>

      <div className="settings-grid">
        <Card>
          <CardTitle><Palette size={14} /> Theme</CardTitle>
          <CardMeta>Mode, accent, and colors. Live preview as you tweak.</CardMeta>

          <div className="field">
            <label className="field-label">Mode</label>
            <div className="theme-row">
              {THEMES.map(({ id, label, Icon }) => {
                const active = settings.theme.mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={cn('theme-card', active && 'theme-card-active')}
                    onClick={() => patchTheme({ mode: id })}
                  >
                    <Icon size={16} />
                    <span className="theme-card-label">{label}</span>
                    <span
                      className={cn(
                        'theme-card-swatch',
                        `theme-card-swatch-${id}`,
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="theme-colors">
            <div className="field">
              <label className="field-label">Accent</label>
              <div className="color-row">
                <input
                  type="color"
                  className="input color-input"
                  value={settings.theme.accent}
                  onChange={(e) => patchTheme({ accent: e.target.value })}
                />
                <input
                  type="text"
                  className="input"
                  value={settings.theme.accent}
                  onChange={(e) => patchTheme({ accent: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label className="field-label">Success</label>
              <div className="color-row">
                <input
                  type="color"
                  className="input color-input"
                  value={settings.theme.success}
                  onChange={(e) => patchTheme({ success: e.target.value })}
                />
                <input
                  type="text"
                  className="input"
                  value={settings.theme.success}
                  onChange={(e) => patchTheme({ success: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label className="field-label">Warning</label>
              <div className="color-row">
                <input
                  type="color"
                  className="input color-input"
                  value={settings.theme.warning}
                  onChange={(e) => patchTheme({ warning: e.target.value })}
                />
                <input
                  type="text"
                  className="input"
                  value={settings.theme.warning}
                  onChange={(e) => patchTheme({ warning: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label className="field-label">Error</label>
              <div className="color-row">
                <input
                  type="color"
                  className="input color-input"
                  value={settings.theme.error}
                  onChange={(e) => patchTheme({ error: e.target.value })}
                />
                <input
                  type="text"
                  className="input"
                  value={settings.theme.error}
                  onChange={(e) => patchTheme({ error: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label className="field-label">Info</label>
              <div className="color-row">
                <input
                  type="color"
                  className="input color-input"
                  value={settings.theme.info}
                  onChange={(e) => patchTheme({ info: e.target.value })}
                />
                <input
                  type="text"
                  className="input"
                  value={settings.theme.info}
                  onChange={(e) => patchTheme({ info: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="field">
            <label className="field-label">Font family</label>
            <select
              className="select"
              value={settings.theme.fontFamily}
              onChange={(e) => patchTheme({ fontFamily: e.target.value })}
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Font size: {settings.theme.fontSize}px</label>
            <input
              type="range"
              min={12}
              max={20}
              value={settings.theme.fontSize}
              onChange={(e) => patchTheme({ fontSize: Number(e.target.value) })}
            />
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.theme.compactMode}
              onChange={(e) => patchTheme({ compactMode: e.target.checked })}
            />
            <span>Compact mode (denser UI)</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.theme.animations}
              onChange={(e) => patchTheme({ animations: e.target.checked })}
            />
            <span>Enable animations</span>
          </label>
        </Card>

        <Card>
          <CardTitle><LayoutIcon size={14} /> UI layout</CardTitle>
          <CardMeta>Choose how the dashboard's navigation is presented.</CardMeta>
          <div className="layout-row">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={cn('layout-card', settings.ui.layout === l.id && 'layout-card-active')}
                onClick={() => patchUi({ layout: l.id })}
              >
                <span className="layout-card-label">{l.label}</span>
              </button>
            ))}
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.ui.showHeader}
              onChange={(e) => patchUi({ showHeader: e.target.checked })}
            />
            <span>Show header</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.ui.showStatusBar}
              onChange={(e) => patchUi({ showStatusBar: e.target.checked })}
            />
            <span>Show status bar</span>
          </label>
          <div className="field">
            <label className="field-label">Default tab</label>
            <select
              className="select"
              value={settings.ui.defaultTab}
              onChange={(e) => patchUi({ defaultTab: e.target.value })}
            >
              <option value="overview">Overview</option>
              <option value="chat">Chat</option>
              <option value="agents">Agents</option>
              <option value="plans">Plans</option>
              <option value="projects">Projects</option>
              <option value="tasks">Tasks</option>
              <option value="config">Config</option>
              <option value="settings">Settings</option>
              <option value="mods">Mods</option>
              <option value="schedules">Schedules</option>
            </select>
          </div>
        </Card>

        <Card>
          <CardTitle>General</CardTitle>
          <CardMeta>Default agent + model override.</CardMeta>
          <div className="field">
            <label className="field-label" htmlFor="set-default-agent">Default agent</label>
            <input
              id="set-default-agent"
              className="input"
              type="text"
              placeholder="e.g. odin"
              value={settings.defaultAgent || ''}
              onChange={(e) => patchTop('defaultAgent', e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="set-default-model">Model override</label>
            <input
              id="set-default-model"
              className="input"
              type="text"
              placeholder="(leave empty for provider default)"
              value={settings.defaultModel || ''}
              onChange={(e) => patchTop('defaultModel', e.target.value)}
            />
          </div>
        </Card>

        <Card>
          <CardTitle><ServerIcon size={14} /> Service</CardTitle>
          <CardMeta>Background daemon that runs schedules.</CardMeta>
          {tailscale ? (
            <div className="service-card">
              <p>
                Status: <strong>{tailscale?.settings.enabled ? 'enabled' : 'disabled'}</strong>
                {' '}· Tailscale installed: <strong>{tailscale.installed ? 'yes' : 'no'}</strong>
                {' '}· authenticated: <strong>{tailscale.authenticated ? 'yes' : 'no'}</strong>
              </p>
              <p className="muted">
                Use <code>bizar service start</code> / <code>bizar service stop</code> in
                your terminal to control the daemon.
              </p>
            </div>
          ) : (
            <p className="muted">Loading service status…</p>
          )}
        </Card>

        <Card>
          <CardTitle><Plug size={14} /> Tailscale serve</CardTitle>
          <CardMeta>Expose the dashboard over your Tailscale network.</CardMeta>
          {tailscale ? (
            <>
              <p>
                Installed: <strong>{tailscale.installed ? 'yes' : 'no'}</strong>{' '}
                {tailscale.version && <span className="muted">({tailscale.version})</span>}
              </p>
              <p>
                Authenticated: <strong>{tailscale.authenticated ? 'yes' : 'no'}</strong>
              </p>
              <p>
                Serve enabled: <strong>{tailscale.settings.enabled ? 'yes' : 'no'}</strong>
              </p>
              <div className="task-form-row">
                <div className="task-form-field">
                  <label className="field-label">Port</label>
                  <input
                    type="number"
                    className="input"
                    defaultValue={tailscale.settings.port}
                    onChange={(e) => {
                      // Update local state via patchUi is unrelated; just inform
                    }}
                  />
                </div>
                <div className="task-form-field">
                  <label className="field-label">Use HTTPS</label>
                  <input
                    type="checkbox"
                    defaultChecked={tailscale.settings.https === true}
                  />
                </div>
              </div>
              <Button variant="primary" onClick={onTailscaleToggle}>
                {tailscale.settings.enabled ? 'Disable serve' : 'Enable serve'}
              </Button>
            </>
          ) : (
            <p className="muted">Loading Tailscale status…</p>
          )}
        </Card>

        <Card>
          <CardTitle>Notifications</CardTitle>
          <CardMeta>Toast triggers inside the dashboard.</CardMeta>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={!!settings.notifications.onAgentComplete}
              onChange={(e) =>
                setSettings((cur) => ({
                  ...cur,
                  notifications: { ...cur.notifications, onAgentComplete: e.target.checked },
                }))
              }
            />
            <span>Notify when an agent invocation completes</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={!!settings.notifications.onPlanApproval}
              onChange={(e) =>
                setSettings((cur) => ({
                  ...cur,
                  notifications: { ...cur.notifications, onPlanApproval: e.target.checked },
                }))
              }
            />
            <span>Notify when a plan needs approval</span>
          </label>
        </Card>

        <Card>
          <CardTitle><Globe size={14} /> Dashboard</CardTitle>
          <CardMeta>Controls how <code>bizar</code> starts up.</CardMeta>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.dashboard.autoLaunchWeb !== false}
              onChange={(e) =>
                setSettings((cur) => ({
                  ...cur,
                  dashboard: { ...cur.dashboard, autoLaunchWeb: e.target.checked },
                }))
              }
            />
            <span>Auto-launch web UI alongside TUI</span>
          </label>
        </Card>
      </div>

      <Card>
        <CardTitle><Info size={14} /> About</CardTitle>
        <CardMeta>Build metadata.</CardMeta>
        <dl className="about-table">
          <dt>Version</dt>
          <dd className="mono">{about.version}</dd>
          <dt>Homepage</dt>
          <dd>
            <a href={about.homepage} target="_blank" rel="noopener noreferrer">
              {about.homepage}
            </a>
          </dd>
          <dt>License</dt>
          <dd>{about.license}</dd>
        </dl>
      </Card>
    </div>
  );
}
