// src/views/Settings.tsx — v3 settings: theme colors, UI layout, defaults, Tailscale, service.
import React, { useEffect, useState, useCallback } from 'react';
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
  Download,
  AlertTriangle,
  QrCode,
  Smartphone,
  CheckCircle,
  AlertCircle,
  Shield,
  Copy,
  KeyRound,
  Activity,
  EyeOff,
  Eye,
  Trash2,
  Search,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Ws } from '../lib/ws';
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

// v3.3.1 — One-click accent color presets.
const PRESET_THEMES = [
  { name: 'Purple', accent: '#8b5cf6' },
  { name: 'Blue', accent: '#3b82f6' },
  { name: 'Green', accent: '#10b981' },
  { name: 'Orange', accent: '#f97316' },
  { name: 'Red', accent: '#ef4444' },
  { name: 'Pink', accent: '#ec4899' },
  { name: 'Cyan', accent: '#06b6d4' },
  { name: 'Mono', accent: '#6b7280' },
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

// v3.5.2 — Pair-with-mobile companion card.
type PairSession = {
  token: string;
  qrPayload: string;
  publicUrl: string;
  expiresAt: number;
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function PairDeviceCard() {
  const toast = useToast();
  const [pair, setPair] = useState<PairSession | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const start = useCallback(async () => {
    setPairing(true);
    setPairError(null);
    try {
      const res = await api.post<PairSession>('/pair/start');
      setPair(res);
    } catch (err) {
      setPairError((err as Error)?.message || 'Failed to start pairing');
      toast.error('Pairing failed.');
    } finally {
      setPairing(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!pair) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pair]);

  const remaining = pair ? pair.expiresAt - now : 0;
  const expired = pair != null && remaining <= 0;

  return (
    <Card>
      <CardTitle>
        <Smartphone size={14} /> Companion App
      </CardTitle>
      <CardMeta>
        Scan the QR with <a href="https://github.com/DrB0rk/BizarHarness" target="_blank" rel="noopener noreferrer">Bizar Companion</a> to pair.
        Tokens expire after 5 minutes.
      </CardMeta>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto' }}>
          {pair && !expired ? (
            <div style={{ background: '#fff', padding: 12, borderRadius: 12 }}>
              <QRCodeSVG value={pair.qrPayload} size={192} level="M" includeMargin={false} />
            </div>
          ) : (
            <div
              style={{
                width: 216,
                height: 216,
                borderRadius: 12,
                background: 'var(--surface-2, #161b22)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted, #8b949e)',
                fontSize: 12,
                textAlign: 'center',
                padding: 16,
                border: '1px dashed var(--border, #30363d)',
              }}
            >
              {pair && expired ? 'QR expired' : 'No QR generated yet'}
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 240px', minWidth: 220 }}>
          {!pair && (
            <Button variant="primary" onClick={start} disabled={pairing}>
              <QrCode size={14} /> {pairing ? 'Generating…' : 'Generate QR Code'}
            </Button>
          )}

          {pair && !expired && (
            <>
              <div style={{ marginBottom: 10 }}>
                <strong>Expires in</strong> <span className="mono">{formatCountdown(remaining)}</span>
              </div>
              <div style={{ marginBottom: 6 }}>
                <strong>URL:</strong> <span className="mono" style={{ wordBreak: 'break-all' }}>{pair.publicUrl}</span>
              </div>
              <div style={{ marginBottom: 12 }}>
                <strong>Token:</strong>{' '}
                <span className="mono" style={{ wordBreak: 'break-all', fontSize: 12 }}>
                  {pair.token.slice(0, 16)}…{pair.token.slice(-6)}
                </span>
              </div>
              <Button variant="secondary" onClick={start} disabled={pairing}>
                <RefreshCw size={14} /> Regenerate
              </Button>
            </>
          )}

          {pair && expired && (
            <>
              <div style={{ marginBottom: 12, color: 'var(--error, #f85149)' }}>
                Token expired — generate a fresh QR to pair again.
              </div>
              <Button variant="primary" onClick={() => { setPair(null); start(); }}>
                <RefreshCw size={14} /> Generate new QR
              </Button>
            </>
          )}

          {pairError && (
            <div style={{ marginTop: 10, color: 'var(--error, #f85149)', fontSize: 12 }}>
              {pairError}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

const LAYOUTS = [
  { id: 'topnav', label: 'Top nav' },
  { id: 'sidebar', label: 'Sidebar' },
  { id: 'both', label: 'Both' },
] as const;

// v3.5.3 — Updates card with per-package selection, live progress, and auto-restart
type PkgStatus = {
  status: 'idle' | 'starting' | 'installing' | 'done' | 'error';
  error?: string;
  newVersion?: string;
  logs: string[];
};

function UpdatesCard() {
  const toast = useToast();
  const [status, setStatus] = useState<{
    current: Record<string, string | null>;
    latest: Record<string, string | null> | null;
    checking: boolean;
    updating: boolean;
    hasUpdates: boolean;
    requiresRestart: boolean;
    perPackage: Record<string, PkgStatus>;
    error?: string;
  }>({
    current: {},
    latest: null,
    checking: false,
    updating: false,
    hasUpdates: false,
    requiresRestart: false,
    perPackage: {},
  });

  // WebSocket subscription for live update progress (auto-reconnect via Ws class)
  useEffect(() => {
    const ws = new Ws();
    ws.on((msg: Record<string, unknown>) => {
      if (msg.type === 'update:progress' || msg.type === 'update:log' || msg.type === 'update:complete') {
        setStatus((s) => {
          if (msg.type === 'update:complete') {
            return {
              ...s,
              updating: false,
              requiresRestart: Boolean((msg as { requiresRestart?: boolean }).requiresRestart),
            };
          }
          if (msg.type === 'update:log') {
            const m = msg as { pkg: string; line: string };
            const existing = s.perPackage[m.pkg] || { logs: [] };
            return {
              ...s,
              perPackage: {
                ...s.perPackage,
                [m.pkg]: {
                  ...existing,
                  logs: [...(existing.logs || []).slice(-50), m.line],
                },
              },
            };
          }
          // update:progress
          const m = msg as { pkg: string; status: PkgStatus['status']; error?: string; newVersion?: string };
          return {
            ...s,
            perPackage: {
              ...s.perPackage,
              [m.pkg]: {
                ...s.perPackage[m.pkg],
                status: m.status,
                error: m.error,
                newVersion: m.newVersion,
              },
            },
          };
        });
      }
    });
    return () => ws.close();
  }, []);

  // Load current versions on mount
  useEffect(() => {
    api.get<{ current: Record<string, string | null> }>('/updates/status')
      .then((r) => setStatus((s) => ({ ...s, current: r.current })))
      .catch((e) => setStatus((s) => ({ ...s, error: e.message })));
  }, []);

  const check = async () => {
    setStatus((s) => ({ ...s, checking: true, error: undefined }));
    try {
      const r = await api.get<{
        current: Record<string, string | null>;
        latest: Record<string, string | null>;
        hasUpdates: boolean;
      }>('/updates/check');
      setStatus((s) => ({
        ...s,
        checking: false,
        current: r.current,
        latest: r.latest,
        hasUpdates: r.hasUpdates,
      }));
    } catch (err) {
      setStatus((s) => ({ ...s, checking: false, error: (err as Error).message }));
    }
  };

  const applyUpdate = async () => {
    if (!confirm('Update Bizar packages? The dashboard will restart automatically.')) return;
    setStatus((s) => ({
      ...s,
      updating: true,
      requiresRestart: false,
      perPackage: {},
      error: undefined,
    }));
    try {
      await api.post('/updates/apply', { packages: ['bizar', 'bizar-dash', 'bizar-plugin'] });
      // Progress streams via WebSocket
    } catch (err) {
      setStatus((s) => ({ ...s, updating: false, error: (err as Error).message }));
    }
  };

  const restart = async () => {
    if (!confirm('Restart the dashboard? You will be disconnected briefly.')) return;
    try {
      await api.post('/restart');
      toast.info('Restarting…', 3000);
      setTimeout(() => window.location.reload(), 3000);
    } catch {
      toast.error('Restart failed');
    }
  };

  const packages = [
    { id: 'bizar', name: 'Bizar CLI' },
    { id: 'bizar-dash', name: 'Dashboard' },
    { id: 'bizar-plugin', name: 'Opencode Plugin' },
  ];

  const isBusy = status.checking || status.updating;

  return (
    <Card>
      <CardTitle><Download size={14} /> Updates</CardTitle>
      <CardMeta>Check installed Bizar packages and apply dashboard updates.</CardMeta>
      {/* Current versions */}
      <div className="updates-current">
        <h4>Installed versions</h4>
        <ul>
          {packages.map((p) => (
            <li key={p.id}>
              <span>{p.name}</span>
              <code className="mono">{status.current[p.id] || '—'}</code>
            </li>
          ))}
        </ul>
      </div>

      {/* Latest + per-package status */}
      {status.latest && (
        <div className="updates-latest">
          <h4>Latest available</h4>
          <ul>
            {packages.map((p) => {
              const cur = status.current[p.id];
              const lat = status.latest?.[p.id];
              const isOutdated = cur && lat && cur !== lat;
              return (
                <li key={p.id} className={isOutdated ? 'updates-outdated' : 'updates-current-version'}>
                  <span>{p.name}</span>
                  <code className="mono">
                    {lat || '—'}
                    {isOutdated && <span className="updates-badge">update available</span>}
                  </code>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Per-package progress rows (shown while updating) */}
      {status.updating && (
        <div className="updates-progress-rows">
          {packages.map((p) => {
            const pkgStatus = status.perPackage[p.id] || { status: 'idle', logs: [] as string[] };
            return (
              <div key={p.id} className="updates-pkg-row">
                <div className="updates-pkg-row-header">
                  <span className="updates-pkg-name">{p.name}</span>
                  <div className="updates-pkg-status">
                    {pkgStatus.status === 'starting' && <span className="btn-spinner" />}
                    {pkgStatus.status === 'installing' && <span className="btn-spinner" />}
                    {pkgStatus.status === 'done' && <CheckCircle size={14} className="icon-success" />}
                    {pkgStatus.status === 'error' && <AlertCircle size={14} className="icon-error" />}
                    <span>{pkgStatus.status}</span>
                    {pkgStatus.newVersion && (
                      <code className="mono" style={{ fontSize: 11 }}>→ {pkgStatus.newVersion}</code>
                    )}
                  </div>
                </div>
                {pkgStatus.logs.length > 0 && (
                  <details className="updates-pkg-logs">
                    <summary>npm output ({pkgStatus.logs.length} lines)</summary>
                    <pre>{pkgStatus.logs.join('\n')}</pre>
                  </details>
                )}
                {pkgStatus.status === 'error' && pkgStatus.error && (
                  <div className="updates-pkg-error">
                    <AlertTriangle size={12} /> {pkgStatus.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="updates-actions">
        <Button onClick={check} disabled={isBusy}>
          {status.checking ? <span className="btn-spinner" /> : <RefreshCw size={14} />}
          Check for updates
        </Button>
        <Button
          variant="primary"
          onClick={applyUpdate}
          disabled={!status.hasUpdates || status.updating}
        >
          {status.updating ? <span className="btn-spinner" /> : <Download size={14} />}
          {status.updating ? 'Updating…' : (status.hasUpdates ? 'Update now' : 'Up to date')}
        </Button>
        {status.requiresRestart && (
          <Button variant="danger" onClick={restart}>
            <RefreshCw size={14} /> Restart Dashboard
          </Button>
        )}
      </div>

      {status.error && (
        <div className="updates-error">
          <AlertTriangle size={14} />
          <span>{status.error}</span>
        </div>
      )}
    </Card>
  );
}

export function SettingsView({ settings: initial, refreshSnapshot }: Props) {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tailscale, setTailscale] = useState<TailscaleStatus | null>(null);
  const [tailscaleDraft, setTailscaleDraft] = useState({ port: 4321, https: true, hostname: '' });
  const [pluginOptions, setPluginOptions] = useState<Record<string, number>>({});

  useEffect(() => {
    setSettings(initial);
    setDirty(false);
    if (initial.theme) applyThemeTokens(initial.theme);
  }, [initial]);

  useEffect(() => {
    if (!tailscale) return;
    setTailscaleDraft({
      port: tailscale.settings.port,
      https: tailscale.settings.https !== false,
      hostname: tailscale.settings.hostname || '',
    });
  }, [tailscale]);

  useEffect(() => {
    api.get<TailscaleStatus>('/tailscale/status').then(setTailscale).catch(() => undefined);
  }, []);

  useEffect(() => {
    api.get<Record<string, number>>('/settings/plugin-options')
      .then(setPluginOptions)
      .catch(() => { /* not persisted yet — use defaults */ });
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

  const patchNotifications = (patch: Partial<Settings['notifications']>) => {
    setSettings((cur) => ({ ...cur, notifications: { ...cur.notifications, ...patch } }));
    setDirty(true);
  };

  const patchAgents = (patch: Partial<Settings['agents']>) => {
    setSettings((cur) => ({ ...cur, agents: { ...cur.agents, ...patch } }));
    setDirty(true);
  };

  const patchDashboard = (patch: Partial<Settings['dashboard']>) => {
    setSettings((cur) => ({ ...cur, dashboard: { ...cur.dashboard, ...patch } }));
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
          port: tailscaleDraft.port || 4321,
          https: tailscaleDraft.https,
          hostname: tailscaleDraft.hostname || '',
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
    version: '3.0.4',
    homepage: 'https://github.com/DrB0rk/BizarHarness',
    license: 'MIT',
  };

  // v3.6.0 — Auth token UI state. The Settings tab is the only place
  // the operator can read the token back out. We default the input
  // to whatever's already in localStorage so a page reload doesn't
  // wipe the entry.
  const [authToken, setAuthToken] = useState<string>(api.getToken());
  const [authStatus, setAuthStatus] = useState<{ required: boolean; loopback: boolean; peer: string } | null>(null);
  const [revealedToken, setRevealedToken] = useState<string>('');

  // Probe the server once on mount so we can show "auth required" vs
  // "auth off" in the UI. If /api/auth/status itself 401s, the token
  // we're using is bad — surface that distinctly.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.probeAuthStatus();
        if (!cancelled) setAuthStatus(r);
      } catch {
        if (!cancelled) {
          setAuthStatus({ required: true, loopback: false, peer: '' });
          // Don't toast — the toast spam would be annoying on every
          // Settings tab open. The Copy/Regenerate buttons themselves
          // surface the real error if it happens there.
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onCopyToken = async () => {
    try {
      const r = await api.get<{ token: string }>('/auth/reveal');
      setRevealedToken(r.token);
      setAuthToken(r.token);
      api.setToken(r.token);
      try {
        await navigator.clipboard.writeText(r.token);
        toast.success('Token copied to clipboard.');
      } catch {
        toast.success('Token revealed — copy from the field below.');
      }
    } catch (err) {
      toast.error(`Reveal failed: ${(err as Error).message}`);
    }
  };

  const onRegenerateToken = async () => {
    if (!confirm('Regenerate the auth token? Anything still using the old token will start getting 401 errors immediately.')) {
      return;
    }
    try {
      const r = await api.post<{ token: string }>('/auth/regenerate');
      setRevealedToken(r.token);
      setAuthToken(r.token);
      api.setToken(r.token);
      try {
        await navigator.clipboard.writeText(r.token);
        toast.success('New token generated and copied to clipboard.');
      } catch {
        toast.success('New token generated — copy from the field below. Old token is now invalid.');
      }
    } catch (err) {
      toast.error(`Regenerate failed: ${(err as Error).message}`);
    }
  };

  const onSaveToken = () => {
    api.setToken(authToken.trim());
    toast.success('Token saved. The dashboard will use it on the next request.');
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

          {/* v3.3.1 — Accent color presets */}
          <div className="field" data-setting-id="theme.presets">
            <label className="field-label">Accent presets</label>
            <div className="theme-presets">
              {PRESET_THEMES.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className={cn(
                    'theme-preset',
                    settings.theme.accent === t.accent && 'theme-preset-active',
                  )}
                  onClick={() => patchTheme({ accent: t.accent })}
                  title={t.name}
                >
                  <span
                    className="theme-preset-swatch"
                    style={{ background: t.accent }}
                  />
                  <span className="theme-preset-name">{t.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field" data-setting-id="theme.mode">
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
            <div className="field" data-setting-id="theme.accent">
              <label className="field-label">Accent</label>
              <div className="color-row">
                <input
                  type="color"
                  className="input color-input"
                  value={settings.theme.accent}
                  onChange={(e) => patchTheme({ accent: e.target.value })}
                  aria-label="Accent color"
                />
                <input
                  type="text"
                  className="input"
                  value={settings.theme.accent}
                  onChange={(e) => patchTheme({ accent: e.target.value })}
                />
              </div>
            </div>
            <div className="field" data-setting-id="theme.success">
              <label className="field-label">Success</label>
              <div className="color-row">
                <input
                  type="color"
                  className="input color-input"
                  value={settings.theme.success}
                  onChange={(e) => patchTheme({ success: e.target.value })}
                  aria-label="Success color"
                />
                <input
                  type="text"
                  className="input"
                  value={settings.theme.success}
                  onChange={(e) => patchTheme({ success: e.target.value })}
                />
              </div>
            </div>
            <div className="field" data-setting-id="theme.warning">
              <label className="field-label">Warning</label>
              <div className="color-row">
                <input
                  type="color"
                  className="input color-input"
                  value={settings.theme.warning}
                  onChange={(e) => patchTheme({ warning: e.target.value })}
                  aria-label="Warning color"
                />
                <input
                  type="text"
                  className="input"
                  value={settings.theme.warning}
                  onChange={(e) => patchTheme({ warning: e.target.value })}
                />
              </div>
            </div>
            <div className="field" data-setting-id="theme.error">
              <label className="field-label">Error</label>
              <div className="color-row">
                <input
                  type="color"
                  className="input color-input"
                  value={settings.theme.error}
                  onChange={(e) => patchTheme({ error: e.target.value })}
                  aria-label="Error color"
                />
                <input
                  type="text"
                  className="input"
                  value={settings.theme.error}
                  onChange={(e) => patchTheme({ error: e.target.value })}
                />
              </div>
            </div>
            <div className="field" data-setting-id="theme.info">
              <label className="field-label">Info</label>
              <div className="color-row">
                <input
                  type="color"
                  className="input color-input"
                  value={settings.theme.info}
                  onChange={(e) => patchTheme({ info: e.target.value })}
                  aria-label="Info color"
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

          <div className="field" data-setting-id="theme.fontFamily">
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
          <div className="field" data-setting-id="theme.fontSize">
            <label className="field-label">Font size: {settings.theme.fontSize}px</label>
            <input
              type="range"
              min={12}
              max={20}
              value={settings.theme.fontSize}
              onChange={(e) => patchTheme({ fontSize: Number(e.target.value) })}
            />
          </div>
          <label className="checkbox-row" data-setting-id="theme.compactMode">
            <input
              type="checkbox"
              checked={settings.theme.compactMode}
              onChange={(e) => patchTheme({ compactMode: e.target.checked })}
            />
            <span>Compact mode (denser UI)</span>
          </label>
          <label className="checkbox-row" data-setting-id="theme.animations">
            <input
              type="checkbox"
              checked={settings.theme.animations}
              onChange={(e) => patchTheme({ animations: e.target.checked })}
            />
            <span>Enable animations</span>
          </label>
        </Card>

        <UpdatesCard />

        <Card>
          <CardTitle><LayoutIcon size={14} /> UI layout</CardTitle>
          <CardMeta>Choose how the dashboard's navigation is presented.</CardMeta>
          <div className="layout-row" data-setting-id="ui.layout">
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
          <label className="checkbox-row" data-setting-id="ui.showHeader">
            <input
              type="checkbox"
              checked={settings.ui.showHeader}
              onChange={(e) => patchUi({ showHeader: e.target.checked })}
            />
            <span>Show header</span>
          </label>
          <label className="checkbox-row" data-setting-id="ui.showStatusBar">
            <input
              type="checkbox"
              checked={settings.ui.showStatusBar}
              onChange={(e) => patchUi({ showStatusBar: e.target.checked })}
            />
            <span>Show status bar</span>
          </label>
          <div className="field" data-setting-id="ui.defaultTab">
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
          <div className="field" data-setting-id="defaultAgent">
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
          <div className="field" data-setting-id="defaultModel">
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
          <div data-setting-id="service.enabled">
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
          </div>
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
                    value={tailscaleDraft.port}
                    onChange={(e) => setTailscaleDraft((cur) => ({ ...cur, port: Number(e.target.value) || 4321 }))}
                  />
                </div>
                <div className="task-form-field">
                  <label className="field-label">Use HTTPS</label>
                  <input
                    type="checkbox"
                    checked={tailscaleDraft.https}
                    onChange={(e) => setTailscaleDraft((cur) => ({ ...cur, https: e.target.checked }))}
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
          <label className="checkbox-row" data-setting-id="notifications.onAgentComplete">
            <input
              type="checkbox"
              checked={!!settings.notifications.onAgentComplete}
              onChange={(e) => patchNotifications({ onAgentComplete: e.target.checked })}
            />
            <span>Notify when an agent invocation completes</span>
          </label>
          <label className="checkbox-row" data-setting-id="notifications.onPlanApproval">
            <input
              type="checkbox"
              checked={!!settings.notifications.onPlanApproval}
              onChange={(e) => patchNotifications({ onPlanApproval: e.target.checked })}
            />
            <span>Notify when a plan needs approval</span>
          </label>
        </Card>

        {/* v3.6.0 — Auth token management. The Settings tab is the
            only place a human can read the token. The input + Save
            button lets the operator paste a token they got from
            server stderr or from another machine. Copy / Regenerate
            buttons act via the authed /api/auth/* endpoints. */}
        <Card>
          <CardTitle><Shield size={14} /> Authentication</CardTitle>
          <CardMeta>
            Localhost and Tailscale browser access are auto-trusted via loopback.
            A bearer token is still available for non-loopback clients and
            forced-auth mode.
          </CardMeta>
          <div className="field" data-setting-id="auth.status">
            <label className="field-label">Server status</label>
            <p style={{ margin: '4px 0' }}>
              Auth required:{' '}
              <strong>{authStatus ? (authStatus.required ? 'yes' : 'no') : 'probing…'}</strong>
            </p>
            <p style={{ margin: '4px 0' }}>
              Connection:{' '}
              <strong>
                {authStatus
                  ? (authStatus.loopback ? 'loopback (auto-trusted)' : 'remote')
                  : 'probing…'}
              </strong>
            </p>
            <p style={{ margin: '4px 0' }}>
              Peer address:{' '}
              {authStatus?.peer ? <code>{authStatus.peer}</code> : <span className="muted">probing…</span>}
            </p>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
              Localhost and Tailscale browser access are auto-trusted because the
              dashboard sees a loopback peer. Paste a token only for non-loopback
              API clients/scripts, or if you force auth for every connection with{' '}
              <code>BIZAR_DASHBOARD_REQUIRE_AUTH=1</code>.
            </p>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
              Dashboard tokens are generated on first boot and saved to{' '}
              <code>~/.config/bizar/dashboard-secret</code> (mode 0600).
            </p>
          </div>
          <div className="field" data-setting-id="auth.token">
            <label className="field-label">Token (this browser)</label>
            <input
              type="password"
              className="input mono"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="Paste token from server stderr or another browser"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="task-form-row" style={{ marginTop: 8 }}>
              <Button variant="secondary" size="sm" onClick={onSaveToken}>
                <KeyRound size={14} /> Save token
              </Button>
              <Button variant="ghost" size="sm" onClick={onCopyToken}>
                <Copy size={14} /> Reveal &amp; copy server token
              </Button>
              <Button variant="ghost" size="sm" onClick={onRegenerateToken}>
                <RotateCcw size={14} /> Regenerate
              </Button>
            </div>
            {revealedToken ? (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Last revealed token (one-time): <code className="mono">{revealedToken}</code>
              </p>
            ) : null}
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Regenerating invalidates the current token immediately. Anything
              still using the old token will see 401 until it's updated.
            </p>
          </div>
        </Card>

        <Card>
          <CardTitle><ServerIcon size={14} /> Agent Behavior</CardTitle>
          <CardMeta>Limits and timeouts for background agent dispatch.</CardMeta>
          <div className="form-row">
            <label htmlFor="agents-maxParallel">
              Max parallel agents
              <span className="meta-badge">default: 6</span>
            </label>
            <input
              id="agents-maxParallel"
              type="number"
              min={1}
              max={20}
              value={settings.agents?.maxParallel ?? 6}
              onChange={(e) => patchAgents({ maxParallel: Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 6)) })}
            />
          </div>
          <div className="form-row">
            <label htmlFor="agents-stuckThresholdMs">
              Stuck threshold (ms)
              <span className="meta-badge">default: 600000 (10 min)</span>
            </label>
            <input
              id="agents-stuckThresholdMs"
              type="number"
              min={60000}
              max={3600000}
              step={60000}
              value={settings.agents?.stuckThresholdMs ?? 600000}
              onChange={(e) => patchAgents({ stuckThresholdMs: Math.max(60000, Math.min(3600000, parseInt(e.target.value, 10) || 600000)) })}
            />
          </div>
          <label className="checkbox-row" data-setting-id="agents.autoRestart">
            <input
              type="checkbox"
              checked={!!settings.agents?.autoRestart}
              onChange={(e) => patchAgents({ autoRestart: e.target.checked })}
            />
            <span>Auto-restart stuck agents</span>
          </label>
        </Card>

        <Card>
          <CardTitle><Globe size={14} /> Dashboard</CardTitle>
          <CardMeta>Controls how <code>bizar</code> starts up.</CardMeta>
          <label className="checkbox-row" data-setting-id="dashboard.autoLaunchWeb">
            <input
              type="checkbox"
              checked={settings.dashboard.autoLaunchWeb !== false}
              onChange={(e) => patchDashboard({ autoLaunchWeb: e.target.checked })}
            />
            <span>Auto-launch web UI alongside TUI</span>
          </label>

          <div className="field" data-setting-id="dashboard.projectsDirectory" style={{ marginTop: 'var(--space-4)' }}>
            <label className="field-label" htmlFor="set-projects-directory">Projects directory</label>
            <input
              id="set-projects-directory"
              className="input"
              type="text"
              placeholder="/home/user/projects"
              value={settings.dashboard.projectsDirectory ?? ''}
              onChange={(e) => patchDashboard({ projectsDirectory: e.target.value })}
            />
            <p className="field-help">
              New projects created via the dashboard will land here, and existing project
              directories inside this folder are auto-recognized on startup.
            </p>
            {settings.dashboard.projectsDirectory && (
              <>
                {!/^\/|^[A-Za-z]:/.test(settings.dashboard.projectsDirectory) && (
                  <p style={{ color: 'var(--warning)', fontSize: 11, marginTop: 4 }}>
                    Path should be absolute (start with / on Linux/Mac, or a drive letter on Windows).
                  </p>
                )}
                {settings.dashboard.projectsDirectory.includes('..') && (
                  <p style={{ color: 'var(--error)', fontSize: 11, marginTop: 4 }}>
                    Path traversal not allowed — this will be rejected server-side.
                  </p>
                )}
              </>
            )}
          </div>

          {/* allowedRoots textarea */}
          <div className="field" data-setting-id="dashboard.allowedRoots" style={{ marginTop: 'var(--space-4)' }}>
            <label className="field-label" htmlFor="set-allowed-roots">
              Additional allowed roots <span className="muted">(advanced)</span>
            </label>
            <textarea
              id="set-allowed-roots"
              className="textarea"
              rows={4}
              placeholder="/workspace&#10;/srv/projects"
              value={(settings.dashboard.allowedRoots ?? []).join('\n')}
              onChange={(e) => {
                const lines = e.target.value
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean);
                patchDashboard({ allowedRoots: lines });
              }}
            />
            <p className="field-help">
              Optional. Add filesystem roots beyond your home directory that the file
              browser and project scanner can access. Each path must be inside your
              home directory. One per line.
            </p>
            {(() => {
              const rawLines = (settings.dashboard.allowedRoots ?? []).join('\n').split('\n');
              const warnings: { key: string; msg: React.ReactNode }[] = [];
              rawLines.forEach((line, i) => {
                if (!line.trim()) return;
                if (!/^\/|^[A-Za-z]:/.test(line)) {
                  warnings.push({
                    key: `noabs-${i}`,
                    msg: (
                      <p style={{ color: 'var(--warning)', fontSize: 11, marginTop: 2 }}>
                        Line {i + 1}: "{line}" — should be absolute (start with / or a drive letter).
                      </p>
                    ),
                  });
                }
                if (line.includes('..')) {
                  warnings.push({
                    key: `dots-${i}`,
                    msg: (
                      <p style={{ color: 'var(--error)', fontSize: 11, marginTop: 2 }}>
                        Line {i + 1}: "{line}" — contains '..' (server will reject this).
                      </p>
                    ),
                  });
                }
              });
              return warnings.map((w) => w.msg);
            })()}
          </div>
        </Card>

        <Card>
          <CardTitle><ServerIcon size={14} /> Background Agents</CardTitle>
          <CardMeta>Tune plugin options. Changes take effect on next plugin restart.</CardMeta>

          <div className="form-row">
            <label htmlFor="bg-maxConcurrent">
              Max concurrent instances
              <span className="meta-badge">default: 8</span>
            </label>
            <input
              id="bg-maxConcurrent"
              type="number"
              min={1}
              max={32}
              value={pluginOptions.maxConcurrentInstances ?? 8}
              onChange={(e) => setPluginOptions((cur) => ({ ...cur, maxConcurrentInstances: Math.max(1, Math.min(32, parseInt(e.target.value, 10) || 8)) }))}
            />
            <small className="muted">Plugin option: <code>maxConcurrentInstances</code></small>
          </div>

          <div className="form-row">
            <label htmlFor="bg-toolCallCap">
              Tool-call cap
              <span className="meta-badge">default: 500</span>
            </label>
            <input
              id="bg-toolCallCap"
              type="number"
              min={1}
              max={5000}
              value={pluginOptions.backgroundToolCallCap ?? 500}
              onChange={(e) => setPluginOptions((cur) => ({ ...cur, backgroundToolCallCap: Math.max(1, Math.min(5000, parseInt(e.target.value, 10) || 500)) }))}
            />
            <small className="muted">Plugin option: <code>backgroundToolCallCap</code></small>
          </div>

          <div className="form-row">
            <label htmlFor="bg-stallTimeout">
              Stall timeout (ms)
              <span className="meta-badge">default: 180000</span>
            </label>
            <input
              id="bg-stallTimeout"
              type="number"
              min={10000}
              max={600000}
              step={1000}
              value={pluginOptions.backgroundStallTimeoutMs ?? 180000}
              onChange={(e) => setPluginOptions((cur) => ({ ...cur, backgroundStallTimeoutMs: Math.max(10000, Math.min(600000, parseInt(e.target.value, 10) || 180000)) }))}
            />
            <small className="muted">Plugin option: <code>backgroundStallTimeoutMs</code></small>
          </div>

          <div className="form-row">
            <label htmlFor="bg-thinkingLoopTimeout">
              Thinking-loop timeout (ms)
              <span className="meta-badge">default: 300000</span>
            </label>
            <input
              id="bg-thinkingLoopTimeout"
              type="number"
              min={30000}
              max={900000}
              step={1000}
              value={pluginOptions.backgroundThinkingLoopTimeoutMs ?? 300000}
              onChange={(e) => setPluginOptions((cur) => ({ ...cur, backgroundThinkingLoopTimeoutMs: Math.max(30000, Math.min(900000, parseInt(e.target.value, 10) || 300000)) }))}
            />
            <small className="muted">Plugin option: <code>backgroundThinkingLoopTimeoutMs</code></small>
          </div>

          <div className="form-row">
            <label htmlFor="bg-maxInterventions">
              Max interventions
              <span className="meta-badge">default: 1</span>
            </label>
            <input
              id="bg-maxInterventions"
              type="number"
              min={1}
              max={3}
              value={pluginOptions.backgroundMaxInterventions ?? 1}
              onChange={(e) => setPluginOptions((cur) => ({ ...cur, backgroundMaxInterventions: Math.max(1, Math.min(3, parseInt(e.target.value, 10) || 1)) }))}
            />
            <small className="muted">Plugin option: <code>backgroundMaxInterventions</code></small>
          </div>

          <div className="form-row">
            <Button variant="secondary" size="sm" onClick={async () => {
              try {
                await api.put('/settings/plugin-options', pluginOptions);
                toast.success('Saved — restart opencode for changes to take effect.');
              } catch (err) {
                toast.error(`Save failed: ${(err as Error).message}`);
              }
            }}>
              <Save size={14} /> Save plugin options
            </Button>

            <Button variant="secondary" size="sm" onClick={async () => {
              try {
                const r = await fetch('/api/background/cleanup', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ maxAgeDays: 7 }),
                });
                const result = await r.json();
                toast.success(`Cleaned up ${result.deleted} old instances.`);
              } catch (err) {
                toast.error(`Cleanup failed: ${(err as Error).message}`);
              }
            }}>
              Cleanup old instances (&gt;7 days)
            </Button>
          </div>

          <div className="form-row">
            <small>Plugin options are read at startup. Save changes and run <code>bizar update</code> to apply.</small>
          </div>
        </Card>
      </div>

      <PairDeviceCard />

      <ActivityLogCard />

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

/**
 * v3.15.0 — Full activity log + hidden set management.
 *
 * Two sources of truth:
 *   - GET /activity — the full unfiltered log (incl. hidden entries)
 *   - GET /activity/hidden — the list of keys the user chose to hide
 *
 * Hiding is non-destructive: hidden items still appear here so the
 * user can review / restore them.
 */
function ActivityLogCard() {
  const toast = useToast();
  const [items, setItems] = useState<Array<{ kind?: string; ts?: string; slug?: string; message?: string }>>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [log, hid] = await Promise.all([
        api.get<{ items: Array<{ kind?: string; ts?: string; slug?: string; message?: string }> }>('/activity'),
        api.get<{ hidden: string[] }>('/activity/hidden'),
      ]);
      setItems(Array.isArray(log.items) ? log.items : []);
      setHidden(new Set(hid.hidden || []));
    } catch (err) {
      toast.error(`Load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const keyOf = (it: { kind?: string; ts?: string; slug?: string }, idx: number) => {
    const k = `${it.kind || ''}|${it.ts || ''}|${it.slug || ''}|${idx}`;
    let h = 0;
    for (let i = 0; i < k.length; i++) h = ((h << 5) - h + k.charCodeAt(i)) | 0;
    return Math.abs(h).toString(16).padStart(8, '0').slice(0, 16);
  };

  const onRestoreAll = async () => {
    try {
      await api.del('/activity/hide');
      setHidden(new Set());
      toast.success('All hidden activity restored.');
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`);
    }
  };

  const onRestoreOne = async (key: string) => {
    try {
      await api.del(`/activity/hide/${encodeURIComponent(key)}`);
      const next = new Set(hidden);
      next.delete(key);
      setHidden(next);
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`);
    }
  };

  const filtered = items.filter((it, idx) => {
    const k = keyOf(it, idx);
    if (!showHidden && hidden.has(k)) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return [it.kind, it.slug, it.message].some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
  });

  return (
    <Card>
      <CardTitle>
        <Activity size={14} /> Activity log
        <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
          {items.length} total · {hidden.size} hidden
        </span>
        <Button variant="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={refresh} title="Reload">
          <RefreshCw size={12} />
        </Button>
      </CardTitle>
      <CardMeta>
        Full history from <code>~/.bizar/activity.log</code>. Hiding an item in the Overview only hides it there — the entry stays here.
      </CardMeta>

      <div className="activity-log-toolbar">
        <div className="activity-log-search">
          <Search size={12} />
          <input
            type="text"
            className="input"
            placeholder="Filter by kind, slug, or message…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <label className="activity-log-toggle">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Show hidden
        </label>
        <Button
          variant="ghost"
          size="sm"
          disabled={hidden.size === 0}
          onClick={onRestoreAll}
          title="Restore all hidden items to the Overview"
        >
          <Eye size={12} /> Restore all
        </Button>
      </div>

      {loading ? (
        <div className="muted" style={{ padding: '12px 0', fontSize: 12 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="muted" style={{ padding: '12px 0', fontSize: 12 }}>
          {items.length === 0 ? 'No activity yet.' : 'No items match the current filter.'}
        </div>
      ) : (
        <div className="activity-log-table-wrap">
          <table className="activity-log-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Detail</th>
                <th>Time</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((it, idx) => {
                const k = keyOf(it, idx);
                const isHidden = hidden.has(k);
                return (
                  <tr key={`${it.ts}-${idx}`} className={cn(isHidden && 'activity-log-row-hidden')}>
                    <td className="activity-log-kind">{it.kind || 'activity'}</td>
                    <td className="activity-log-detail">
                      {it.message || it.slug || '—'}
                    </td>
                    <td className="activity-log-time mono">
                      {it.ts ? new Date(it.ts).toLocaleString() : '—'}
                    </td>
                    <td>
                      {isHidden ? (
                        <Button variant="ghost" size="sm" onClick={() => onRestoreOne(k)} title="Restore to Overview">
                          <Eye size={12} />
                        </Button>
                      ) : (
                        <span className="activity-log-state-tag">shown</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > 200 && (
            <div className="muted" style={{ fontSize: 11, padding: '8px 0' }}>
              Showing first 200 of {filtered.length}.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
