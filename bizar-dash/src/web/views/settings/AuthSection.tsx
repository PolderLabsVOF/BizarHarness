// src/web/views/settings/AuthSection.tsx
import React, { useEffect, useState } from 'react';
import { Shield, Copy, KeyRound, RotateCcw } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../../components/Card';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import type { Settings } from '../../lib/types';

type AuthStatus = { required: boolean; loopback: boolean; peer: string };

type Props = {
  settings: Settings;
  authStatus: AuthStatus | null;
  setAuthStatus: React.Dispatch<React.SetStateAction<AuthStatus | null>>;
};

export function AuthSection({ authStatus, setAuthStatus }: Props) {
  const toast = useToast();
  const [authToken, setAuthToken] = useState<string>(api.getToken());
  const [revealedToken, setRevealedToken] = useState<string>('');

  // Probe the server once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.probeAuthStatus();
        if (!cancelled) setAuthStatus(r);
      } catch {
        if (!cancelled) {
          setAuthStatus({ required: true, loopback: false, peer: '' });
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
    <Card id="settings-auth" data-section="auth">
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
        <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
          For Tailscale Serve or any reverse-proxy access, paste this token
          once via the boot screen — it is saved per-origin and works for all
          subsequent visits.
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
  );
}
