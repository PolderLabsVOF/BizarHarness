// src/views/Config.tsx — v3: collapsible Advanced section + Diagnostics + Providers + MCPs.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Settings2,
  RefreshCw,
  Save,
  FileCode2,
  ChevronDown,
  ChevronRight,
  Stethoscope,
  Server as ServerIcon,
  Plug,
  Plus,
  Trash2,
  Download,
  Activity,
  AlertCircle,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { api } from '../lib/api';
import { cn, debounce, hashText, formatRelative } from '../lib/utils';
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

export function Config({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const initial: ConfigResponse | undefined = snapshot.config;
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [providers, setProviders] = useState<Provider[]>(snapshot.providers || []);
  const [mcps, setMcps] = useState<McpServer[]>(snapshot.mcps || []);
  const [activeAdvTab, setActiveAdvTab] = useState<string>('config');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const originalHash = useMemo(() => hashText(original), [original]);

  useEffect(() => {
    if (snapshot.providers) setProviders(snapshot.providers);
    if (snapshot.mcps) setMcps(snapshot.mcps);
  }, [snapshot.providers, snapshot.mcps]);

  const reload = async () => {
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

  const onChange = (val: string) => {
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
  };

  const onChangeDebounced = useMemo(
    () =>
      debounce((val: string) => {
        setDirty(hashText(val) !== originalHash);
      }, 100),
    [originalHash],
  );

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    onChange(v);
    onChangeDebounced(v);
  };

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

  useEffect(() => {
    if (advancedOpen && !diagnostics) {
      loadDiagnostics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancedOpen]);

  const onDownloadDiagnostics = async () => {
    // Build a small bundle on the client
    const bundle = {
      generatedAt: new Date().toISOString(),
      diagnostics,
      config: parsed.data,
      opencodeJsonPath: path,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bizar-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="view view-config">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Settings2 size={18} /> Config
          </h2>
          <p className="view-subtitle">
            Diagnostic snapshot below. The raw <code>opencode.json</code> editor
            is in the Advanced section.
          </p>
        </div>
        <div className="view-actions">
          <Button variant="secondary" size="sm" onClick={loadDiagnostics}>
            <Stethoscope size={14} /> Run diagnostics
          </Button>
          <Button variant="secondary" size="sm" onClick={onDownloadDiagnostics}>
            <Download size={14} /> Download bundle
          </Button>
        </div>
      </header>

      <DiagnosticsPanel diagnostics={diagnostics} loading={!diagnostics} onReload={loadDiagnostics} />

      <Card className="config-advanced">
        <button
          type="button"
          className="config-advanced-head"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <strong>Advanced</strong>
          <span className="muted">— opencode.json editor · providers · MCPs · debug log</span>
        </button>
        {advancedOpen && (
          <div className="config-advanced-body">
            <div className="config-advanced-tabs">
              <button
                type="button"
                className={cn('tab', activeAdvTab === 'config' && 'tab-active')}
                onClick={() => setActiveAdvTab('config')}
              >
                <FileCode2 size={12} /> OpenCode config
              </button>
              <button
                type="button"
                className={cn('tab', activeAdvTab === 'providers' && 'tab-active')}
                onClick={() => setActiveAdvTab('providers')}
              >
                <ServerIcon size={12} /> Providers
              </button>
              <button
                type="button"
                className={cn('tab', activeAdvTab === 'mcps' && 'tab-active')}
                onClick={() => setActiveAdvTab('mcps')}
              >
                <Plug size={12} /> MCPs
              </button>
              <button
                type="button"
                className={cn('tab', activeAdvTab === 'log' && 'tab-active')}
                onClick={() => setActiveAdvTab('log')}
              >
                <Activity size={12} /> Debug log
              </button>
            </div>

            {activeAdvTab === 'config' && (
              <div>
                <div className="view-actions" style={{ marginBottom: 12 }}>
                  <Button variant="secondary" size="sm" onClick={reload}>
                    <RefreshCw size={14} /> Reload from disk
                  </Button>
                  <Button variant="primary" size="sm" disabled={!parsed.data || !!parsed.error || !dirty} onClick={save}>
                    {saving ? <span className="btn-spinner" /> : <Save size={14} />}
                    Save
                  </Button>
                </div>
                <div className="config-grid">
                  <Card>
                    <CardTitle>JSON tree</CardTitle>
                    <CardMeta>Parsed from current editor</CardMeta>
                    <div className="json-tree">
                      {parsed.data != null ? (
                        <JsonHighlight value={parsed.data} />
                      ) : (
                        <span className="muted">{parsed.error ? 'Invalid JSON' : 'No data'}</span>
                      )}
                    </div>
                  </Card>
                  <Card>
                    <CardTitle>Raw JSON</CardTitle>
                    <CardMeta>
                      {parsed.error ? (
                        <span className="text-error">{parsed.error}</span>
                      ) : (
                        <span className="muted">Live validation as you type</span>
                      )}
                    </CardMeta>
                    <textarea
                      ref={taRef}
                      className={cn('textarea config-textarea', parsed.error && 'invalid')}
                      spellCheck={false}
                      value={parsed.raw}
                      onChange={handleInput}
                    />
                  </Card>
                </div>
              </div>
            )}

            {activeAdvTab === 'providers' && (
              <ProvidersPanel
                providers={providers}
                onChange={setProviders}
              />
            )}

            {activeAdvTab === 'mcps' && (
              <McpsPanel
                mcps={mcps}
                onChange={setMcps}
              />
            )}

            {activeAdvTab === 'log' && (
              <DebugLogPanel />
            )}
          </div>
        )}
      </Card>
    </div>
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
    <Card className="diagnostics-card">
      <CardTitle><Stethoscope size={14} /> Diagnostics</CardTitle>
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

function ProvidersPanel({
  providers,
  onChange,
}: {
  providers: Provider[];
  onChange: (p: Provider[]) => void;
}) {
  const toast = useToast();
  const onAdd = () => {
    let idEl: HTMLInputElement | null = null;
    let nameEl: HTMLInputElement | null = null;
    let baseEl: HTMLInputElement | null = null;
    let keyEl: HTMLInputElement | null = null;
    let modelsEl: HTMLInputElement | null = null;
    // Use a modal from useModal — but for simplicity inline a confirm-prompt
    const id = (prompt('Provider id (a-z, 0-9, dashes):') || '').trim();
    if (!id) return;
    if (providers.find((p) => p.id === id)) {
      toast.error(`Provider "${id}" exists.`);
      return;
    }
    const name = prompt('Display name:', id) || id;
    const baseURL = prompt('Base URL:', '') || '';
    const apiKey = prompt('API key:', '') || '';
    const modelsRaw = prompt('Models (comma-separated):', '') || '';
    const models = modelsRaw.split(',').map((m) => m.trim()).filter(Boolean);
    api
      .post<Provider>('/config/providers', { id, name, baseURL, apiKey, models, enabled: true })
      .then((p) => {
        onChange([...providers, p]);
        toast.success('Provider added.');
      })
      .catch((err) => toast.error(`Add failed: ${(err as Error).message}`));
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
    <div>
      <div className="view-actions" style={{ marginBottom: 12 }}>
        <Button variant="primary" size="sm" onClick={onAdd}>
          <Plus size={14} /> Add provider
        </Button>
      </div>
      {providers.length === 0 ? (
        <p className="muted">No providers configured. Add one to register an AI provider.</p>
      ) : (
        <div className="provider-list">
          {providers.map((p) => (
            <Card key={p.id} className="provider-row">
              <div className="provider-row-head">
                <div>
                  <div className="provider-name">{p.name}</div>
                  <div className="provider-id mono">{p.id}</div>
                </div>
                <div className="provider-actions">
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
    </div>
  );
}

function McpsPanel({
  mcps,
  onChange,
}: {
  mcps: McpServer[];
  onChange: (m: McpServer[]) => void;
}) {
  const toast = useToast();
  const onAdd = () => {
    const id = (prompt('MCP id (a-z, 0-9, dashes):') || '').trim();
    if (!id) return;
    if (mcps.find((m) => m.id === id)) {
      toast.error(`MCP "${id}" exists.`);
      return;
    }
    const command = prompt('Command (e.g. npx):', 'npx') || '';
    const argsRaw = prompt('Args (space-separated):', '') || '';
    const args = argsRaw.split(/\s+/).filter(Boolean);
    api
      .post<McpServer>('/config/mcps', { id, command, args, env: {}, enabled: true })
      .then((m) => {
        onChange([...mcps, m]);
        toast.success('MCP added.');
      })
      .catch((err) => toast.error(`Add failed: ${(err as Error).message}`));
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
    <div>
      <div className="view-actions" style={{ marginBottom: 12 }}>
        <Button variant="primary" size="sm" onClick={onAdd}>
          <Plus size={14} /> Add MCP
        </Button>
      </div>
      {mcps.length === 0 ? (
        <p className="muted">No MCPs configured.</p>
      ) : (
        <div className="mcp-list">
          {mcps.map((m) => (
            <Card key={m.id} className="mcp-row">
              <div className="mcp-row-head">
                <div className="mcp-name">{m.id}</div>
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
              <div className="mcp-meta">
                <code>{m.command} {(m.args || []).join(' ')}</code>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DebugLogPanel() {
  const [lines, setLines] = useState<string[]>([]);
  const [pos, setPos] = useState(0);

  const reload = async () => {
    try {
      const r = await fetch('http://127.0.0.1:4321/api/snapshot');
      void r;
    } catch { /* ignore */ }
    // For v3, the dashboard just shows service log via a small text file fetch.
    // The server doesn't expose this yet; show a placeholder.
    setLines(['(debug log is read from ~/.config/bizar/service.log)']);
  };

  useEffect(() => {
    reload();
  }, []);

  return (
    <div>
      <Button variant="secondary" size="sm" onClick={reload}>
        <RefreshCw size={14} /> Reload
      </Button>
      <pre className="mono debug-log">
        {lines.length === 0 ? '(no log)' : lines.join('\n')}
      </pre>
    </div>
  );
}
