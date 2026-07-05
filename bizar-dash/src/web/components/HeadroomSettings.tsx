// src/web/components/HeadroomSettings.tsx
//
// v1.0.0 — Headroom settings card for the Settings view.
// Displays live status and provides controls for install, wrap, proxy, and configuration.
import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  CheckCircle,
  XCircle,
  Download,
  Play,
  Square,
  RefreshCw,
  ExternalLink,
  Zap,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { type HeadroomSettings } from '../lib/types';

type HeadroomStatus = {
  installed: boolean;
  version: string | null;
  proxyRunning: boolean;
  proxyPort: number | null;
  proxyPid: number | null;
  wrapped: boolean;
  healthy: 'ok' | 'warn' | 'fail';
  messages: string[];
};

type HeadroomStats = {
  tokensSaved?: number;
  compressionRatio?: number;
  cacheHits?: number;
  transforms?: number;
  error?: string;
};

const BACKEND_OPTIONS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'anyllm', label: 'AnyLLM' },
  { value: 'litellm-anthropic', label: 'LiteLLM (Anthropic)' },
  { value: 'litellm-openai', label: 'LiteLLM (OpenAI)' },
];

type Props = {
  settings: HeadroomSettings;
  onPatch: (patch: Partial<HeadroomSettings>) => void;
};

