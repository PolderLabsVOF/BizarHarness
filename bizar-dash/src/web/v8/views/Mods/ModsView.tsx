/**
 * v8/views/Mods/ModsView.tsx — Sprint S42, v9.3.0.
 *
 * Two-section mod manager:
 *  - Installed (GET /api/mods): list with enable toggle (PUT
 *    /api/mods/:id {enabled}) and inline-confirm Uninstall (DELETE
 *    /api/mods/:id). Upgrade button if registry reports a newer
 *    version (POST /api/mods/:id/upgrade).
 *  - Registry (GET /api/mods/registry): list of available mods from
 *    the public registry, with Install button for un-installed ones.
 *
 * Install Sheet accepts either `path` (local) or `id` (registry).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Download, Plus, Power, PowerOff, RefreshCcw, Trash2, Upload, ArrowUpCircle } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Sheet, SheetContent } from '../../ui/feedback/Sheet.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface Mod {
  id: string;
  name?: string;
  version?: string;
  enabled?: boolean;
  description?: string;
  installed?: boolean;
  installedVersion?: string | null;
  upgradeAvailable?: string | null;
  latest?: string;
}

interface RegistryResponse {
  registry?: { version?: number; updatedAt?: string; source?: string };
  mods?: Mod[];
}

export function ModsView(): JSX.Element {
  const payload = useFetch<{ mods: Mod[] }>('/api/mods');
  const registryPayload = useFetch<RegistryResponse>('/api/mods/registry');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [installing, setInstalling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const mods = useMemo<Mod[]>(() => payload.data?.mods ?? [], [payload.data]);
  const registryMods = useMemo<Mod[]>(() => registryPayload.data?.mods ?? [], [registryPayload.data]);
  const refresh = useCallback(() => { void payload.refetch(); void registryPayload.refetch(); }, [payload, registryPayload]);

  const drop = async (id: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/mods/${id}`, { method: 'DELETE' });
      setConfirmDelete(null);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const toggle = async (id: string, enabled: boolean): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/mods/${id}`, { method: 'PUT', body: { enabled } });
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const upgrade = async (id: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/mods/${id}/upgrade`, { method: 'POST' });
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  return (
    <Stack gap={4} data-testid="mods-view">
      <ViewHeader
        title="Mods"
        description="Installed + registry-installed mods. Each mod ships its own UI view(s)."
        actions={
          <Inline align="center" gap={2}>
            {error !== null && (
              <span role="alert" data-testid="mods-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
                {error}
              </span>
            )}
            <Button variant="ghost" onClick={() => void refresh()} data-testid="mods-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="primary" onClick={() => setInstalling(true)} data-testid="mods-install">
              <Plus size={14} aria-hidden /> Install
            </Button>
          </Inline>
        }
      />

      <Card variant="default">
        <CardBody>
          <strong style={{ fontSize: 'var(--fs-13)' }}>Installed ({mods.length})</strong>
          {payload.loading && mods.length === 0 ? (
            <Stack gap={1} style={{ marginTop: 'var(--space-2)' }}>
              <Skeleton style={{ height: 40 }} />
            </Stack>
          ) : mods.length === 0 ? (
            <EmptyState icon={<Boxes size={28} aria-hidden />} title="No mods installed" description="Install one from the registry or a local path." />
          ) : (
            <Stack gap={1} style={{ marginTop: 'var(--space-2)' }}>
              {mods.map((m) => {
                const isConfirming = confirmDelete === m.id;
                const registryMatch = registryMods.find((r) => r.id === m.id);
                const upgradeTarget = registryMatch?.upgradeAvailable ?? null;
                return (
                  <div
                    key={m.id}
                    data-testid={`mod-row-${m.id}`}
                    style={{
                      padding: 'var(--space-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-0)',
                    }}
                  >
                    <Inline align="center" justify="between" gap={2}>
                      <Stack gap={0} style={{ minWidth: 0 }}>
                        <Inline align="center" gap={2}>
                          <strong>{m.name || m.id}</strong>
                          <code style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{m.id}</code>
                          {m.version && <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>v{m.version}</span>}
                          {m.enabled === false && (
                            <span style={{ fontSize: 'var(--fs-11)', color: 'var(--warning)', fontWeight: 600 }}>DISABLED</span>
                          )}
                          {upgradeTarget && (
                            <span data-testid={`mod-upgrade-available-${m.id}`} style={{ fontSize: 'var(--fs-11)', color: 'var(--accent)', fontWeight: 600 }}>
                              ↑ v{upgradeTarget} available
                            </span>
                          )}
                        </Inline>
                        {m.description && (
                          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{m.description}</span>
                        )}
                      </Stack>
                      <Inline gap={1}>
                        {upgradeTarget && (
                          <Button variant="ghost" onClick={() => void upgrade(m.id)} data-testid={`mod-upgrade-${m.id}`} aria-label={`Upgrade ${m.id}`}>
                            <ArrowUpCircle size={14} aria-hidden /> Upgrade
                          </Button>
                        )}
                        <Button variant="ghost" onClick={() => void toggle(m.id, !(m.enabled ?? true))} data-testid={`mod-toggle-${m.id}`} aria-label={m.enabled === false ? `Enable ${m.id}` : `Disable ${m.id}`}>
                          {m.enabled === false ? <Power size={14} aria-hidden /> : <PowerOff size={14} aria-hidden />}
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete((cur) => (cur === m.id ? null : m.id))} data-testid={`mod-uninstall-${m.id}`} aria-label={`Uninstall ${m.id}`}>
                          <Trash2 size={14} aria-hidden />
                        </Button>
                      </Inline>
                    </Inline>
                    {isConfirming && (
                      <Inline gap={1} style={{ marginTop: 'var(--space-1)' }}>
                        <Button variant="danger" onClick={() => void drop(m.id)} data-testid={`mod-confirm-uninstall-${m.id}`}>
                          Confirm uninstall
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                      </Inline>
                    )}
                  </div>
                );
              })}
            </Stack>
          )}
        </CardBody>
      </Card>

      <Card variant="default">
        <CardBody>
          <strong style={{ fontSize: 'var(--fs-13)' }}>Registry</strong>
          {registryPayload.loading && registryMods.length === 0 ? (
            <Stack gap={1} style={{ marginTop: 'var(--space-2)' }}>
              <Skeleton style={{ height: 40 }} />
            </Stack>
          ) : registryMods.length === 0 ? (
            <EmptyState icon={<Download size={28} aria-hidden />} title="Registry unreachable" description="Cannot reach the public mod registry right now." />
          ) : (
            <Stack gap={1} style={{ marginTop: 'var(--space-2)' }}>
              {registryMods.slice(0, 30).map((m) => (
                <div
                  key={m.id}
                  data-testid={`mod-registry-row-${m.id}`}
                  style={{
                    padding: 'var(--space-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 'var(--space-2)',
                  }}
                >
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Inline align="center" gap={2}>
                      <strong>{m.name || m.id}</strong>
                      <code style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{m.id}</code>
                      <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>v{m.latest}</span>
                      {m.installed && <span style={{ fontSize: 'var(--fs-11)', color: 'var(--success)' }}>installed</span>}
                    </Inline>
                    {m.description && (
                      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{m.description}</span>
                    )}
                  </Stack>
                  {!m.installed && (
                    <Button variant="ghost" onClick={async () => {
                      setError(null);
                      try {
                        await fetchJson('/api/mods', { method: 'POST', body: { id: m.id } });
                        refresh();
                      } catch (err) {
                        setError(err instanceof FetchError ? err.message : (err as Error).message);
                      }
                    }} data-testid={`mod-registry-install-${m.id}`}>
                      <Download size={14} aria-hidden /> Install
                    </Button>
                  )}
                </div>
              ))}
            </Stack>
          )}
        </CardBody>
      </Card>

      <Sheet open={installing} onOpenChange={setInstalling}>
        <SheetContent side="right" title="Install mod" description="From registry id or local path.">
          <InstallForm
            onSubmit={async (body) => {
              await fetchJson('/api/mods', { method: 'POST', body });
              setInstalling(false);
              refresh();
            }}
            onCancel={() => setInstalling(false)}
          />
        </SheetContent>
      </Sheet>
    </Stack>
  );
}

function InstallForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (body: { id?: string; path?: string }) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [mode, setMode] = useState<'registry' | 'path'>('registry');
  const [value, setValue] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Stack gap={3} style={{ padding: 'var(--space-4)' }}>
      <Inline gap={1} role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'registry'} onClick={() => setMode('registry')} data-testid="mod-install-mode-registry"
          style={{ padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: mode === 'registry' ? 'var(--accent-soft)' : 'var(--surface-0)', color: mode === 'registry' ? 'var(--accent)' : 'var(--fg-muted)', fontSize: 'var(--fs-12)', cursor: 'pointer' }}>
          Registry id
        </button>
        <button type="button" role="tab" aria-selected={mode === 'path'} onClick={() => setMode('path')} data-testid="mod-install-mode-path"
          style={{ padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: mode === 'path' ? 'var(--accent-soft)' : 'var(--surface-0)', color: mode === 'path' ? 'var(--accent)' : 'var(--fg-muted)', fontSize: 'var(--fs-12)', cursor: 'pointer' }}>
          Local path
        </button>
      </Inline>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          {mode === 'registry' ? 'Registry id (e.g. @bizar/mod-foo)' : 'Local path (e.g. /abs/path/to/mod)'}
        </span>
        <Input
          value={value}
          onChange={(e) => setValue((e.target as HTMLInputElement).value)}
          placeholder={mode === 'registry' ? '@org/mod-name' : '/abs/path/to/mod'}
          data-testid="mod-install-input"
        />
      </label>
      {error !== null && (
        <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>
      )}
      <Inline justify="end" gap={2}>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy || !value.trim()}
          data-testid="mod-install-submit"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const body = mode === 'registry' ? { id: value.trim() } : { path: value.trim() };
              await onSubmit(body);
            } catch (err) {
              setError(err instanceof FetchError ? err.message : (err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Upload size={14} aria-hidden /> {busy ? 'Installing…' : 'Install'}
        </Button>
      </Inline>
    </Stack>
  );
}