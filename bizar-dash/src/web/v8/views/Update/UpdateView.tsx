/**
 * v8/views/Update/UpdateView.tsx — Sprint S42, v9.3.0.
 *
 * Package update status + Check + Apply:
 *  - GET  /api/updates/status — installed versions
 *  - GET  /api/updates/check  — installed + latest + hasUpdates
 *  - POST /api/updates/apply  — kick install, streams via
 *    `update:progress` / `update:log` / `update:complete` WS events.
 *
 * Per-package Apply (inline-confirm) + global Apply All button. Live
 * progress list rendered from a useWsMessage subscription.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, RefreshCcw, Download, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface UpdateEntry {
  id: string;
  installed?: string;
  latest?: string | null;
  hasUpdate?: boolean;
  label?: string;
}

interface StatusResponse {
  packages: UpdateEntry[];
}

interface CheckResponse {
  packages: UpdateEntry[];
  hasUpdates?: boolean;
}

interface ProgressEvent {
  type: 'update:progress' | 'update:log' | 'update:complete';
  pkg?: string;
  status?: string;
  line?: string;
  newVersion?: string;
  error?: string;
}

export function UpdateView(): JSX.Element {
  const statusPayload = useFetch<StatusResponse>('/api/updates/status');
  const [check, setCheck] = useState<CheckResponse | null>(null);
  const [checking, setChecking] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [confirmApply, setConfirmApply] = useState<string | null>(null);
  const [log, setLog] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const installed = useMemo<UpdateEntry[]>(() => statusPayload.data?.packages ?? [], [statusPayload.data]);
  const refresh = useCallback(() => { void statusPayload.refetch(); }, [statusPayload]);

  // Subscribe to live progress events.
  useWsMessage('update:progress', (msg) => {
    setLog((l) => [...l, { type: 'update:progress', ...msg } as ProgressEvent]);
  });
  useWsMessage('update:log', (msg) => {
    setLog((l) => [...l, { type: 'update:log', ...msg } as ProgressEvent]);
  });
  useWsMessage('update:complete', (msg) => {
    setLog((l) => [...l, { type: 'update:complete', ...msg } as ProgressEvent]);
    setApplying(false);
    refresh();
  });

  const runCheck = async (): Promise<void> => {
    setChecking(true);
    setError(null);
    try {
      const r = await fetchJson<CheckResponse>('/api/updates/check');
      setCheck(r);
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const apply = async (ids: string[]): Promise<void> => {
    setApplying(true);
    setError(null);
    setConfirmApply(null);
    try {
      await fetchJson('/api/updates/apply', { method: 'POST', body: { packages: ids } });
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
      setApplying(false);
    }
  };

  const rows: UpdateEntry[] = check?.packages ?? installed.map((p) => ({ ...p, hasUpdate: false }));

  return (
    <Stack gap={4} data-testid="update-view">
      <ViewHeader
        title="Update"
        description="Bizar package updates. Apply restarts on next launch."
        actions={
          <Inline align="center" gap={2}>
            {error !== null && (
              <span role="alert" data-testid="update-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
                {error}
              </span>
            )}
            <Button variant="ghost" onClick={() => void refresh()} data-testid="update-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="ghost" onClick={() => void runCheck()} disabled={checking} data-testid="update-check">
              <Download size={14} aria-hidden /> {checking ? 'Checking…' : 'Check'}
            </Button>
            <Button
              variant="primary"
              onClick={() => setConfirmApply('all')}
              disabled={applying || !(check?.hasUpdates ?? false)}
              data-testid="update-apply-all"
            >
              <Package size={14} aria-hidden /> Apply all
            </Button>
          </Inline>
        }
      />

      <Card variant="default">
        <CardBody>
          {statusPayload.loading && rows.length === 0 ? (
            <Stack gap={1}>
              <Skeleton style={{ height: 40 }} />
              <Skeleton style={{ height: 40 }} />
              <Skeleton style={{ height: 40 }} />
            </Stack>
          ) : rows.length === 0 ? (
            <EmptyState icon={<Package size={28} aria-hidden />} title="No packages" description="Update status endpoint returned no packages." />
          ) : (
            <Stack gap={1}>
              {rows.map((p) => {
                const isConfirming = confirmApply === p.id;
                return (
                  <div
                    key={p.id}
                    data-testid={`update-row-${p.id}`}
                    style={{
                      padding: 'var(--space-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-0)',
                    }}
                  >
                    <Inline align="center" justify="between" gap={2}>
                      <Stack gap={0}>
                        <Inline align="center" gap={2}>
                          <strong>{p.label || p.id}</strong>
                          <code style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{p.id}</code>
                        </Inline>
                        <Inline align="center" gap={2}>
                          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                            installed: <code>{p.installed ?? '?'}</code>
                          </span>
                          {p.latest !== undefined && p.latest !== null && (
                            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                              latest: <code>{p.latest}</code>
                            </span>
                          )}
                          {p.hasUpdate && (
                            <span data-testid={`update-available-${p.id}`} style={{ fontSize: 'var(--fs-11)', color: 'var(--accent)', fontWeight: 600 }}>
                              UPDATE AVAILABLE
                            </span>
                          )}
                        </Inline>
                      </Stack>
                      <Inline gap={1}>
                        {p.hasUpdate && (
                          <Button
                            variant="ghost"
                            onClick={() => setConfirmApply((cur) => (cur === p.id ? null : p.id))}
                            data-testid={`update-apply-${p.id}`}
                            disabled={applying}
                          >
                            Apply
                          </Button>
                        )}
                      </Inline>
                    </Inline>
                    {isConfirming && (
                      <Inline gap={1} style={{ marginTop: 'var(--space-1)' }}>
                        <Button variant="primary" onClick={() => void apply([p.id])} data-testid={`update-confirm-apply-${p.id}`}>
                          Confirm apply
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmApply(null)}>Cancel</Button>
                      </Inline>
                    )}
                  </div>
                );
              })}
            </Stack>
          )}
        </CardBody>
      </Card>

      {confirmApply === 'all' && (
        <Card variant="default">
          <CardBody>
            <Stack gap={2}>
              <strong>Apply all updates?</strong>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                {rows.filter((p) => p.hasUpdate).length} package(s) will update on next launch.
              </span>
              <Inline gap={1}>
                <Button variant="primary" onClick={() => void apply(rows.filter((p) => p.hasUpdate).map((p) => p.id))} data-testid="update-confirm-apply-all">
                  Confirm apply all
                </Button>
                <Button variant="ghost" onClick={() => setConfirmApply(null)}>Cancel</Button>
              </Inline>
            </Stack>
          </CardBody>
        </Card>
      )}

      {log.length > 0 && (
        <Card variant="default">
          <CardBody>
            <strong style={{ fontSize: 'var(--fs-13)' }}>Progress</strong>
            <div
              data-testid="update-log"
              style={{
                marginTop: 'var(--space-2)',
                padding: 'var(--space-2)',
                background: 'var(--surface-1)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-12)',
                maxHeight: 240,
                overflow: 'auto',
              }}
            >
              {log.slice(-100).map((l, i) => (
                <div key={i} style={{ color: l.error ? 'var(--danger)' : l.status === 'done' ? 'var(--success)' : 'var(--fg)' }}>
                  {l.type === 'update:complete' ? (
                    <Inline align="center" gap={1}><CheckCircle2 size={12} aria-hidden style={{ color: 'var(--success)' }} /> complete</Inline>
                  ) : l.error ? (
                    <Inline align="center" gap={1}><AlertCircle size={12} aria-hidden style={{ color: 'var(--danger)' }} /> {l.pkg ?? '?'} · {l.error}</Inline>
                  ) : (
                    <Inline align="center" gap={1}>
                      {l.status === 'installing' ? <Loader2 size={12} aria-hidden style={{ animation: 'spin 1s linear infinite' }} /> : null}
                      {l.pkg ?? '?'} · {l.status ?? l.line ?? ''}
                    </Inline>
                  )}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </Stack>
  );
}