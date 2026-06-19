// src/mobile/views/MobileSettings.tsx — mobile settings tab.
import { useEffect, useState, useCallback } from 'react';
import { QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { Settings, Snapshot } from '../../lib/types';
import { api } from '../../lib/api';

type Props = {
  settings: Settings;
  snapshot: Snapshot | null;
};

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

export function MobileSettings({ settings, snapshot }: Props) {
  const theme = settings.theme;
  const ui = settings.ui;

  // v3.5.2 — Pair-with-mobile state
  const [pair, setPair] = useState<PairSession | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const startPair = useCallback(async () => {
    setPairing(true);
    setPairError(null);
    try {
      const res = await api.post<PairSession>('/pair/start');
      setPair(res);
    } catch (err) {
      setPairError((err as Error)?.message || 'Failed to start pairing');
    } finally {
      setPairing(false);
    }
  }, []);

  // Countdown ticker — only runs while we have an active session.
  useEffect(() => {
    if (!pair) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pair]);

  const remaining = pair ? pair.expiresAt - now : 0;
  const expired = pair != null && remaining <= 0;

  return (
    <div className="mobile-view">
      {/* v3.5.2 — Pair with mobile (Bizar Companion) */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">
          <Smartphone size={14} /> Companion App
        </h3>
        <div className="mobile-card">
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Bizar Companion</span>
            <span className="mobile-setting-value">
              {pair && !expired ? 'Pairing…' : 'Unpaired'}
            </span>
          </div>

          {!pair && (
            <button
              type="button"
              className="mobile-btn"
              onClick={startPair}
              disabled={pairing}
              style={{ width: '100%', marginTop: 12 }}
            >
              <QrCode size={16} />
              {pairing ? 'Generating…' : 'Generate QR Code'}
            </button>
          )}

          {pair && !expired && (
            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <div
                style={{
                  display: 'inline-block',
                  background: '#fff',
                  padding: 12,
                  borderRadius: 12,
                }}
              >
                <QRCodeSVG
                  value={pair.qrPayload}
                  size={208}
                  level="M"
                  includeMargin={false}
                />
              </div>
              <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
                Expires in <strong>{formatCountdown(remaining)}</strong>
              </div>
              <div
                className="mobile-setting-value mono"
                style={{ marginTop: 8, fontSize: 11, wordBreak: 'break-all' }}
              >
                {pair.publicUrl}
              </div>
              <button
                type="button"
                className="mobile-btn mobile-btn-secondary"
                onClick={startPair}
                disabled={pairing}
                style={{ marginTop: 12 }}
              >
                <RefreshCw size={14} /> Regenerate
              </button>
            </div>
          )}

          {pair && expired && (
            <div style={{ marginTop: 12 }}>
              <div className="mobile-setting-row">
                <span className="mobile-setting-label">Status</span>
                <span className="mobile-setting-value" style={{ color: '#f85149' }}>
                  Expired
                </span>
              </div>
              <button
                type="button"
                className="mobile-btn"
                onClick={() => {
                  setPair(null);
                  startPair();
                }}
                style={{ width: '100%', marginTop: 12 }}
              >
                <RefreshCw size={16} /> Generate new QR
              </button>
            </div>
          )}

          {pairError && (
            <div style={{ marginTop: 12, color: '#f85149', fontSize: 12 }}>
              {pairError}
            </div>
          )}
        </div>
      </section>

      {/* Theme */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">Appearance</h3>
        <div className="mobile-card">
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Theme</span>
            <span className="mobile-setting-value">{theme.mode}</span>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Accent color</span>
            <span className="mobile-setting-value">
              <span
                style={{
                  display: 'inline-block',
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: theme.accent,
                  verticalAlign: 'middle',
                }}
              />
              {' '}
              {theme.accent}
            </span>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Animations</span>
            <span className="mobile-setting-value">{theme.animations ? 'On' : 'Off'}</span>
          </div>
        </div>
      </section>

      {/* Project */}
      {snapshot?.activeProject && (
        <section className="mobile-section">
          <h3 className="mobile-section-title">Project</h3>
          <div className="mobile-card">
            <div className="mobile-setting-row">
              <span className="mobile-setting-label">Active</span>
              <span className="mobile-setting-value">{snapshot.activeProject.name}</span>
            </div>
            <div className="mobile-setting-row">
              <span className="mobile-setting-label">Path</span>
              <span className="mobile-setting-value mono">{snapshot.activeProject.path}</span>
            </div>
          </div>
        </section>
      )}

      {/* Chat defaults */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">Chat Defaults</h3>
        <div className="mobile-card">
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Default Agent</span>
            <span className="mobile-setting-value">@{settings.defaultAgent || 'odin'}</span>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Default Model</span>
            <span className="mobile-setting-value">{settings.defaultModel || '(auto)'}</span>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">About</h3>
        <div className="mobile-card">
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Version</span>
            <span className="mobile-setting-value mono">{settings.about?.version || 'v3.5.2'}</span>
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