import { useEffect, useState } from 'react';
import { Network, Play, Square, Plug, Unplug, RotateCw, RefreshCw } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Badge } from '../../ui/data/Badge.js';
import { Button } from '../../ui/controls/Button.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

/**
 * HeadroomView — Sprint S35. Headroom proxy install + lifecycle.
 */

type Status = 'installed' | 'not-installed' | 'running' | 'stopped';

interface HeadroomStatus {
  status: Status;
  version?: string;
  port?: number;
  message?: string;
}

interface HeadroomStats {
  hours?: number;
  requests?: number;
  tokensSaved?: number;
  cacheHits?: number;
  cacheMisses?: number;
}

export function HeadroomView(): JSX.Element {
  const status = useFetch<HeadroomStatus>('/api/headroom/status');
  const stats = useFetch<HeadroomStats>('/api/headroom/stats?hours=24');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => { void status.refetch(); }, 15_000);
    return () => clearInterval(id);
  }, [status]);

  const install = async (): Promise<void> => {
    setBusy('install');
    setError(null);
    try {
      await fetchJson('/api/headroom/install', { method: 'POST', body: { force: false } });
      void status.refetch();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const wrap = async (): Promise<void> => {
    setBusy('wrap');
    setError(null);
    try {
      await fetchJson('/api/headroom/wrap', { method: 'POST', body: { port: 8787 } });
      void status.refetch();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const unwrap = async (): Promise<void> => {
    setBusy('unwrap');
    setError(null);
    try {
      await fetchJson('/api/headroom/unwrap', { method: 'POST' });
      void status.refetch();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const start = async (): Promise<void> => {
    setBusy('start');
    setError(null);
    try {
      await fetchJson('/api/headroom/start', { method: 'POST' });
      void status.refetch();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const stop = async (): Promise<void> => {
    setBusy('stop');
    setError(null);
    try {
      await fetchJson('/api/headroom/stop', { method: 'POST' });
      void status.refetch();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const s = status.data;
  const isInstalled = s && s.status !== 'not-installed';
  const isRunning = s?.status === 'running';

  return (
    <Stack gap={5}>
      <ViewHeader
        title="Headroom"
        description="Local proxy that reduces token cost via caching + batching. Install, wrap Cline, start/stop."
        actions={
          <Inline gap={2} align="center">
            {error !== null && <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>}
            <Button variant="ghost" onClick={() => { void status.refetch(); }} data-testid="headroom-refresh">
              <RefreshCw size={14} aria-hidden /> Refresh
            </Button>
          </Inline>
        }
      />

      <Card variant="elevated">
        <CardBody>
          {status.loading && !s ? (
            <Skeleton style={{ height: 60 }} />
          ) : (
            <Inline align="center" justify="between" gap={3}>
              <Stack gap={1}>
                <Inline align="center" gap={2}>
                  <Network size={16} aria-hidden />
                  <strong>{s?.status ?? 'unknown'}</strong>
                  {s?.version && <Badge tone="neutral">v{s.version}</Badge>}
                  {s?.port && <Badge tone="info">port {s.port}</Badge>}
                </Inline>
                {s?.message && <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{s.message}</span>}
              </Stack>
              <Inline gap={1} wrap={true}>
                {!isInstalled && (
                  <Button variant="primary" onClick={() => void install()} disabled={busy === 'install'} data-testid="headroom-install">
                    <Plug size={12} aria-hidden /> {busy === 'install' ? 'Installing…' : 'Install'}
                  </Button>
                )}
                {isInstalled && (
                  <>
                    <Button variant={isRunning ? 'secondary' : 'primary'} onClick={() => void (isRunning ? stop() : start())} disabled={busy === 'start' || busy === 'stop'} data-testid="headroom-toggle-running">
                      {isRunning ? <Square size={12} aria-hidden /> : <Play size={12} aria-hidden />}
                      {isRunning ? (busy === 'stop' ? 'Stopping…' : 'Stop') : (busy === 'start' ? 'Starting…' : 'Start')}
                    </Button>
                    <Button variant="ghost" onClick={() => void wrap()} disabled={busy === 'wrap'} data-testid="headroom-wrap">
                      <RotateCw size={12} aria-hidden /> {busy === 'wrap' ? 'Wrapping…' : 'Wrap Cline'}
                    </Button>
                    <Button variant="ghost" onClick={() => void unwrap()} disabled={busy === 'unwrap'} data-testid="headroom-unwrap">
                      <Unplug size={12} aria-hidden /> {busy === 'unwrap' ? 'Unwrapping…' : 'Unwrap'}
                    </Button>
                  </>
                )}
              </Inline>
            </Inline>
          )}
        </CardBody>
      </Card>

      <Grid cols={3}>
        <Card variant="default">
          <CardBody>
            <Stack gap={1}>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Requests (24h)</span>
              <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-18)' }}>{stats.data?.requests ?? 0}</strong>
            </Stack>
          </CardBody>
        </Card>
        <Card variant="default">
          <CardBody>
            <Stack gap={1}>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Tokens saved</span>
              <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-18)' }}>{stats.data?.tokensSaved ?? 0}</strong>
            </Stack>
          </CardBody>
        </Card>
        <Card variant="default">
          <CardBody>
            <Stack gap={1}>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Cache hits / misses</span>
              <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-18)' }}>
                {stats.data?.cacheHits ?? 0} / {stats.data?.cacheMisses ?? 0}
              </strong>
            </Stack>
          </CardBody>
        </Card>
      </Grid>
    </Stack>
  );
}