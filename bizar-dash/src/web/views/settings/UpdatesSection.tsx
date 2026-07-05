// src/web/views/settings/UpdatesSection.tsx
import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../../components/Card';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { Ws } from '../../lib/ws';

type PkgStatus = {
  status: 'idle' | 'starting' | 'installing' | 'done' | 'error';
  error?: string;
  newVersion?: string;
  logs: string[];
};

type StatusState = {
  current: Record<string, string | null>;
  latest: Record<string, string | null> | null;
  checking: boolean;
  updating: boolean;
  hasUpdates: boolean;
  requiresRestart: boolean;
  perPackage: Record<string, PkgStatus>;
  error?: string;
};

const PACKAGES = [
  { id: 'bizar', name: 'Bizar CLI' },
  { id: 'bizar-dash', name: 'Dashboard' },
  { id: 'bizar-plugin', name: 'Opencode Plugin' },
];

export function UpdatesSection() {
  const toast = useToast();
  const [status, setStatus] = useState<StatusState>({
    current: {},
    latest: null,
    checking: false,
    updating: false,
    hasUpdates: false,
    requiresRestart: false,
    perPackage: {},
  });

  // WebSocket subscription for live update progress
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

  const isBusy = status.checking || status.updating;

  return (
    <Card id="settings-updates" data-section="updates">
      <CardTitle><Download size={14} /> Updates</CardTitle>
      <CardMeta>Check installed Bizar packages and apply dashboard updates.</CardMeta>

      {/* Current versions */}
      <div className="updates-current">
        <h4>Installed versions</h4>
        <ul>
          {PACKAGES.map((p) => (
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
            {PACKAGES.map((p) => {
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

      {/* Per-package progress rows */}
      {status.updating && (
        <div className="updates-progress-rows">
          {PACKAGES.map((p) => {
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
