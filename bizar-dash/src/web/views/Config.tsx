// src/views/Config.tsx — v3.4.0: sidebar nav + fully editable providers/MCPs.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Settings2,
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
  Database,
  History as HistoryIcon,
  X,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Spinner } from '../components/Spinner';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { api } from '../lib/api';
import { cn, debounce, hashText } from '../lib/utils';
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

// ─── OpenCode config form (v3.5.2) ─────────────────────────────────
// Structured UI for opencode.json sections: Model, Plugins, Tools,
// Permissions, Hooks. Raw JSON available via "Advanced" toggle.

type OcSection = 'model' | 'plugins' | 'tools' | 'permissions' | 'hooks' | 'advanced';

const OC_SECTIONS: { id: OcSection; label: string }[] = [
  { id: 'model', label: 'Model' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'tools', label: 'Tools' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'hooks', label: 'Hooks' },
  { id: 'advanced', label: 'Advanced' },
];

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
  const [section, setSection] = useState<OcSection>('model');

  const cfg = parsed.data as Record<string, unknown> | null;

  const apply = (patch: Record<string, unknown>) => {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    onChange(JSON.stringify(next, null, 2));
  };

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
          <RefreshCw size={14} /> Reload
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

      {/* Section tabs */}
      <div className="config-section-tabs" style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {OC_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={cn('tab-btn', section === s.id && 'active')}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Model section */}
      {section === 'model' && (
        <ModelForm cfg={cfg} apply={apply} />
      )}

      {/* Plugins section */}
      {section === 'plugins' && (
        <PluginsForm cfg={cfg} apply={apply} />
      )}

      {/* Tools section */}
      {section === 'tools' && (
        <ToolsForm cfg={cfg} apply={apply} />
      )}

      {/* Permissions section */}
      {section === 'permissions' && (
        <PermissionsForm cfg={cfg} apply={apply} />
      )}

      {/* Hooks section */}
      {section === 'hooks' && (
        <HooksForm cfg={cfg} apply={apply} />
      )}

      {/* Advanced: raw JSON editor */}
      {section === 'advanced' && (
        <div>
          <div className="config-grid-label" style={{ marginBottom: 8 }}>
            {parsed.error ? (
              <span className="text-error">{parsed.error}</span>
            ) : (
              <span className="muted">Raw JSON — edit with care</span>
            )}
          </div>
          <textarea
            ref={textareaRef}
            className={cn('textarea config-textarea', parsed.error && 'invalid')}
            spellCheck={false}
            value={parsed.raw}
            onChange={(e) => onChange(e.target.value)}
            style={{ minHeight: 300 }}
          />
        </div>
      )}
    </Card>
  );
}

// ── Sub-forms ─────────────────────────────────────────────────────────

function ModelForm({ cfg, apply }: { cfg: Record<string, unknown> | null; apply: (p: Record<string, unknown>) => void }) {
  const model = (cfg?.model || {}) as Record<string, unknown>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p className="muted text-sm">Configure the default model used by OpenCode agents.</p>
      <div className="field-row">
        <label className="field-label">Provider</label>
        <input
          className="input"
          value={String(model.provider || '')}
          onChange={(e) => apply({ model: { ...model, provider: e.target.value } })}
          placeholder="e.g. openai, anthropic, google"
        />
      </div>
      <div className="field-row">
        <label className="field-label">Model ID</label>
        <input
          className="input"
          value={String(model.model || '')}
          onChange={(e) => apply({ model: { ...model, model: e.target.value } })}
          placeholder="e.g. gpt-4o, claude-sonnet-4-20250514"
        />
      </div>
      {!!model.apiKey && (
        <div className="field-row">
          <label className="field-label">API Key</label>
          <input
            className="input"
            type="password"
            value={String(model.apiKey || '')}
            onChange={(e) => apply({ model: { ...model, apiKey: e.target.value } })}
            placeholder="sk-..."
          />
        </div>
      )}
      {!!model.baseURL && (
        <div className="field-row">
          <label className="field-label">Base URL</label>
          <input
            className="input"
            value={String(model.baseURL || '')}
            onChange={(e) => apply({ model: { ...model, baseURL: e.target.value } })}
            placeholder="https://api.openai.com/v1"
          />
        </div>
      )}
    </div>
  );
}

