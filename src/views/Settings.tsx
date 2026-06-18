// src/views/Settings.tsx — user settings form.
import { useEffect, useMemo, useState } from 'react';
import {
  Sliders,
  Save,
  RefreshCw,
  Sun,
  Moon,
  Monitor,
  Info,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { applyTheme, type Settings, type SettingsResponse, type Snapshot, type ThemeName } from '../lib/types';

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

export function SettingsView({ settings: initial, refreshSnapshot }: Props) {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSettings(initial);
    setDirty(false);
  }, [initial]);

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => {
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
      toast.info('Settings reloaded.', 1500);
    } catch (err) {
      toast.error(`Reload failed: ${(err as Error).message}`);
    }
  };

  const about = settings.about || {
    version: '2.6.0',
    homepage: 'https://github.com/DrB0rk/BizarHarness',
    license: 'MIT',
  };
  const notif = settings.notifications || {
    onAgentComplete: true,
    onPlanApproval: true,
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
          <CardTitle>General</CardTitle>
          <CardMeta>Theme, default agent, model override.</CardMeta>

          <div className="field">
            <label className="field-label">Theme</label>
            <div className="theme-row">
              {THEMES.map(({ id, label, Icon }) => {
                const active = settings.theme === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={cn(
                      'theme-card',
                      active && 'theme-card-active',
                    )}
                    onClick={() => {
                      patch('theme', id);
                      applyTheme(id);
                    }}
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
            <span className="field-help">
              Dark is the default; Light is a low-contrast variant; System follows your OS.
            </span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="set-default-agent">
              Default agent
            </label>
            <input
              id="set-default-agent"
              className="input"
              type="text"
              placeholder="e.g. odin"
              value={settings.defaultAgent || ''}
              onChange={(e) => patch('defaultAgent', e.target.value)}
            />
            <span className="field-help">
              Agent used when none is specified.
            </span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="set-default-model">
              Model override
            </label>
            <input
              id="set-default-model"
              className="input"
              type="text"
              placeholder="(leave empty to use provider default)"
              value={settings.defaultModel || ''}
              onChange={(e) => patch('defaultModel', e.target.value)}
            />
          </div>
        </Card>

        <Card>
          <CardTitle>Notifications</CardTitle>
          <CardMeta>Toast triggers inside the dashboard.</CardMeta>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={!!notif.onAgentComplete}
              onChange={(e) =>
                setSettings((cur) => ({
                  ...cur,
                  notifications: {
                    ...(cur.notifications || {
                      onAgentComplete: false,
                      onPlanApproval: false,
                    }),
                    onAgentComplete: e.target.checked,
                  },
                }))
              }
            />
            <span>Notify when an agent invocation completes</span>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={!!notif.onPlanApproval}
              onChange={(e) =>
                setSettings((cur) => ({
                  ...cur,
                  notifications: {
                    ...(cur.notifications || {
                      onAgentComplete: false,
                      onPlanApproval: false,
                    }),
                    onPlanApproval: e.target.checked,
                  },
                }))
              }
            />
            <span>Notify when a plan needs approval</span>
          </label>
        </Card>
      </div>

      <Card>
        <CardTitle>
          <Info size={14} /> About
        </CardTitle>
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
