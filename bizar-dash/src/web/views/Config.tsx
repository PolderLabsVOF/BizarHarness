// src/views/Config.tsx — v3.4.0: sidebar nav + fully editable providers/MCPs.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Settings2,
  Sliders,
  RefreshCw,
  Save,
  FileCode2,
  Stethoscope,
  Server as ServerIcon,
  Plug,
  Plus,
  Trash2,
  Pencil,
  Download,
  Activity,
  Wrench,
  Database,
  History as HistoryIcon,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { api } from '../lib/api';
import { cn, debounce, hashText } from '../lib/utils';
import { JsonHighlight } from '../lib/markdown';
import type {
  ConfigResponse,
  Diagnostics,
  McpServer,
  Provider,
  Settings,
  Snapshot,
} from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type NavId = 'opencode' | 'providers' | 'mcps' | 'diagnostics' | 'export';

const NAV_ITEMS: { id: NavId; label: string; icon: typeof Settings2; desc: string }[] = [
  { id: 'opencode', label: 'OpenCode config', icon: FileCode2, desc: 'Edit opencode.json directly' },
  { id: 'providers', label: 'Providers', icon: ServerIcon, desc: 'AI providers + API keys' },
  { id: 'mcps', label: 'MCPs', icon: Plug, desc: 'Model Context Protocol servers' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Stethoscope, desc: 'Service health + counts' },
  { id: 'export', label: 'Export / Import', icon: Download, desc: 'Download diagnostics bundle' },
];

