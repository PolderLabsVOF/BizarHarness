// src/web/views/settings/NetworkSection.tsx
import React from 'react';
import { Server as ServerIcon, Plug } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../../components/Card';
import { Button } from '../../components/Button';
import type { TailscaleStatus } from '../../lib/types';

type Props = {
  tailscale: TailscaleStatus | null;
  tailscaleDraft: { port: number; https: boolean; hostname: string };
  setTailscaleDraft: React.Dispatch<React.SetStateAction<{ port: number; https: boolean; hostname: string }>>;
  onTailscaleToggle: () => void;
};

export function NetworkSection({ tailscale, tailscaleDraft, setTailscaleDraft, onTailscaleToggle }: Props) {
  return (
    <>
      {/* Service */}
      <Card id="settings-service" data-section="service">
        <CardTitle><ServerIcon size={14} /> Service</CardTitle>
        <CardMeta>Background daemon that runs schedules.</CardMeta>
        <div data-setting-id="service.enabled">
          {tailscale ? (
            <div className="service-card">
              <p>
                Status: <strong>{tailscale.settings.enabled ? 'enabled' : 'disabled'}</strong>
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

      {/* Tailscale */}
      <Card id="settings-tailscale" data-section="tailscale">
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
                <label className="field-label" htmlFor="tailscale-https">Use HTTPS</label>
                <input
                  id="tailscale-https"
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
    </>
  );
}
