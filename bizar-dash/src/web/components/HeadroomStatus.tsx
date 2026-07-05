// src/web/components/HeadroomStatus.tsx
//
// v1.0.0 — Small status widget showing Headroom proxy status and live stats.
// Shown on the Overview tab or wherever fits in the dashboard layout.
import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import { Card, CardTitle } from '../components/Card';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

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

export function HeadroomStatus() {
  const [status, setStatus] = useState<HeadroomStatus | null>(null);
  const [stats, setStats] = useState<HeadroomStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, st] = await Promise.all([
          api.get<HeadroomStatus>('/headroom/status'),
          api.get<HeadroomStats>('/headroom/stats?hours=24').catch(() => ({ error: 'no stats' })),
        ]);
        if (!cancelled) {
          setStatus(s);
          setStats(st.error ? null : st);
        }
      } catch {
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
          <span className="muted">Loading Headroom status…</span>
        </div>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card>
        <div style={{ color: 'var(--error, #f85149)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <XCircle size={14} />
          <span>Headroom unavailable</span>
        </div>
      </Card>
    );
  }

  const { installed, version, proxyRunning, proxyPort, proxyPid, wrapped, healthy } = status;
  const isHealthy = healthy === 'ok';
  const ratio = stats?.compressionRatio ?? 0;
  const saved = stats?.tokensSaved ?? 0;

  return (
    <Card>
      <CardTitle>
        <Activity size={14} style={{ color: isHealthy ? 'var(--success, #3fb950)' : 'var(--warning, #d29922)' }} />
        Headroom
        {installed && version && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 4 }}>v{version}</span>
        )}
      </CardTitle>

      {/* Status pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {installed ? (
          <span className="status-pill status-pill-ok">
            <CheckCircle size={10} /> Installed
          </span>
        ) : (
          <span className="status-pill status-pill-error">
            <XCircle size={10} /> Not installed
          </span>
        )}
        {proxyRunning ? (
          <span className="status-pill status-pill-ok">
            <CheckCircle size={10} /> Proxy {proxyPort ? `@ ${proxyPort}` : ''}
            {proxyPid ? ` (PID ${proxyPid})` : ''}
          </span>
        ) : (
          <span className="status-pill status-pill-warn">
            <XCircle size={10} /> Proxy stopped
          </span>
        )}
        {wrapped ? (
          <span className="status-pill status-pill-ok">
            <CheckCircle size={10} /> Wrapped
          </span>
        ) : (
          <span className="status-pill status-pill-warn">
            <XCircle size={10} /> Not wrapped
          </span>
        )}
      </div>

      {/* Stats row */}
      {(saved > 0 || ratio > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <div className="stat-block">
            <div className="stat-big">{ratio > 0 ? `${Math.round(ratio * 100)}%` : '—'}</div>
            <div className="stat-label">Compression ratio</div>
          </div>
          <div className="stat-block">
            <div className="stat-big">{saved > 0 ? saved.toLocaleString() : '—'}</div>
            <div className="stat-label">Tokens saved (24h)</div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <a
          href="#settings-headroom"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
            color: 'var(--accent, #8b5cf6)',
            textDecoration: 'none',
          }}
        >
          <ExternalLink size={12} />
          Open settings
        </a>
      </div>
    </Card>
  );
}