export function HeadroomSettingsCard({ settings, onPatch }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<HeadroomStatus | null>(null);
  const [stats, setStats] = useState<HeadroomStats | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [wrapping, setWrapping] = useState(false);
  const [unwrapping, setUnwrapping] = useState(false);
  const [startingProxy, setStartingProxy] = useState(false);
  const [stoppingProxy, setStoppingProxy] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const [s, st] = await Promise.all([
        api.get<HeadroomStatus>('/headroom/status'),
        api.get<HeadroomStats>('/headroom/stats?hours=24').catch(() => ({ error: 'no stats' })),
      ]);
      setStatus(s);
      if (!st.error) setStats(st);
    } catch (err) {
      toast.error(`Failed to load Headroom status: ${(err as Error).message}`);
    } finally {
      setLoadingStatus(false);
    }
  }, [toast]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const r = await api.post<{ ok: boolean; installed: boolean; method: string }>('/headroom/install', { force: true });
      if (r.installed) {
        toast.success(`Headroom installed via ${r.method}.`);
        await loadStatus();
      } else {
        toast.error('Headroom install failed. Try: pip install "headroom-ai[all]"');
      }
    } catch (err) {
      toast.error(`Install failed: ${(err as Error).message}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleWrap = async () => {
    setWrapping(true);
    try {
      const r = await api.post<{ ok: boolean }>('/headroom/wrap', { port: settings.port });
      if (r.ok) {
        toast.success('opencode wrapped with Headroom.');
        await loadStatus();
      } else {
        toast.error('Wrap failed.');
      }
    } catch (err) {
      toast.error(`Wrap failed: ${(err as Error).message}`);
    } finally {
      setWrapping(false);
    }
  };

  const handleUnwrap = async () => {
    setUnwrapping(true);
    try {
      const r = await api.post<{ ok: boolean }>('/headroom/unwrap');
      if (r.ok) {
        toast.success('opencode unwrapped from Headroom.');
        await loadStatus();
      } else {
        toast.error('Unwrap failed.');
      }
    } catch (err) {
      toast.error(`Unwrap failed: ${(err as Error).message}`);
    } finally {
      setUnwrapping(false);
    }
  };

  const handleStartProxy = async () => {
    setStartingProxy(true);
    try {
      const r = await api.post<{ ok: boolean }>('/headroom/proxy/start', {
        port: settings.port,
        host: settings.host,
      });
      if (r.ok) {
        toast.success(`Headroom proxy started on ${settings.host}:${settings.port}.`);
        await loadStatus();
      } else {
        toast.error('Proxy start failed.');
      }
    } catch (err) {
      toast.error(`Proxy start failed: ${(err as Error).message}`);
    } finally {
      setStartingProxy(false);
    }
  };

  const handleStopProxy = async () => {
    setStoppingProxy(true);
    try {
      const r = await api.post<{ ok: boolean }>('/headroom/proxy/stop');
      if (r.ok) {
        toast.success('Headroom proxy stopped.');
        await loadStatus();
      } else {
        toast.error('Proxy stop failed.');
      }
    } catch (err) {
      toast.error(`Proxy stop failed: ${(err as Error).message}`);
    } finally {
      setStoppingProxy(false);
    }
  };

  const handleOpenDashboard = async () => {
    try {
      const { spawn } = await import('node:child_process');
      spawn('headroom', ['dashboard'], { detached: true, stdio: 'ignore' });
    } catch {
      toast.error('Could not open Headroom dashboard. Run `headroom dashboard` manually.');
    }
  };

  const { installed, version, proxyRunning, proxyPort, wrapped } = status || {};
  const ratio = stats?.compressionRatio ?? 0;
  const saved = stats?.tokensSaved ?? 0;

  return (
    <div id="settings-headroom" data-section="headroom">
      <Card>
        <CardTitle>
          <Activity size={14} style={{ color: proxyRunning ? 'var(--success)' : 'var(--text-dim)' }} />
          Headroom
          {installed && version && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 6 }}>
              v{version} {proxyRunning ? '✓' : '✗'}
            </span>
          )}
          {!installed && (
            <span style={{ fontSize: 11, color: 'var(--error)', marginLeft: 6 }}>not installed</span>
          )}
        </CardTitle>
        <CardMeta>
          Context compression for token efficiency. Compresses tool outputs, logs, and conversation
          history by 60–95% before they reach the model.
        </CardMeta>

        {/* Live status row */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, marginBottom: 12 }}>
          <div className="headroom-status-item">
            {installed ? (
              <CheckCircle size={12} style={{ color: 'var(--success)' }} />
            ) : (
              <XCircle size={12} style={{ color: 'var(--error)' }} />
            )}
            <span>{installed ? 'Installed' : 'Not installed'}</span>
          </div>
          <div className="headroom-status-item">
            {proxyRunning ? (
              <CheckCircle size={12} style={{ color: 'var(--success)' }} />
            ) : (
              <XCircle size={12} style={{ color: 'var(--text-dim)' }} />
            )}
            <span>Proxy {proxyRunning ? `${proxyPort} ✓` : 'stopped'}</span>
          </div>
          <div className="headroom-status-item">
            {wrapped ? (
              <CheckCircle size={12} style={{ color: 'var(--success)' }} />
            ) : (
              <XCircle size={12} style={{ color: 'var(--text-dim)' }} />
            )}
            <span>opencode {wrapped ? 'wrapped' : 'not wrapped'}</span>
          </div>
        </div>

        {/* Stats */}
        {(saved > 0 || ratio > 0) && (
          <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--success)' }}>
                {ratio > 0 ? `${Math.round(ratio * 100)}%` : '—'}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>Compression ratio</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>
                {saved > 0 ? saved.toLocaleString() : '—'}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>Tokens saved (24h)</div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {!installed ? (
            <Button variant="primary" size="sm" onClick={handleInstall} disabled={installing}>
              {installing ? <span className="btn-spinner" /> : <Download size={13} />}
              {installing ? 'Installing…' : 'Install Headroom'}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleWrap}
                disabled={wrapping || wrapped}
                title={wrapped ? 'opencode is already wrapped' : 'Wrap opencode to route through Headroom proxy'}
              >
                {wrapping ? <span className="btn-spinner" /> : <Zap size={13} />}
                {wrapping ? 'Wrapping…' : wrapped ? 'Wrapped ✓' : 'Wrap opencode'}
              </Button>
              {wrapped && (
                <Button variant="ghost" size="sm" onClick={handleUnwrap} disabled={unwrapping}>
                  {unwrapping ? <span className="btn-spinner" /> : <RefreshCw size={13} />}
                  {unwrapping ? 'Unwrapping…' : 'Unwrap'}
                </Button>
              )}
            </>
          )}

          {installed && (
            <>
              {proxyRunning ? (
                <Button variant="secondary" size="sm" onClick={handleStopProxy} disabled={stoppingProxy}>
                  {stoppingProxy ? <span className="btn-spinner" /> : <Square size={13} />}
                  {stoppingProxy ? 'Stopping…' : 'Stop proxy'}
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={handleStartProxy} disabled={startingProxy}>
                  {startingProxy ? <span className="btn-spinner" /> : <Play size={13} />}
                  {startingProxy ? 'Starting…' : 'Start proxy'}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleOpenDashboard}>
                <ExternalLink size={13} />
                Dashboard
              </Button>
            </>
          )}

          <Button variant="ghost" size="sm" onClick={loadStatus} disabled={loadingStatus}>
            <RefreshCw size={13} className={loadingStatus ? 'spin' : ''} />
          </Button>
        </div>

        {/* Settings */}
        <div style={{ marginTop: 16 }}>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => onPatch({ enabled: e.target.checked })}
            />
            <span>Enable Headroom</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.autoInstall}
              onChange={(e) => onPatch({ autoInstall: e.target.checked })}
            />
            <span>Auto-install if missing on dashboard startup</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.autoStart}
              onChange={(e) => onPatch({ autoStart: e.target.checked })}
            />
            <span>Auto-start proxy on dashboard startup</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.autoWrap}
              onChange={(e) => onPatch({ autoWrap: e.target.checked })}
            />
            <span>Auto-wrap opencode on dashboard startup</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.routeAllProviders}
              onChange={(e) => onPatch({ routeAllProviders: e.target.checked })}
            />
            <span>Route all providers through Headroom proxy</span>
          </label>

          <div className="task-form-row" style={{ marginTop: 12 }}>
            <div className="task-form-field">
              <label className="field-label">Proxy port</label>
              <input
                type="number"
                className="input"
                value={settings.port}
                min={1}
                max={65535}
                onChange={(e) => onPatch({ port: Math.max(1, Math.min(65535, parseInt(e.target.value, 10) || 8787)) })}
              />
            </div>
            <div className="task-form-field">
              <label className="field-label">Proxy host</label>
              <input
                type="text"
                className="input"
                value={settings.host}
                onChange={(e) => onPatch({ host: e.target.value })}
              />
            </div>
          </div>

          <div className="task-form-row">
            <div className="task-form-field">
              <label className="field-label">Backend</label>
              <select
                className="select"
                value={settings.backend}
                onChange={(e) => onPatch({ backend: e.target.value })}
              >
                {BACKEND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="task-form-field">
              <label className="field-label">Monthly budget (USD)</label>
              <input
                type="number"
                className="input"
                value={settings.budget}
                min={0}
                step={1}
                onChange={(e) => onPatch({ budget: Math.max(0, parseFloat(e.target.value) || 0) })}
              />
              <span className="field-help">0 = unlimited</span>
            </div>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.outputShaper}
              onChange={(e) => onPatch({ outputShaper: e.target.checked })}
            />
            <span>Enable output shaper</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.telemetry}
              onChange={(e) => onPatch({ telemetry: e.target.checked })}
            />
            <span>Enable telemetry</span>
          </label>
        </div>
      </Card>
    </div>
  );
}
