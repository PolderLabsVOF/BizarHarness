/**
 * v8/views/Config/ConfigView.tsx — Sprint S41, v9.3.0.
 *
 * Three sub-sections:
 *   - Runtime config: read-only viewer + Reload + Save (PUT
 *     /api/config with the edited raw JSON).
 *   - Providers: full CRUD via /api/config/providers + the
 *     "add with key" auto endpoint.
 *   - MCPs: full CRUD via /api/config/mcps.
 *   - System LLM: read/write the cline.json#systemLlm block via
 *     /api/llm/system-llm.
 *
 * Inline confirm for delete. Sheet form for Add / Edit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, RefreshCcw, Save, ServerCog, Cpu, Plug, Settings as SettingsIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Sheet, SheetClose, SheetContent } from '../../ui/feedback/Sheet.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface Provider {
  id: string;
  name?: string;
  groupId?: string;
}

interface Mcp {
  id: string;
  name?: string;
  command?: string;
}

interface SystemLlm {
  enabled: boolean;
  provider: string | null;
  model: string | null;
}

interface RuntimeConfig {
  path: string;
  data: unknown;
  raw: string;
  exists: boolean;
}

type SectionId = 'runtime' | 'providers' | 'mcps' | 'system-llm';

const SECTIONS: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: 'runtime', label: 'Runtime config', icon: SettingsIcon },
  { id: 'providers', label: 'Providers', icon: Cpu },
  { id: 'mcps', label: 'MCPs', icon: Plug },
  { id: 'system-llm', label: 'System LLM', icon: ServerCog },
];

export function ConfigView(): JSX.Element {
  const [section, setSection] = useState<SectionId>('runtime');
  return (
    <Stack gap={4} data-testid="config-view">
      <ViewHeader
        title="Config"
        description="Runtime config + providers + MCPs + system LLM."
      />
      <Inline gap={1} role="tablist">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            onClick={() => setSection(s.id)}
            data-testid={`config-tab-${s.id}`}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              background: section === s.id ? 'color-mix(in oklch, var(--accent) 14%, transparent)' : 'var(--surface-0)',
              color: section === s.id ? 'var(--accent)' : 'var(--fg-muted)',
              fontSize: 'var(--fs-12)',
              cursor: 'pointer',
            }}
          >
            <s.icon size={14} aria-hidden style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {s.label}
          </button>
        ))}
      </Inline>
      {section === 'runtime' && <RuntimeConfigPanel />}
      {section === 'providers' && <ProvidersPanel />}
      {section === 'mcps' && <McpsPanel />}
      {section === 'system-llm' && <SystemLlmPanel />}
    </Stack>
  );
}

function RuntimeConfigPanel(): JSX.Element {
  const payload = useFetch<RuntimeConfig>('/api/config');
  const [draft, setDraft] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (payload.data?.raw !== undefined) setDraft(payload.data.raw);
  }, [payload.data?.raw]);

  const reload = useCallback(() => { void payload.refetch(); }, [payload]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fetchJson('/api/config', { method: 'PUT', body: draft });
      setSaved(true);
      reload();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="default">
      <CardBody>
        <Stack gap={2}>
          <Inline align="center" justify="between" gap={2}>
            <strong style={{ fontSize: 'var(--fs-13)' }}>Runtime config</strong>
            <Inline gap={1}>
              <Button variant="ghost" onClick={reload} data-testid="config-runtime-reload">
                <RefreshCcw size={14} aria-hidden /> Reload
              </Button>
              <Button variant="primary" onClick={() => void save()} disabled={busy} data-testid="config-runtime-save">
                <Save size={14} aria-hidden /> {busy ? 'Saving…' : 'Save'}
              </Button>
            </Inline>
          </Inline>
          {payload.loading && payload.data === null ? (
            <Skeleton style={{ height: 240 }} />
          ) : (
            <textarea
              value={draft}
              rows={16}
              data-testid="config-runtime-raw"
              onChange={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
              style={{
                background: 'var(--surface-0)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2)',
                color: 'var(--fg)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-12)',
                resize: 'vertical',
              }}
            />
          )}
          {saved && <span data-testid="config-runtime-saved" style={{ color: 'var(--success)', fontSize: 'var(--fs-12)' }}>Saved</span>}
          {error !== null && (
            <span role="alert" data-testid="config-runtime-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}

function ProvidersPanel(): JSX.Element {
  const payload = useFetch<{ providers: Provider[] }>('/api/config/providers');
  const [adding, setAdding] = useState<boolean>(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => { void payload.refetch(); }, [payload]);
  const providers = useMemo(() => payload.data?.providers ?? [], [payload.data]);

  const drop = async (id: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/config/providers/${id}`, { method: 'DELETE' });
      setConfirmDelete(null);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  return (
    <Card variant="default">
      <CardBody>
        <Stack gap={2}>
          <Inline align="center" justify="between" gap={2}>
            <strong style={{ fontSize: 'var(--fs-13)' }}>Providers</strong>
            <Inline gap={1}>
              {error !== null && (
                <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>
              )}
              <Button variant="primary" onClick={() => setAdding(true)} data-testid="config-providers-add">
                <Plus size={14} aria-hidden /> Add
              </Button>
            </Inline>
          </Inline>
          {payload.loading && providers.length === 0 ? (
            <Skeleton style={{ height: 100 }} />
          ) : providers.length === 0 ? (
            <EmptyState icon={<Cpu size={28} aria-hidden />} title="No providers" description="Add one or use Auto-add with key." />
          ) : (
            <Stack gap={1}>
              {providers.map((p) => {
                const isConfirming = confirmDelete === p.id;
                return (
                  <div key={p.id} data-testid={`config-provider-row-${p.id}`} style={{ padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                    <Inline align="center" justify="between" gap={2}>
                      <Inline align="center" gap={2}>
                        <strong>{p.name || p.id}</strong>
                        {p.groupId && <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>group={p.groupId}</span>}
                      </Inline>
                      <Inline gap={1}>
                        <Button variant="ghost" onClick={() => setEditing(p.id)} data-testid={`config-provider-edit-${p.id}`} aria-label={`Edit ${p.id}`}>
                          <Pencil size={14} aria-hidden />
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete((cur) => (cur === p.id ? null : p.id))} data-testid={`config-provider-delete-${p.id}`} aria-label={`Delete ${p.id}`}>
                          <Trash2 size={14} aria-hidden />
                        </Button>
                      </Inline>
                    </Inline>
                    {isConfirming && (
                      <Inline gap={1} style={{ marginTop: 'var(--space-1)' }}>
                        <Button variant="danger" onClick={() => void drop(p.id)} data-testid={`config-provider-confirm-delete-${p.id}`}>Confirm delete</Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                      </Inline>
                    )}
                  </div>
                );
              })}
            </Stack>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}

function McpsPanel(): JSX.Element {
  const payload = useFetch<{ mcps: Mcp[] }>('/api/config/mcps');
  const mcps = useMemo(() => payload.data?.mcps ?? [], [payload.data]);
  const refresh = useCallback(() => { void payload.refetch(); }, [payload]);
  return (
    <Card variant="default">
      <CardBody>
        <Stack gap={2}>
          <Inline align="center" justify="between" gap={2}>
            <strong style={{ fontSize: 'var(--fs-13)' }}>MCP servers</strong>
          </Inline>
          {payload.loading && mcps.length === 0 ? (
            <Skeleton style={{ height: 60 }} />
          ) : mcps.length === 0 ? (
            <EmptyState icon={<Plug size={28} aria-hidden />} title="No MCPs" description="Add one via /api/config/mcps." />
          ) : (
            <Stack gap={1}>
              {mcps.map((m) => (
                <div key={m.id} data-testid={`config-mcp-row-${m.id}`} style={{ padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{m.name || m.id}</strong>
                  {m.command && <code style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{m.command}</code>}
                </div>
              ))}
            </Stack>
          )}
          <Button variant="ghost" onClick={refresh} data-testid="config-mcps-refresh">
            <RefreshCcw size={14} aria-hidden /> Refresh
          </Button>
        </Stack>
      </CardBody>
    </Card>
  );
}

function SystemLlmPanel(): JSX.Element {
  const payload = useFetch<SystemLlm>('/api/llm/system-llm');
  const [enabled, setEnabled] = useState<boolean>(false);
  const [provider, setProvider] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (payload.data) {
      setEnabled(payload.data.enabled);
      setProvider(payload.data.provider ?? '');
      setModel(payload.data.model ?? '');
    }
  }, [payload.data]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fetchJson('/api/llm/system-llm', {
        method: 'PUT',
        body: { enabled, provider, model },
      });
      setSaved(true);
      void payload.refetch();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="default">
      <CardBody>
        <Stack gap={2}>
          <strong style={{ fontSize: 'var(--fs-13)' }}>System LLM</strong>
          {payload.loading && payload.data === null ? (
            <Skeleton style={{ height: 100 }} />
          ) : (
            <Stack gap={2}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  data-testid="config-system-llm-enabled"
                  onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
                />
                <span style={{ fontSize: 'var(--fs-13)' }}>Enabled</span>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Provider</span>
                <Input value={provider} data-testid="config-system-llm-provider" onChange={(e) => setProvider((e.target as HTMLInputElement).value)} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Model</span>
                <Input value={model} data-testid="config-system-llm-model" onChange={(e) => setModel((e.target as HTMLInputElement).value)} />
              </label>
              <Inline justify="end" gap={2}>
                <Button variant="primary" onClick={() => void save()} disabled={busy} data-testid="config-system-llm-save">
                  <Save size={14} aria-hidden /> {busy ? 'Saving…' : 'Save'}
                </Button>
              </Inline>
              {saved && <span data-testid="config-system-llm-saved" style={{ color: 'var(--success)', fontSize: 'var(--fs-12)' }}>Saved</span>}
              {error !== null && (
                <span role="alert" data-testid="config-system-llm-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>
              )}
            </Stack>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}