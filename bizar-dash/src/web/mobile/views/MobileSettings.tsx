// src/mobile/views/MobileSettings.tsx — mobile settings with full desktop parity.
import { useEffect, useState, useCallback } from 'react';
import { QrCode, RefreshCw, Smartphone, Sun, Moon, Monitor, RotateCcw, Save } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../../lib/api';
import { applyTheme, applyThemeTokens, type Settings, type Snapshot, type ThemeName } from '../../lib/types';

type Props = {
  settings: Settings;
  snapshot: Snapshot | null;
  onRefresh: () => Promise<void>;
};

type PairSession = { token: string; qrPayload: string; publicUrl: string; expiresAt: number };

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

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function MobileSettings({ settings: initial, snapshot, onRefresh }: Props) {
  const [settings, setSettings] = useState<Settings>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pair, setPair] = useState<PairSession | null>(null);
  const [pairing, setPairing] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setSettings(initial);
    setDirty(false);
    if (initial.theme) applyThemeTokens(initial.theme);
  }, [initial]);

  useEffect(() => {
    if (!pair) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pair]);

  const patchTheme = (patch: Partial<Settings['theme']>) => {
    setSettings((cur) => {
      const next = { ...cur, theme: { ...cur.theme, ...patch } };
      applyThemeTokens(next.theme);
      return next;
    });
    setDirty(true);
  };

  const patchTop = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((cur) => ({ ...cur, [key]: value }));
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

  const startPair = async () => {
    setPairing(true);
    try {
      const res = await api.post<PairSession>('/pair/start');
      setPair(res);
    } catch {
      // best-effort
    } finally {
      setPairing(false);
    }
  };

  const remaining = pair ? pair.expiresAt - now : 0;
  const expired = pair != null && remaining <= 0;

  return (
    <div className="mobile-view">
      {/* Save bar */}
      {dirty && (
        <div className="mobile-settings-save-bar">
          <span>Unsaved changes</span>
          <button type="button" className="mobile-btn" disabled={saving} onClick={onSave}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* Theme */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">Appearance</h3>
        <div className="mobile-card">
          {/* Theme mode */}
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

          {/* Accent swatches */}
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

          {/* Font size slider */}
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

          {/* Toggles */}
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
            onChange={(e) => patchTop('defaultAgent', e.target.value)}
          >
            {(snapshot?.agents || []).map((a) => (
              <option key={a.name} value={a.name}>@{a.name}</option>
            ))}
          </select>
          <label className="mobile-field-label" style={{ marginTop: 8 }}>Default Model</label>
          <input
            className="mobile-input"
            type="text"
            placeholder="(auto)"
            value={settings.defaultModel || ''}
            onChange={(e) => patchTop('defaultModel', e.target.value)}
          />
        </div>
      </section>

      {/* Notifications */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">Notifications</h3>
        <div className="mobile-card">
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Agent completion</span>
            <label className="mobile-toggle">
              <input
                type="checkbox"
                checked={!!settings.notifications.onAgentComplete}
                onChange={(e) => setSettings((cur) => ({
                  ...cur,
                  notifications: { ...cur.notifications, onAgentComplete: e.target.checked },
                }))}
              />
              <span className="mobile-toggle-slider" />
            </label>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Plan approval</span>
            <label className="mobile-toggle">
              <input
                type="checkbox"
                checked={!!settings.notifications.onPlanApproval}
                onChange={(e) => setSettings((cur) => ({
                  ...cur,
                  notifications: { ...cur.notifications, onPlanApproval: e.target.checked },
                }))}
              />
              <span className="mobile-toggle-slider" />
            </label>
          </div>
        </div>
      </section>

      {/* Agent behavior */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">Agent Behavior</h3>
        <div className="mobile-card">
          <label className="mobile-field-label">Max parallel agents</label>
          <input
            className="mobile-input"
            type="number"
            min={1}
            max={20}
            value={settings.agents?.maxParallel ?? 6}
            onChange={(e) => setSettings((cur) => ({
              ...cur,
              agents: { ...cur.agents!, maxParallel: Math.max(1, Math.min(20, parseInt(e.target.value) || 6)) },
            }))}
          />
          <label className="mobile-field-label" style={{ marginTop: 8 }}>Stuck threshold (ms)</label>
          <input
            className="mobile-input"
            type="number"
            min={60000}
            max={3600000}
            step={60000}
            value={settings.agents?.stuckThresholdMs ?? 600000}
            onChange={(e) => setSettings((cur) => ({
              ...cur,
              agents: { ...cur.agents!, stuckThresholdMs: Math.max(60000, parseInt(e.target.value) || 600000) },
            }))}
          />
          <div className="mobile-setting-row" style={{ marginTop: 8 }}>
            <span className="mobile-setting-label">Auto-restart stuck agents</span>
            <label className="mobile-toggle">
              <input
                type="checkbox"
                checked={!!settings.agents?.autoRestart}
                onChange={(e) => setSettings((cur) => ({
                  ...cur,
                  agents: { ...cur.agents!, autoRestart: e.target.checked },
                }))}
              />
              <span className="mobile-toggle-slider" />
            </label>
          </div>
        </div>
      </section>

      {/* Tailscale serve */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">Tailscale Serve</h3>
        <div className="mobile-card">
          <p className="muted" style={{ fontSize: 13 }}>
            Use <code>bizar service</code> commands in the terminal to configure Tailscale serve.
          </p>
        </div>
      </section>

      {/* Companion App */}
      <section className="mobile-section">
        <h3 className="mobile-section-title"><Smartphone size={14} /> Companion App</h3>
        <div className="mobile-card">
          {!pair && (
            <button type="button" className="mobile-btn" onClick={startPair} disabled={pairing} style={{ width: '100%' }}>
              <QrCode size={14} /> {pairing ? 'Generating…' : 'Generate QR Code'}
            </button>
          )}
          {pair && !expired && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ background: '#fff', padding: 12, borderRadius: 12, display: 'inline-block' }}>
                <QRCodeSVG value={pair.qrPayload} size={180} level="M" />
              </div>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                Expires in <strong>{formatCountdown(remaining)}</strong>
              </div>
              <div className="mono" style={{ fontSize: 10, wordBreak: 'break-all', marginTop: 4 }}>{pair.publicUrl}</div>
            </div>
          )}
          {pair && expired && (
            <button type="button" className="mobile-btn" onClick={startPair} style={{ width: '100%' }}>
              <RefreshCw size={14} /> Generate new QR
            </button>
          )}
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
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Plans</span>
            <span className="mobile-setting-value">{snapshot?.plans?.length || 0}</span>
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