function PluginsForm({ cfg, apply }: { cfg: Record<string, unknown> | null; apply: (p: Record<string, unknown>) => void }) {
  const plugins = Array.isArray(cfg?.plugins) ? (cfg.plugins as Record<string, unknown>[]) : [];
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  const addPlugin = () => {
    const next = [...plugins, { name: '', enabled: true }];
    apply({ plugins: next });
  };

  const removePlugin = (i: number) => {
    const next = plugins.filter((_, idx) => idx !== i);
    apply({ plugins: next });
  };

  const updatePlugin = (i: number, patch: Record<string, unknown>) => {
    const next = plugins.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    apply({ plugins: next });
    setEditing(null);
  };

  return (
    <div>
      <p className="muted text-sm" style={{ marginBottom: 12 }}>Manage enabled plugins.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {plugins.length === 0 && <p className="muted text-sm">No plugins configured.</p>}
        {plugins.map((p, i) => (
          <div key={i} className="config-list-row">
            {editing === i ? (
              <div style={{ display: 'flex', gap: 8, flex: 1, alignItems: 'center' }}>
                <input
                  className="input"
                  value={String(draft.name || '')}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="plugin-name"
                />
                <label style={{ display: 'flex', gap: 4, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={!!draft.enabled}
                    onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  />
                  enabled
                </label>
                <Button variant="primary" size="sm" onClick={() => updatePlugin(i, draft)}>Apply</Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(null)}><X size={12} /></Button>
              </div>
            ) : (
              <>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                  {(p as { name?: string }).name || 'unnamed'}
                </span>
                <span className={cn('tag', (p as { enabled?: boolean }).enabled !== false ? 'tag-success' : 'tag-neutral')}>
                  {(p as { enabled?: boolean }).enabled !== false ? 'enabled' : 'disabled'}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button type="button" className="icon-btn" onClick={() => { setEditing(i); setDraft(p as Record<string, unknown>); }} title="Edit">
                    <Pencil size={12} />
                  </button>
                  <button type="button" className="icon-btn text-error" onClick={() => removePlugin(i)} title="Remove">
                    <Trash2 size={12} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <Button variant="secondary" size="sm" onClick={addPlugin} style={{ marginTop: 8 }}>
        <Plus size={12} /> Add plugin
      </Button>
    </div>
  );
}

function ToolsForm({ cfg, apply }: { cfg: Record<string, unknown> | null; apply: (p: Record<string, unknown>) => void }) {
  const tools = (cfg?.tools as Record<string, boolean> | null) || {};

  const toggle = (name: string) => {
    apply({ tools: { ...tools, [name]: !tools[name] } });
  };

  const addTool = (name: string) => {
    if (!name || tools[name] !== undefined) return;
    apply({ tools: { ...tools, [name]: true } });
  };

  const removeTool = (name: string) => {
    const next = { ...tools };
    delete next[name];
    apply({ tools: next });
  };

  return (
    <div>
      <p className="muted text-sm" style={{ marginBottom: 12 }}>Enable or disable built-in tools.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Object.keys(tools).length === 0 && <p className="muted text-sm">No tools configured.</p>}
        {Object.entries(tools).map(([name, enabled]) => (
          <div key={name} className="config-list-row">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{name}</span>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
              <input type="checkbox" checked={!!enabled} onChange={() => toggle(name)} />
              enabled
            </label>
            <button type="button" className="icon-btn text-error" style={{ marginLeft: 'auto' }} onClick={() => removeTool(name)} title="Remove">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          className="input"
          placeholder="tool-name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTool((e.target as HTMLInputElement).value.trim());
          }}
        />
        <Button variant="secondary" size="sm"
          onClick={(e) => addTool((e.currentTarget.closest('div')?.querySelector('input') as HTMLInputElement)?.value.trim() || '')}
        >
          <Plus size={12} /> Add
        </Button>
      </div>
    </div>
  );
}

function PermissionsForm({ cfg, apply }: { cfg: Record<string, unknown> | null; apply: (p: Record<string, unknown>) => void }) {
  const permissions = (cfg?.permissions as Record<string, unknown> | null) || {};
  const [tab, setTab] = useState<'allow' | 'deny'>('allow');
  const allow = Array.isArray(permissions.allow) ? (permissions.allow as string[]) : [];
  const deny = Array.isArray(permissions.deny) ? (permissions.deny as string[]) : [];

  const addRule = (list: string[], key: 'allow' | 'deny') => (name: string) => {
    if (!name) return;
    apply({ permissions: { ...permissions, [key]: [...list, name] } });
  };

  const removeRule = (key: 'allow' | 'deny', list: string[], i: number) => {
    apply({ permissions: { ...permissions, [key]: list.filter((_, idx) => idx !== i) } });
  };

  const list = tab === 'allow' ? allow : deny;

  return (
    <div>
      <p className="muted text-sm" style={{ marginBottom: 12 }}>Allow or deny tool/scope rules.</p>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button type="button" className={cn('tab-btn', tab === 'allow' && 'active')} onClick={() => setTab('allow')}>Allow ({allow.length})</button>
        <button type="button" className={cn('tab-btn', tab === 'deny' && 'active')} onClick={() => setTab('deny')}>Deny ({deny.length})</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {list.length === 0 && <p className="muted text-sm">No {tab} rules.</p>}
        {list.map((rule, i) => (
          <div key={i} className="config-list-row">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{rule}</span>
            <button type="button" className="icon-btn text-error" style={{ marginLeft: 'auto' }} onClick={() => removeRule(tab, list, i)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          className="input"
          placeholder={`${tab} rule (e.g. tool:read, scope:filesystem)`}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = (e.target as HTMLInputElement).value.trim();
              if (v) { addRule(list, tab)(v); (e.target as HTMLInputElement).value = ''; }
            }
          }}
        />
        <Button variant="secondary" size="sm" onClick={(e) => {
          const inp = e.currentTarget.closest('div')?.querySelector('input') as HTMLInputElement;
          const v = inp?.value.trim();
          if (v) { addRule(list, tab)(v); inp.value = ''; }
        }}>
          <Plus size={12} /> Add
        </Button>
      </div>
    </div>
  );
}

function HooksForm({ cfg, apply }: { cfg: Record<string, unknown> | null; apply: (p: Record<string, unknown>) => void }) {
  const hooks = (cfg?.hooks as Record<string, unknown> | null) || {};

  const updateHook = (name: string, value: unknown) => {
    apply({ hooks: { ...hooks, [name]: value } });
  };

  return (
    <div>
      <p className="muted text-sm" style={{ marginBottom: 12 }}>Configure pre/post tool hooks.</p>
      {Object.keys(hooks).length === 0 && <p className="muted text-sm">No hooks configured.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(['preTool', 'postTool', 'preAgent', 'postAgent'] as const).map((hookName) => {
          const hook = hooks[hookName];
          return (
            <div key={hookName} className="field-row" style={{ alignItems: 'flex-start' }}>
              <label className="field-label" style={{ minWidth: 100 }}>{hookName}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <input
                  className="input"
                  value={typeof hook === 'object' && hook !== null && 'command' in hook ? String((hook as { command: string }).command || '') : ''}
                  onChange={(e) => updateHook(hookName, { command: e.target.value })}
                  placeholder={`${hookName} command (e.g. node /path/to/hook.js)`}
                />
              </div>
            </div>
          );
        })}
      </div>
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
    let modelsEl: HTMLTextAreaElement | null = null;
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
                ref={(el) => (modelsEl = el)}
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
      <AutoDetectBanner onAdd={(id, name, baseURL, key) => {
        openProviderModal({ id, name, baseURL, apiKey: key } as Provider);
      }} />
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

function parseHeaders(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sep = trimmed.indexOf(':');
    if (sep <= 0) continue;
    const k = trimmed.slice(0, sep).trim();
    const v = trimmed.slice(sep + 1).trim();
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
              const headers = parseHeaders(headersEl?.value || '');
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

// ─── AutoDetectBanner (v3.16.0) ────────────────────────────────────
// Scans env vars + opencode.json for known provider API keys
// (Anthropic, OpenAI, Google, Mistral, Groq, Cohere, OpenRouter,
// DeepSeek, MiniMax). Surfaces status: configured / unknown / no-key.
type AutoDetectResult = {
  id: string;
  name: string;
  baseURL?: string;
  status: 'configured' | 'unknown' | 'no-key';
  keySource: string;
  hasKey: boolean;
  probed?: { ok: boolean; status?: number; reason?: string; modelCount?: number } | null;
};

function AutoDetectBanner({
  onAdd,
}: {
  onAdd: (id: string, name: string, baseURL: string, apiKey?: string) => void;
}) {
  const toast = useToast();
  const [results, setResults] = useState<AutoDetectResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const run = async (probe: boolean) => {
    setLoading(true);
    try {
      const r = await api.get<{ providers: AutoDetectResult[] }>(
        `/providers/auto-detect${probe ? '' : '?probe=0'}`,
      );
      setResults(r.providers || []);
      const configured = (r.providers || []).filter((p) => p.status === 'configured');
      if (configured.length > 0) {
        toast.success(`Detected ${configured.length} configured provider${configured.length === 1 ? '' : 's'}.`);
      } else {
        toast.info('No configured providers detected in env or config.');
      }
    } catch (err) {
      toast.error(`Auto-detect failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const statusIcon = (s: string) => {
    if (s === 'configured') return <ShieldCheck size={12} style={{ color: 'var(--success)' }} />;
    if (s === 'unknown') return <AlertTriangle size={12} style={{ color: 'var(--warning)' }} />;
    return <X size={12} style={{ color: 'var(--text-dim)' }} />;
  };

  const configured = (results || []).filter((p) => p.status === 'configured');
  const other = (results || []).filter((p) => p.status !== 'configured');

  return (
    <Card className="autodetect-banner">
      <div className="autodetect-head" onClick={() => setExpanded((v) => !v)}>
        <ShieldCheck size={14} />
        <span className="autodetect-title">Auto-detect providers</span>
        <span className="muted" style={{ fontSize: 11 }}>
          {results
            ? `${configured.length} configured · ${other.length} other`
            : 'scan env vars + opencode.json for known keys'}
        </span>
        <span className="autodetect-spacer" />
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            run(true);
          }}
          disabled={loading}
          title="Probe each provider's /models endpoint"
        >
          {loading ? <Spinner size="sm" /> : <RefreshCw size={12} />} Detect
        </Button>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>
      {expanded && (
        <div className="autodetect-body">
          {!results ? (
            <div className="muted" style={{ padding: 12, fontSize: 12 }}>
              Click <strong>Detect</strong> to scan env vars and opencode.json for known provider keys.
              Probes each provider's <code>/models</code> endpoint with a 1.5s timeout.
            </div>
          ) : (
            <table className="autodetect-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Provider</th>
                  <th>Source</th>
                  <th>Probe</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <td>{statusIcon(r.status)} <span className="autodetect-status">{r.status}</span></td>
                    <td><strong>{r.name}</strong> <span className="muted mono">{r.id}</span></td>
                    <td className="muted">{r.keySource || '—'}</td>
                    <td className="muted">
                      {r.probed?.modelCount != null
                        ? `${r.probed.modelCount} models`
                        : r.probed?.reason
                          ? r.probed.reason
                          : r.probed?.ok
                            ? 'ok'
                            : '—'}
                    </td>
                    <td>
                      {r.status === 'configured' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onAdd(r.id, r.name, r.baseURL || '')}
                          title="Add this provider to opencode.json"
                        >
                          <Plus size={10} /> Add
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}