export function Config({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const initial: ConfigResponse | undefined = snapshot.config;
  const [activeNav, setActiveNav] = useState<NavId>('opencode');

  // OpenCode editor state
  const [original, setOriginal] = useState<string>(
    initial?.raw || (initial?.data ? JSON.stringify(initial.data, null, 2) : ''),
  );
  const [parsed, setParsed] = useState({
    raw: initial?.raw || '',
    data: initial?.data ?? null,
    error: null as string | null,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [path, setPath] = useState<string>(initial?.path || '');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Diagnostics state
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  // Providers + MCPs state — re-fetch when nav switches so we always have fresh data.
  const [providers, setProviders] = useState<Provider[]>(snapshot.providers || []);
  const [mcps, setMcps] = useState<McpServer[]>(snapshot.mcps || []);

  const originalHash = useMemo(() => hashText(original), [original]);

  useEffect(() => {
    if (snapshot.providers) setProviders(snapshot.providers);
    if (snapshot.mcps) setMcps(snapshot.mcps);
  }, [snapshot.providers, snapshot.mcps]);

  const reloadConfig = async () => {
    try {
      const d = await api.post<ConfigResponse>('/config/reload');
      const raw = d.raw || (d.data ? JSON.stringify(d.data, null, 2) : '');
      setOriginal(raw);
      setParsed({ raw, data: d.data ?? null, error: null });
      setDirty(false);
      setPath(d.path || '');
      toast.info('Config reloaded.', 1500);
    } catch (err) {
      toast.error(`Reload failed: ${(err as Error).message}`);
    }
  };

  const reloadProviders = async () => {
    try {
      const r = await api.get<{ providers: Provider[] }>('/config/providers');
      setProviders(r.providers || []);
    } catch (err) {
      toast.error(`Providers load failed: ${(err as Error).message}`);
    }
  };

  const reloadMcps = async () => {
    try {
      const r = await api.get<{ mcps: McpServer[] }>('/config/mcps');
      setMcps(r.mcps || []);
    } catch (err) {
      toast.error(`MCPs load failed: ${(err as Error).message}`);
    }
  };

  // Reload data when nav changes so each panel shows fresh server data.
  useEffect(() => {
    if (activeNav === 'providers' && providers.length === 0) reloadProviders();
    if (activeNav === 'mcps' && mcps.length === 0) reloadMcps();
    if (activeNav === 'diagnostics' && !diagnostics) loadDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNav]);

  const applyEdit = (val: string) => {
    setParsed((cur) => {
      const next: typeof parsed = { raw: val, data: cur.data, error: null };
      try {
        next.data = JSON.parse(val);
        next.error = null;
      } catch (e) {
        next.data = null;
        next.error = (e as Error).message;
      }
      return next;
    });
    onChangeDebounced(val);
  };

  const onChangeDebounced = useMemo(
    () =>
      debounce((val: string) => {
        setDirty(hashText(val) !== originalHash);
      }, 100),
    [originalHash],
  );

  const save = async () => {
    if (!parsed.data || parsed.error || saving) return;
    setSaving(true);
    try {
      const result = await api.put<ConfigResponse>('/config', parsed.data);
      const raw = result.raw || JSON.stringify(result.data, null, 2);
      setOriginal(raw);
      setParsed({ raw, data: result.data ?? null, error: null });
      setDirty(false);
      toast.success('Config saved.');
      await refreshSnapshot();
      // Re-fetch providers + MCPs because config may have changed.
      await reloadProviders();
      await reloadMcps();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const loadDiagnostics = async () => {
    try {
      const d = await api.get<Diagnostics>('/diagnostics');
      setDiagnostics(d);
    } catch (err) {
      toast.error(`Diagnostics load failed: ${(err as Error).message}`);
    }
  };

  const onDownloadDiagnostics = () => {
    const bundle = {
      generatedAt: new Date().toISOString(),
      diagnostics,
      config: parsed.data,
      opencodeJsonPath: path,
      providers,
      mcps,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bizar-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Bundle downloaded.');
  };

  return (
    <div className="view view-config">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Settings2 size={18} /> Config
          </h2>
          <p className="view-subtitle">
            Manage OpenCode config, providers, MCPs, and diagnostics.
          </p>
        </div>
      </header>

      <div className="config-layout">
        <nav className="config-nav" role="navigation" aria-label="Config sections">
          {NAV_ITEMS.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                type="button"
                className={cn('config-nav-item', activeNav === n.id && 'config-nav-item-active')}
                onClick={() => setActiveNav(n.id)}
                aria-current={activeNav === n.id ? 'page' : undefined}
              >
                <Icon size={14} />
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span>{n.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 400 }}>
                    {n.desc}
                  </span>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="config-content">
          {activeNav === 'opencode' && (
            <ConfigEditorPanel
              parsed={parsed}
              dirty={dirty}
              saving={saving}
              path={path}
              onReload={reloadConfig}
              onSave={save}
              onChange={applyEdit}
              textareaRef={taRef}
            />
          )}

          {activeNav === 'providers' && (
            <ProvidersPanel providers={providers} onChange={setProviders} onReload={reloadProviders} />
          )}

          {activeNav === 'mcps' && (
            <McpsPanel mcps={mcps} onChange={setMcps} onReload={reloadMcps} />
          )}

          {activeNav === 'diagnostics' && (
            <DiagnosticsPanel diagnostics={diagnostics} loading={!diagnostics} onReload={loadDiagnostics} />
          )}

          {activeNav === 'export' && (
            <ExportPanel onDownload={onDownloadDiagnostics} />
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigEditorPanel({
  parsed,
  dirty,
  saving,
  path,
  onReload,
  onSave,
  onChange,
  textareaRef,
}: {
  parsed: { raw: string; data: unknown; error: string | null };
  dirty: boolean;
  saving: boolean;
  path: string;
  onReload: () => void;
  onSave: () => void;
  onChange: (val: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  return (
    <Card>
      <CardTitle>
        <FileCode2 size={14} /> OpenCode config
      </CardTitle>
      <CardMeta>
        <code className="mono ellipsis" style={{ fontSize: 11 }}>
          {path || '~/.config/opencode/opencode.json'}
        </code>
      </CardMeta>
      <div className="view-actions" style={{ marginBottom: 12 }}>
        <Button variant="secondary" size="sm" onClick={onReload}>
          <RefreshCw size={14} /> Reload from disk
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!parsed.data || !!parsed.error || !dirty}
          onClick={onSave}
        >
          {saving ? <span className="btn-spinner" /> : <Save size={14} />}
          Save
        </Button>
      </div>
      <div className="config-grid">
        <div>
          <div className="config-grid-label">JSON tree</div>
          <div className="json-tree">
            {parsed.data != null ? (
              <JsonHighlight value={parsed.data} />
            ) : (
              <span className="muted">{parsed.error ? 'Invalid JSON' : 'No data'}</span>
            )}
          </div>
        </div>
        <div>
          <div className="config-grid-label">
            Raw JSON
            {parsed.error ? (
              <span className="text-error" style={{ marginLeft: 8 }}>{parsed.error}</span>
            ) : (
              <span className="muted" style={{ marginLeft: 8 }}>Live validation</span>
            )}
          </div>
          <textarea
            ref={textareaRef}
            className={cn('textarea config-textarea', parsed.error && 'invalid')}
            spellCheck={false}
            value={parsed.raw}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
    </Card>
  );
}

function DiagnosticsPanel({
  diagnostics,
  loading,
  onReload,
}: {
  diagnostics: Diagnostics | null;
  loading: boolean;
  onReload: () => void;
}) {
  return (
    <Card>
      <CardTitle>
        <Stethoscope size={14} /> Diagnostics
      </CardTitle>
      <CardMeta>
        System health, file counts, recent errors.{' '}
        <button type="button" className="link-btn" onClick={onReload}>Refresh</button>
      </CardMeta>
      {loading && <p className="muted">Loading diagnostics…</p>}
      {diagnostics && (
        <>
          <div className="diagnostics-grid">
            <div className="diagnostic-tile">
              <div className="diagnostic-tile-label">Version</div>
              <div className="diagnostic-tile-value mono">{diagnostics.version}</div>
            </div>
            <div className="diagnostic-tile">
              <div className="diagnostic-tile-label">Uptime</div>
              <div className="diagnostic-tile-value mono">{diagnostics.uptime}s</div>
            </div>
            <div className="diagnostic-tile">
              <div className="diagnostic-tile-label">Node</div>
              <div className="diagnostic-tile-value mono">{diagnostics.nodeVersion}</div>
            </div>
            <div className="diagnostic-tile">
              <div className="diagnostic-tile-label">Platform</div>
              <div className="diagnostic-tile-value mono">{diagnostics.platform}</div>
            </div>
            <div className="diagnostic-tile">
              <div className="diagnostic-tile-label">Memory (heap)</div>
              <div className="diagnostic-tile-value mono">
                {Math.round(diagnostics.memory.heapUsed / 1024 / 1024)}MB
              </div>
            </div>
            <div className="diagnostic-tile">
              <div className="diagnostic-tile-label">Memory (RSS)</div>
              <div className="diagnostic-tile-value mono">
                {Math.round(diagnostics.memory.rss / 1024 / 1024)}MB
              </div>
            </div>
            <div className="diagnostic-tile">
              <div className="diagnostic-tile-label">Service</div>
              <div className="diagnostic-tile-value">
                {diagnostics.service.running ? (
                  <span className="tag tag-success">running (pid {diagnostics.service.pid})</span>
                ) : (
                  <span className="tag tag-neutral">stopped</span>
                )}
              </div>
            </div>
            <div className="diagnostic-tile">
              <div className="diagnostic-tile-label">Active project</div>
              <div className="diagnostic-tile-value mono">
                {diagnostics.counts.activeProject || '—'}
              </div>
            </div>
          </div>
          <div className="diagnostic-counts">
            <span>agents: <strong>{diagnostics.counts.agents}</strong></span>
            <span>projects: <strong>{diagnostics.counts.projects}</strong></span>
            <span>mods: <strong>{diagnostics.counts.mods}</strong></span>
            <span>schedules: <strong>{diagnostics.counts.schedules}</strong></span>
            <span>tasks: <strong>{diagnostics.counts.tasks}</strong></span>
            <span>providers: <strong>{diagnostics.counts.providers}</strong></span>
            <span>mcps: <strong>{diagnostics.counts.mcps}</strong></span>
          </div>
          <div className="diagnostic-errors">
            <div className="muted">Last {diagnostics.errors.length} errors from service.log</div>
            {diagnostics.errors.length === 0 ? (
              <p className="muted">No errors recorded.</p>
            ) : (
              <ul>
                {diagnostics.errors.map((e, i) => (
                  <li key={i} className="mono">
                    {e.ts && <span className="muted">[{e.ts}] </span>}
                    {e.line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/* ──────────────────────────────────────────────────────────────
   Providers Panel — fully editable with proper modal forms.
   ────────────────────────────────────────────────────────────── */

type ProviderDraft = {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  models: string[];
  enabled: boolean;
};

function ProvidersPanel({
  providers,
  onChange,
  onReload,
}: {
  providers: Provider[];
  onChange: (p: Provider[]) => void;
  onReload: () => Promise<void>;
}) {
  const toast = useToast();
  const modal = useModal();

  const openProviderModal = (existing?: Provider) => {
    let idEl: HTMLInputElement | null = null;
    let nameEl: HTMLInputElement | null = null;
    let baseEl: HTMLInputElement | null = null;
    let keyEl: HTMLInputElement | null = null;
    let modelsEl: HTMLInputElement | null = null;
    let enabledEl: HTMLInputElement | null = null;

    const isEdit = !!existing;
    const initialId = existing?.id || '';
    const initialName = existing?.name || '';
    const initialBase = existing?.baseURL || '';
    // Show masked key as-is in edit mode (so user can see what's stored).
    const initialKey = existing?.apiKey || '';
    const initialModels = (existing?.models || []).join(', ');
    const initialEnabled = existing?.enabled !== false;

    modal.open({
      title: isEdit ? `Edit provider "${existing!.id}"` : 'Add provider',
      children: (
        <div>
          <div className="modal-form-row">
            <label>ID (a-z, 0-9, dashes)</label>
            <input
              ref={(el) => (idEl = el)}
              className="input"
              type="text"
              defaultValue={initialId}
              placeholder="anthropic"
              disabled={isEdit}
            />
          </div>
          <div className="modal-form-row">
            <label>Display name</label>
            <input
              ref={(el) => (nameEl = el)}
              className="input"
              type="text"
              defaultValue={initialName}
              placeholder="Anthropic"
            />
          </div>
          <div className="modal-form-row">
            <label>Base URL</label>
            <input
              ref={(el) => (baseEl = el)}
              className="input"
              type="text"
              defaultValue={initialBase}
              placeholder="https://api.anthropic.com"
            />
          </div>
          <div className="modal-form-row">
            <label>API key{isEdit && ' (leave masked value unchanged to keep)'}</label>
            <input
              ref={(el) => (keyEl = el)}
              className="input"
              type="password"
              defaultValue={initialKey}
              placeholder="sk-..."
              autoComplete="off"
            />
          </div>
          <div className="modal-form-row">
            <label>Models (comma-separated)</label>
            <textarea
              ref={(el) => (modelsEl = el as unknown as HTMLInputElement)}
              className="textarea"
              defaultValue={initialModels}
              placeholder="claude-sonnet-4-5, claude-opus-4-1"
              rows={3}
            />
          </div>
          <div className="modal-form-row">
            <label className="checkbox-row">
              <input
                ref={(el) => (enabledEl = el)}
                type="checkbox"
                defaultChecked={initialEnabled}
              />
              Enabled
            </label>
          </div>
        </div>
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const id = (idEl?.value || '').trim();
              const name = (nameEl?.value || '').trim();
              const baseURL = (baseEl?.value || '').trim();
              const apiKey = keyEl?.value || '';
              const modelsRaw = modelsEl?.value || '';
              const models = modelsRaw.split(/[,\n]/).map((m) => m.trim()).filter(Boolean);
              const enabled = !!enabledEl?.checked;

              if (!id) {
                toast.warning('ID is required.');
                return;
              }
              if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) {
                toast.warning('ID must be a-z, 0-9, dashes.');
                return;
              }
              try {
                const payload: ProviderDraft & { id: string } = {
                  id,
                  name: name || id,
                  baseURL,
                  apiKey,
                  models,
                  enabled,
                };
                if (isEdit) {
                  const updated = await api.put<Provider>(
                    `/config/providers/${encodeURIComponent(id)}`,
                    payload,
                  );
                  onChange(providers.map((p) => (p.id === id ? updated : p)));
                  toast.success(`Provider "${id}" updated.`);
                } else {
                  const created = await api.post<Provider>('/config/providers', payload);
                  onChange([...providers, created]);
                  toast.success(`Provider "${id}" added.`);
                }
                modal.close();
              } catch (err) {
                toast.error(`Save failed: ${(err as Error).message}`);
              }
            }}
          >
            {isEdit ? 'Update' : 'Add'} provider
          </Button>
        </div>
      ),
    });
  };

  const onRemove = async (id: string) => {
    if (!confirm(`Remove provider "${id}"?`)) return;
    try {
      await api.del(`/config/providers/${encodeURIComponent(id)}`);
      onChange(providers.filter((p) => p.id !== id));
      toast.success('Provider removed.');
    } catch (err) {
      toast.error(`Remove failed: ${(err as Error).message}`);
    }
  };

  return (
    <Card>
      <CardTitle>
        <ServerIcon size={14} /> Providers ({providers.length})
      </CardTitle>
      <CardMeta>
        AI providers configured under <code>opencode.json#provider</code>.
        Each provider has a base URL, API key, and a list of model IDs.
      </CardMeta>
      <div className="view-actions" style={{ marginBottom: 12 }}>
        <Button variant="primary" size="sm" onClick={() => openProviderModal()}>
          <Plus size={14} /> Add provider
        </Button>
        <Button variant="ghost" size="sm" onClick={onReload}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>
      {providers.length === 0 ? (
        <EmptyProviders onAdd={() => openProviderModal()} />
      ) : (
        <div className="provider-list">
          {providers.map((p) => (
            <Card key={p.id} className="provider-row">
              <div className="provider-row-head">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="provider-name">{p.name || p.id}</div>
                  <div className="provider-id">{p.id}</div>
                </div>
                <div className="provider-actions">
                  <label className="toggle-row" title="Enabled">
                    <input
                      type="checkbox"
                      checked={p.enabled !== false}
                      onChange={async (e) => {
                        try {
                          const updated = await api.put<Provider>(
                            `/config/providers/${encodeURIComponent(p.id)}`,
                            { enabled: e.target.checked },
                          );
                          onChange(providers.map((x) => (x.id === p.id ? updated : x)));
                        } catch (err) {
                          toast.error(`Toggle failed: ${(err as Error).message}`);
                        }
                      }}
                    />
                    {p.enabled !== false ? 'on' : 'off'}
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Edit"
                    title="Edit"
                    onClick={() => openProviderModal(p)}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    aria-label="Remove"
                    title="Remove"
                    onClick={() => onRemove(p.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="provider-meta">
                <div><span className="muted">Base URL:</span> <code>{p.baseURL || '—'}</code></div>
                <div><span className="muted">API key:</span> <code>{p.apiKey || '—'}</code></div>
                <div><span className="muted">Models:</span> {(p.models || []).join(', ') || '—'}</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}

function EmptyProviders({ onAdd }: { onAdd: () => void }) {
  return (
    <div style={{
      padding: '32px 16px',
      textAlign: 'center',
      color: 'var(--text-dim)',
      border: '1px dashed var(--border)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      alignItems: 'center',
    }}>
      <ServerIcon size={28} />
      <div>No providers configured.</div>
      <div style={{ fontSize: 12 }}>Add a provider to connect an AI model.</div>
      <Button variant="primary" size="sm" onClick={onAdd}>
        <Plus size={14} /> Add your first provider
      </Button>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   MCPs Panel — fully editable with proper modal forms.
   ────────────────────────────────────────────────────────────── */

type McpDraft = {
  id: string;
  type: 'local' | 'remote';
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  oauth: boolean;
  enabled: boolean;
};

function parseEnv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function McpsPanel({
  mcps,
  onChange,
  onReload,
}: {
  mcps: McpServer[];
  onChange: (m: McpServer[]) => void;
  onReload: () => Promise<void>;
}) {
  const toast = useToast();
  const modal = useModal();

  const openMcpModal = (existing?: McpServer) => {
    let idEl: HTMLInputElement | null = null;
    let typeLocalEl: HTMLInputElement | null = null;
    let typeRemoteEl: HTMLInputElement | null = null;
    let commandEl: HTMLInputElement | null = null;
    let argsEl: HTMLInputElement | null = null;
    let envEl: HTMLTextAreaElement | null = null;
    let urlEl: HTMLInputElement | null = null;
    let headersEl: HTMLTextAreaElement | null = null;
    let oauthEl: HTMLInputElement | null = null;
    let enabledEl: HTMLInputElement | null = null;

    const isEdit = !!existing;
    const isRemote = existing?.type === 'remote' || (!existing && false);
    const initialType: 'local' | 'remote' = existing?.type === 'remote' ? 'remote' : 'local';
    const initialCommand = existing?.command || '';
    const initialArgs = (existing?.args || []).join(' ');
    const initialEnv = existing?.env ? Object.entries(existing.env).map(([k, v]) => `${k}=${v}`).join('\n') : '';
    const initialUrl = existing?.url || '';
    const initialHeaders = existing?.headers ? Object.entries(existing.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
    const initialOauth = !!existing?.oauth;
    const initialEnabled = existing?.enabled !== false;

    modal.open({
      title: isEdit ? `Edit MCP "${existing!.id}"` : 'Add MCP',
      children: (
        <div>
          <div className="modal-form-row">
            <label>ID (a-z, 0-9, dashes)</label>
            <input
              ref={(el) => (idEl = el)}
              className="input"
              type="text"
              defaultValue={existing?.id || ''}
              placeholder="supabase"
              disabled={isEdit}
            />
          </div>
          <div className="modal-form-row">
            <label>Type</label>
            <div style={{ display: 'flex', gap: 12 }}>
              <label className="radio-label">
                <input
                  ref={(el) => (typeLocalEl = el)}
                  type="radio"
                  name="mcp-type"
                  value="local"
                  defaultChecked={initialType === 'local'}
                />
                Local (stdio)
              </label>
              <label className="radio-label">
                <input
                  ref={(el) => (typeRemoteEl = el)}
                  type="radio"
                  name="mcp-type"
                  value="remote"
                  defaultChecked={initialType === 'remote'}
                />
                Remote (HTTP)
              </label>
            </div>
          </div>

          <div data-mcp-section="local">
            <div className="modal-form-row">
              <label>Command (binary to invoke)</label>
              <input
                ref={(el) => (commandEl = el)}
                className="input"
                type="text"
                defaultValue={initialCommand}
                placeholder="uvx --from semble[mcp] semble"
              />
            </div>
            <div className="modal-form-row">
              <label>Extra args (space-separated)</label>
              <input
                ref={(el) => (argsEl = el)}
                className="input"
                type="text"
                defaultValue={initialArgs}
                placeholder="--port 8080"
              />
              <div className="field-help">These are appended after the command.</div>
            </div>
            <div className="modal-form-row">
              <label>Environment variables</label>
              <textarea
                ref={(el) => (envEl = el)}
                className="textarea"
                defaultValue={initialEnv}
                placeholder="API_KEY=xxx&#10;DEBUG=true"
                rows={3}
              />
              <div className="field-help">One KEY=VALUE per line.</div>
            </div>
          </div>

          <div data-mcp-section="remote">
            <div className="modal-form-row">
              <label>URL</label>
              <input
                ref={(el) => (urlEl = el)}
                className="input"
                type="text"
                defaultValue={initialUrl}
                placeholder="https://mcp.example.com/mcp"
              />
            </div>
            <div className="modal-form-row">
              <label>Headers</label>
              <textarea
                ref={(el) => (headersEl = el)}
                className="textarea"
                defaultValue={initialHeaders}
                placeholder="Authorization: Bearer xxx&#10;Content-Type: application/json"
                rows={3}
              />
              <div className="field-help">One "Key: Value" per line.</div>
            </div>
            <div className="modal-form-row">
              <label className="checkbox-row">
                <input
                  ref={(el) => (oauthEl = el)}
                  type="checkbox"
                  defaultChecked={initialOauth}
                />
                Use OAuth (browser-based auth flow)
              </label>
            </div>
          </div>

          <div className="modal-form-row">
            <label className="checkbox-row">
              <input
                ref={(el) => (enabledEl = el)}
                type="checkbox"
                defaultChecked={initialEnabled}
              />
              Enabled
            </label>
          </div>
        </div>
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const id = (idEl?.value || '').trim();
              const isRemote = !!typeRemoteEl?.checked;
              const command = (commandEl?.value || '').trim();
              const argsStr = (argsEl?.value || '').trim();
              const args = argsStr ? argsStr.split(/\s+/) : [];
              const env = parseEnv(envEl?.value || '');
              const url = (urlEl?.value || '').trim();
              const headers = parseEnv(headersEl?.value || '');
              const oauth = !!oauthEl?.checked;
              const enabled = !!enabledEl?.checked;

              if (!id) {
                toast.warning('ID is required.');
                return;
              }
              if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) {
                toast.warning('ID must be a-z, 0-9, dashes.');
                return;
              }
              try {
                const payload: McpDraft = {
                  id,
                  type: isRemote ? 'remote' : 'local',
                  command,
                  args,
                  env,
                  url,
                  headers,
                  oauth,
                  enabled,
                };
                if (isEdit) {
                  const updated = await api.put<McpServer>(
                    `/config/mcps/${encodeURIComponent(id)}`,
                    payload,
                  );
                  onChange(mcps.map((m) => (m.id === id ? updated : m)));
                  toast.success(`MCP "${id}" updated.`);
                } else {
                  const created = await api.post<McpServer>('/config/mcps', payload);
                  onChange([...mcps, created]);
                  toast.success(`MCP "${id}" added.`);
                }
                modal.close();
              } catch (err) {
                toast.error(`Save failed: ${(err as Error).message}`);
              }
            }}
          >
            {isEdit ? 'Update' : 'Add'} MCP
          </Button>
        </div>
      ),
    });
  };

  const onRemove = async (id: string) => {
    if (!confirm(`Remove MCP "${id}"?`)) return;
    try {
      await api.del(`/config/mcps/${encodeURIComponent(id)}`);
      onChange(mcps.filter((m) => m.id !== id));
      toast.success('MCP removed.');
    } catch (err) {
      toast.error(`Remove failed: ${(err as Error).message}`);
    }
  };

  return (
    <Card>
      <CardTitle>
        <Plug size={14} /> MCPs ({mcps.length})
      </CardTitle>
      <CardMeta>
        Model Context Protocol servers under <code>opencode.json#mcp</code>.
        Local MCPs run as stdio subprocesses; remote MCPs are HTTP endpoints.
      </CardMeta>
      <div className="view-actions" style={{ marginBottom: 12 }}>
        <Button variant="primary" size="sm" onClick={() => openMcpModal()}>
          <Plus size={14} /> Add MCP
        </Button>
        <Button variant="ghost" size="sm" onClick={onReload}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>
      {mcps.length === 0 ? (
        <div style={{
          padding: '32px 16px',
          textAlign: 'center',
          color: 'var(--text-dim)',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: 'center',
        }}>
          <Plug size={28} />
          <div>No MCPs configured.</div>
          <Button variant="primary" size="sm" onClick={() => openMcpModal()}>
            <Plus size={14} /> Add your first MCP
          </Button>
        </div>
      ) : (
        <div className="mcp-list">
          {mcps.map((m) => (
            <Card key={m.id} className="mcp-row">
              <div className="mcp-row-head">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="mcp-name">{m.id}</div>
                  <div className="mcp-id">
                    {m.type === 'remote' ? 'remote' : 'local'} {m.enabled !== false ? '· enabled' : '· disabled'}
                  </div>
                </div>
                <div className="mcp-actions">
                  <label className="toggle-row" title="Enabled">
                    <input
                      type="checkbox"
                      checked={m.enabled !== false}
                      onChange={async (e) => {
                        try {
                          const updated = await api.put<McpServer>(
                            `/config/mcps/${encodeURIComponent(m.id)}`,
                            { enabled: e.target.checked },
                          );
                          onChange(mcps.map((x) => (x.id === m.id ? updated : x)));
                        } catch (err) {
                          toast.error(`Toggle failed: ${(err as Error).message}`);
                        }
                      }}
                    />
                    {m.enabled !== false ? 'on' : 'off'}
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Edit"
                    title="Edit"
                    onClick={() => openMcpModal(m)}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    aria-label="Remove"
                    title="Remove"
                    onClick={() => onRemove(m.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="mcp-meta">
                {m.type === 'remote' ? (
                  <>
                    <div><span className="muted">URL:</span> <code>{m.url || '—'}</code></div>
                    {Object.keys(m.headers || {}).length > 0 && (
                      <div><span className="muted">Headers:</span> <code>{Object.keys(m.headers || {}).length} header(s)</code></div>
                    )}
                    {m.oauth && <div><span className="muted">Auth:</span> <code>OAuth</code></div>}
                  </>
                ) : (
                  <>
                    <div><span className="muted">Command:</span> <code>{m.command || '—'}</code></div>
                    {m.args && m.args.length > 0 && (
                      <div><span className="muted">Args:</span> <code>{m.args.join(' ')}</code></div>
                    )}
                    {m.env && Object.keys(m.env).length > 0 && (
                      <div><span className="muted">Env:</span> <code>{Object.keys(m.env).length} var(s)</code></div>
                    )}
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}

function ExportPanel({ onDownload }: { onDownload: () => void }) {
  return (
    <Card>
      <CardTitle>
        <Download size={14} /> Export / Import
      </CardTitle>
      <CardMeta>
        Download a JSON bundle of diagnostics, configuration, providers, and MCPs
        for support requests or backup. Server-side imports are not yet implemented.
      </CardMeta>
      <div className="view-actions" style={{ marginTop: 12 }}>
        <Button variant="primary" onClick={onDownload}>
          <Download size={14} /> Download diagnostics bundle
        </Button>
      </div>
      <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-dim)' }}>
        <Database size={12} style={{ display: 'inline', verticalAlign: -2 }} /> Bundles include:
        opencode.json snapshot, providers list (with masked API keys), MCP list, recent
        service log errors, and active project metadata.
      </div>
    </Card>
  );
}