// src/web/components/TailscaleSettings.tsx
//
// v5.2 — Tailscale auth key integration UI.
//
// Allows users to authenticate with Tailscale using an auth key and
// set up tailscale serve for the dashboard without using the CLI.
import React, { useEffect, useState } from 'react';
import { CheckCircle, Link as LinkIcon, Plug } from 'lucide-react';
import { Card, CardTitle, CardMeta } from './Card';
import { Button } from './Button';
import { api } from '../lib/api';
import type { TailscaleStatus } from '../lib/types';

type Props = {
  /** Existing tailscale status from Settings-level fetch. If provided, used as initial value. */
  initialStatus?: TailscaleStatus | null;
};

export function TailscaleSettings({ initialStatus }: Props) {
  const [status, setStatus] = useState<TailscaleStatus | null>(initialStatus ?? null);
  const [authKey, setAuthKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === null) {
      api.get<TailscaleStatus>('/tailscale/status')
        .then((r) => setStatus(r))
        .catch(() => setStatus(null));
    }
  }, []);

  const loadStatus = async () => {
    try {
      const r = await api.get<TailscaleStatus>('/tailscale/status');
      setStatus(r);
    } catch {
      setError('Failed to load Tailscale status');
    }
  };

  const handleAuthenticate = async () => {
    if (!authKey.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.post('/tailscale/setup', { authKey: authKey.trim() });
      await loadStatus();
      setAuthKey('');
    } catch (err) {
      setError((err as Error).message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupServe = async () => {
    if (!status) return;
    setLoading(true);
    setError(null);
    try {
      await api.post('/tailscale/setup', {
        port: status.settings?.port || 4321,
        https: status.settings?.https !== false,
        hostname: status.settings?.hostname || '',
      });
      await loadStatus();
    } catch (err) {
      setError((err as Error).message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveServe = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/tailscale/unserve');
      await loadStatus();
    } catch (err) {
      setError((err as Error).message || 'Remove failed');
    } finally {
      setLoading(false);
    }
  };

  const isInstalled = status?.installed ?? false;
  const isAuthenticated = status?.authenticated ?? false;
  const isServeEnabled = status?.settings?.enabled ?? false;
  const serveUrl = isServeEnabled ? `https://${status?.hostname || 'bizar-dash'}` : null;

  if (!isInstalled) {
    return (
      <Card id="settings-tailscale-auth" data-section="tailscale">
        <CardTitle><Plug size={14} /> Tailscale Integration</CardTitle>
        <CardMeta>Tailscale is not installed on this machine.</CardMeta>
        <p className="muted">
          Install from{' '}
          <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">
            tailscale.com/download
          </a>
        </p>
      </Card>
    );
  }

  return (
    <Card id="settings-tailscale-auth" data-section="tailscale">
      <CardTitle><Plug size={14} /> Tailscale Integration</CardTitle>
      <CardMeta>Expose the dashboard over your Tailscale network using an auth key.</CardMeta>

      {error && (
        <p style={{ color: 'var(--color-error, #f85149)', fontSize: '0.85rem' }}>{error}</p>
      )}

      {isAuthenticated ? (
        <>
          <div className="status-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <CheckCircle size={16} style={{ color: 'var(--color-success, #3fb950)' }} />
            <span>Authenticated as <strong>{status?.hostname || 'unknown'}</strong></span>
          </div>

          {isServeEnabled && serveUrl ? (
            <>
              <div className="status-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <LinkIcon size={16} />
                <a href={serveUrl} target="_blank" rel="noreferrer">{serveUrl}</a>
              </div>
              <Button variant="secondary" size="sm" onClick={handleRemoveServe} disabled={loading}>
                Remove serve
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={handleSetupServe} disabled={loading}>
              Set up Tailscale serve
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: '0.75rem' }}>Not authenticated with Tailscale.</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="input"
              placeholder="tskey-..."
              value={authKey}
              onChange={(e) => setAuthKey(e.target.value)}
              style={{ flex: 1, minWidth: '200px' }}
              disabled={loading}
            />
            <Button variant="primary" size="sm" onClick={handleAuthenticate} disabled={loading || !authKey.trim()}>
              Authenticate
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
