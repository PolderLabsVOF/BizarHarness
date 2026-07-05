// src/web/mobile/MobileSettings.tsx — minimal mobile settings (no companion app, no agent config).
// Drops: Companion App (qrcode.react chunk), Tailscale Serve, Agent Behavior, Notifications toggles.
import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { api } from '../lib/api';
import { applyTheme, applyThemeTokens, type Settings, type Snapshot, type ThemeName } from '../lib/types';

type Props = {
  settings: Settings;
  snapshot: Snapshot | null;
  onRefresh: () => Promise<void>;
};

const THEMES: { id: ThemeName; label: string; Icon: typeof Sun }[] = [
  { id: 'dark', label: 'Dark', Icon: Moon },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'system', label: 'System', Icon: Monitor },
];

const PRESET_ACCENTS = [
  { name: 'Purple', accent: '#8b5cf6' },
  { name: 'Blue', accent: '#3b82f6' },
  { name: 'Green', accent: '#10b981' },
  { name: 'Orange', accent: '#f97316' },
  { name: 'Red', accent: '#ef4444' },
  { name: 'Pink', accent: '#ec4899' },
  { name: 'Cyan', accent: '#06b6d4' },
  { name: 'Mono', accent: '#6b7280' },
];

export function MobileSettings({ settings: initial, snapshot, onRefresh }: Props) {
  const [settings, setSettings] = useState<Settings>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSettings(initial);
    setDirty(false);
    if (initial.theme) applyThemeTokens(initial.theme);
  }, [initial]);

  const patchTheme = (patch: Partial<Settings['theme']>) => {
    setSettings((cur) => {
      const next = { ...cur, theme: { ...cur.theme, ...patch } };
      applyTheme(next.theme);
      applyThemeTokens(next.theme);
      return next;
    });
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const r = await api.put<{ data: Settings }>('/settings', settings);
      setSettings(r.data);
      setDirty(false);
      applyTheme(r.data.theme);
      applyThemeTokens(r.data.theme);
      onRefresh();
    } catch {
      // best-effort
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mobile-view">
      {dirty && (
        <div className="mobile-settings-save-bar">
          <span>Unsaved changes</span>
          <button type="button" className="mobile-btn" disabled={saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* Theme */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">Appearance</h3>
        <div className="mobile-card">
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Theme</span>
            <div className="mobile-theme-btns">
              {THEMES.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`mobile-theme-btn ${settings.theme.mode === id ? 'active' : ''}`}
                  onClick={() => patchTheme({ mode: id })}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mobile-setting-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <span className="mobile-setting-label">Accent color</span>
            <div className="mobile-accent-swatches">
              {PRESET_ACCENTS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className={`mobile-accent-swatch ${settings.theme.accent === p.accent ? 'active' : ''}`}
                  style={{ background: p.accent }}
                  onClick={() => patchTheme({ accent: p.accent })}
                  title={p.name}
                />
              ))}
            </div>
          </div>

          <div className="mobile-setting-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <span className="mobile-setting-label">Font size: {settings.theme.fontSize}px</span>
            <input
              type="range"
              min={12}
              max={20}
              value={settings.theme.fontSize}
              onChange={(e) => patchTheme({ fontSize: Number(e.target.value) })}
              style={{ width: '100%' }}
            />
          </div>

          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Compact mode</span>
            <label className="mobile-toggle">
              <input
                type="checkbox"
                checked={settings.theme.compactMode}
                onChange={(e) => patchTheme({ compactMode: e.target.checked })}
              />
              <span className="mobile-toggle-slider" />
            </label>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Animations</span>
            <label className="mobile-toggle">
              <input
                type="checkbox"
                checked={settings.theme.animations}
                onChange={(e) => patchTheme({ animations: e.target.checked })}
              />
              <span className="mobile-toggle-slider" />
            </label>
          </div>
        </div>
      </section>

      {/* Chat defaults */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">Chat Defaults</h3>
        <div className="mobile-card">
          <label className="mobile-field-label">Default Agent</label>
          <select
            className="mobile-input"
            value={settings.defaultAgent || 'odin'}
            onChange={(e) => setSettings((cur) => ({ ...cur, defaultAgent: e.target.value }))}
          >
            {(snapshot?.agents || []).map((a) => (
              <option key={a.name} value={a.name}>@{a.name}</option>
            ))}
          </select>
        </div>
      </section>

      {/* About */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">About</h3>
        <div className="mobile-card">
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Version</span>
            <span className="mobile-setting-value mono">{settings.about?.version || '—'}</span>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Agents</span>
            <span className="mobile-setting-value">{snapshot?.agents?.length || 0}</span>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Tasks</span>
            <span className="mobile-setting-value">{snapshot?.tasks?.length || 0}</span>
          </div>
        </div>
      </section>

      {/* Switch to desktop */}
      <div className="mobile-view-footer">
        <a href="/?desktop=1" className="mobile-btn mobile-btn-secondary">
          Switch to Desktop
        </a>
      </div>
    </div>
  );
}
