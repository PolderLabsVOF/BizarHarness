/**
 * v8/views/Providers/ProvidersView.tsx — Sprint S42, v9.3.0.
 *
 * Provider list pulled from /api/providers (aggregated). Per-row:
 * - active-key card (GET /api/providers/:id/active-key) with masked
 *   key preview + label + status
 * - rotate button (POST /api/providers/:id/rotate) with inline confirm
 *
 * Header actions:
 * - Active default card (GET /api/providers/active)
 * - Auto-detect (GET /api/providers/auto-detect)
 *
 * Inline confirm row pattern; no window.confirm.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, RotateCw, Sparkles, Star, RefreshCcw, Cpu } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface Provider {
  id: string;
  name?: string;
  source?: string;
  baseURL?: string;
  models?: string[];
  keys?: ProviderKey[];
  active?: boolean;
}

interface ProviderKey {
  envVar?: string;
  label?: string;
  status?: string;
}

interface ActiveKey {
  envVar: string;
  label?: string;
  status?: string;
  keyPreview: string;
  keySet: boolean;
}

interface ActiveDefault {
  providerId: string | null;
  modelId: string | null;
  source?: string | null;
}

export function ProvidersView(): JSX.Element {
  const payload = useFetch<{ providers: Provider[]; count: number }>('/api/providers');
  const activePayload = useFetch<ActiveDefault>('/api/providers/active');
  const [confirmRotate, setConfirmRotate] = useState<string | null>(null);
  const [activeKeys, setActiveKeys] = useState<Record<string, ActiveKey | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [autoDetect, setAutoDetect] = useState<{ providers: Provider[] } | null>(null);
  const [probing, setProbing] = useState<boolean>(false);

  const providers = useMemo<Provider[]>(() => payload.data?.providers ?? [], [payload.data]);
  const refresh = useCallback(() => { void payload.refetch(); void activePayload.refetch(); }, [payload, activePayload]);

  // Fetch the active key for each provider (lazy, in parallel).
  useEffect(() => {
    if (!providers.length) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        providers.map(async (p) => {
          try {
            const r = await fetchJson<{ ok: boolean; active: ActiveKey } | { ok: false; error: string }>(`/api/providers/${p.id}/active-key`);
            return [p.id, ('active' in r ? r.active : null)] as const;
          } catch {
            return [p.id, null] as const;
          }
        }),
      );
      if (!cancelled) {
        const map: Record<string, ActiveKey | null> = {};
        for (const [id, ak] of results) map[id] = ak;
        setActiveKeys(map);
      }
    })();
    return () => { cancelled = true; };
  }, [providers]);

  const rotate = async (id: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/providers/${id}/rotate`, { method: 'POST' });
      setConfirmRotate(null);
      refresh();
      // Re-fetch the new active key for this row.
      try {
        const r = await fetchJson<{ ok: boolean; active: ActiveKey }>(`/api/providers/${id}/active-key`);
        setActiveKeys((m) => ({ ...m, [id]: r.active }));
      } catch { /* ignore */ }
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const addKey = async (id: string): Promise<void> => {
    const envVar = window.prompt(`Env var name to add to ${id} (e.g. ${id.toUpperCase()}_KEY_2)`);
    if (!envVar?.trim()) return;
    const label = window.prompt('Label (optional)') || undefined;
    setError(null);
    try {
      await fetchJson(`/api/providers/${id}/keys`, { method: 'POST', body: { envVar, label } });
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const runAutoDetect = async (): Promise<void> => {
    setProbing(true);
    setError(null);
    try {
      const r = await fetchJson<{ providers: Provider[] }>('/api/providers/auto-detect');
      setAutoDetect({ providers: r.providers });
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setProbing(false);
    }
  };

  return (
    <Stack gap={4} data-testid="providers-view">
      <ViewHeader
        title="Providers"
        description="Configured LLM providers + active key rotation."
        actions={
          <Inline align="center" gap={2}>
            {error !== null && (
              <span role="alert" data-testid="providers-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
                {error}
              </span>
            )}
            <Button variant="ghost" onClick={() => void refresh()} data-testid="providers-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="primary" onClick={() => void runAutoDetect()} disabled={probing} data-testid="providers-auto-detect">
              <Sparkles size={14} aria-hidden /> {probing ? 'Probing…' : 'Auto-detect'}
            </Button>
          </Inline>
        }
      />

      {activePayload.data && (activePayload.data.providerId !== null || activePayload.data.modelId !== null) && (
        <Card variant="default">
          <CardBody>
            <Inline align="center" justify="between" gap={2}>
              <Inline align="center" gap={2}>
                <Star size={14} aria-hidden style={{ color: 'var(--accent)' }} />
                <strong>Active default:</strong>
                <code data-testid="providers-active-provider">{activePayload.data.providerId ?? '—'}</code>
                <span style={{ color: 'var(--fg-muted)' }}>·</span>
                <code data-testid="providers-active-model">{activePayload.data.modelId ?? '—'}</code>
                {activePayload.data.source && (
                  <span style={{ color: 'var(--fg-subtle)', fontSize: 'var(--fs-12)' }}>({activePayload.data.source})</span>
                )}
              </Inline>
            </Inline>
          </CardBody>
        </Card>
      )}

      {autoDetect !== null && (
        <Card variant="default">
          <CardBody>
            <Stack gap={1}>
              <strong style={{ fontSize: 'var(--fs-13)' }}>Auto-detect result</strong>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                {autoDetect.providers.length} candidate{autoDetect.providers.length === 1 ? '' : 's'} from env + config.
              </span>
            </Stack>
          </CardBody>
        </Card>
      )}

      <Card variant="default">
        <CardBody>
          {payload.loading && providers.length === 0 ? (
            <Stack gap={1}>
              <Skeleton style={{ height: 56 }} />
              <Skeleton style={{ height: 56 }} />
            </Stack>
          ) : providers.length === 0 ? (
            <EmptyState icon={<Cpu size={28} aria-hidden />} title="No providers" description="Run Auto-detect or add via Config → Providers." />
          ) : (
            <Stack gap={1}>
              {providers.map((p) => {
                const isConfirming = confirmRotate === p.id;
                const ak = activeKeys[p.id];
                return (
                  <div
                    key={p.id}
                    data-testid={`provider-row-${p.id}`}
                    style={{
                      padding: 'var(--space-3)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-0)',
                    }}
                  >
                    <Inline align="center" justify="between" gap={2}>
                      <Stack gap={0}>
                        <Inline align="center" gap={2}>
                          <strong>{p.name || p.id}</strong>
                          <code style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{p.id}</code>
                          {p.source && <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>· {p.source}</span>}
                          {p.active && (
                            <span data-testid={`provider-active-${p.id}`} style={{ fontSize: 'var(--fs-11)', color: 'var(--success)', fontWeight: 600 }}>ACTIVE</span>
                          )}
                        </Inline>
                        {p.baseURL && <code style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{p.baseURL}</code>}
                      </Stack>
                      <Inline gap={1}>
                        <Button
                          variant="ghost"
                          onClick={() => setConfirmRotate((cur) => (cur === p.id ? null : p.id))}
                          data-testid={`provider-rotate-${p.id}`}
                          aria-label={`Rotate ${p.id}`}
                          disabled={!p.keys || p.keys.length < 2}
                          title={!p.keys || p.keys.length < 2 ? 'Need ≥2 keys to rotate' : 'Rotate active key'}
                        >
                          <RotateCw size={14} aria-hidden /> Rotate
                        </Button>
                        <Button
                          variant="primary"
                          onClick={() => void addKey(p.id)}
                          data-testid={`provider-add-key-${p.id}`}
                          aria-label={`Add key to ${p.id}`}
                        >
                          <KeyRound size={14} aria-hidden /> Add key
                        </Button>
                      </Inline>
                    </Inline>

                    {/* Active-key sub-row */}
                    <div data-testid={`provider-active-key-${p.id}`} style={{ marginTop: 'var(--space-2)', padding: 'var(--space-2)', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)' }}>
                      <Inline align="center" gap={2}>
                        <KeyRound size={12} aria-hidden style={{ color: 'var(--fg-muted)' }} />
                        {ak === undefined ? (
                          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-subtle)' }}>Probing active key…</span>
                        ) : ak === null ? (
                          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-subtle)' }}>No active key</span>
                        ) : (
                          <Inline align="center" gap={2} data-testid={`provider-active-key-detail-${p.id}`}>
                            <code style={{ fontSize: 'var(--fs-12)' }}>{ak.envVar}</code>
                            {ak.label && <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>· {ak.label}</span>}
                            {ak.status && <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>· {ak.status}</span>}
                            <code style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{ak.keyPreview}</code>
                          </Inline>
                        )}
                      </Inline>
                    </div>

                    {isConfirming && (
                      <Inline gap={1} style={{ marginTop: 'var(--space-1)' }}>
                        <Button variant="primary" onClick={() => void rotate(p.id)} data-testid={`provider-confirm-rotate-${p.id}`}>
                          Confirm rotate
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmRotate(null)}>Cancel</Button>
                      </Inline>
                    )}
                  </div>
                );
              })}
            </Stack>
          )}
        </CardBody>
      </Card>
    </Stack>
  );
}