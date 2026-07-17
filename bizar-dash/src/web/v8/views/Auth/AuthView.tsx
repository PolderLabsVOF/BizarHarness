/**
 * v8/views/Auth/AuthView.tsx — Sprint S40, v9.3.0.
 *
 * Auth status + token-reveal + regenerate surface. Reads the
 * unauthed /api/auth/status on mount, then on user request hits
 * the authed /api/auth/reveal to show the current token, and
 * /api/auth/regenerate (with inline confirm) to mint a new one.
 */

import { useCallback, useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, RotateCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Badge } from '../../ui/data/Badge.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface AuthStatus {
  required: boolean;
  loopback: boolean;
  peer?: string;
}

export function AuthView(): JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [revealing, setRevealing] = useState<boolean>(false);
  const [showToken, setShowToken] = useState<boolean>(false);
  const [confirmRegen, setConfirmRegen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const res = await fetchJson<AuthStatus>('/api/auth/status');
      setStatus(res);
    } catch (err) {
      setStatusError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const reveal = async (): Promise<void> => {
    setRevealing(true);
    setError(null);
    try {
      const res = await fetchJson<{ token: string }>('/api/auth/reveal');
      setToken(res.token);
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setRevealing(false);
    }
  };

  const regenerate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson<{ token: string }>('/api/auth/regenerate', { method: 'POST', body: {} });
      setToken(res.token);
      setShowToken(true);
      setConfirmRegen(false);
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
    } catch { /* clipboard might be blocked; the token is still on-screen */ }
  };

  return (
    <Stack gap={4} data-testid="auth-view">
      <ViewHeader
        title="Auth"
        description="Dashboard auth status + bearer token management."
      />

      <Card variant="default">
        <CardBody>
          <Stack gap={2}>
            <strong style={{ fontSize: 'var(--fs-13)' }}>Status</strong>
            {status === null && statusError === null ? (
              <Skeleton style={{ height: 24, width: 240 }} />
            ) : statusError !== null ? (
              <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{statusError}</span>
            ) : (
              <Inline gap={2} wrap>
                {status?.required ? (
                  <Badge tone="warning" data-testid="auth-required">
                    <ShieldAlert size={12} aria-hidden /> Required
                  </Badge>
                ) : (
                  <Badge tone="success" data-testid="auth-required">
                    <ShieldCheck size={12} aria-hidden /> Not required
                  </Badge>
                )}
                {status?.loopback && <Badge tone="info">Loopback</Badge>}
                {status?.peer && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                    {status.peer}
                  </span>
                )}
              </Inline>
            )}
          </Stack>
        </CardBody>
      </Card>

      <Card variant="default">
        <CardBody>
          <Stack gap={3}>
            <strong style={{ fontSize: 'var(--fs-13)' }}>Bearer token</strong>
            {token === null ? (
              <Inline gap={2}>
                <Button variant="ghost" onClick={() => void reveal()} disabled={revealing} data-testid="auth-reveal">
                  <Eye size={14} aria-hidden /> {revealing ? 'Loading…' : 'Reveal'}
                </Button>
              </Inline>
            ) : (
              <Stack gap={2}>
                <Inline gap={2}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', flex: 1 }}>
                    <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Bearer token</span>
                    <Input
                      readOnly
                      value={showToken ? token : '••••••••••••••••••••••'}
                      aria-label="Bearer token"
                      data-testid="auth-token-input"
                      onFocus={(e) => (e.target as HTMLInputElement).select()}
                    />
                  </label>
                  <Button variant="ghost" onClick={() => setShowToken((s) => !s)} data-testid="auth-toggle-visibility">
                    {showToken ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  </Button>
                  <Button variant="ghost" onClick={() => void copy()} data-testid="auth-copy">
                    <Copy size={14} aria-hidden /> Copy
                  </Button>
                </Inline>
                {confirmRegen ? (
                  <Inline gap={1}>
                    <Button variant="danger" onClick={() => void regenerate()} disabled={busy} data-testid="auth-confirm-regen">
                      Confirm rotate
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmRegen(false)} disabled={busy} data-testid="auth-cancel-regen">
                      Cancel
                    </Button>
                  </Inline>
                ) : (
                  <Button variant="danger" onClick={() => setConfirmRegen(true)} data-testid="auth-regen">
                    <RotateCw size={14} aria-hidden /> Rotate token
                  </Button>
                )}
              </Stack>
            )}
            {error !== null && (
              <span role="alert" data-testid="auth-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
                {error}
              </span>
            )}
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}