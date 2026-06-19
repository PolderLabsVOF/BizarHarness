// src/views/Mods.tsx — list, install, enable/disable mods + mod views.
import { useEffect, useState } from 'react';
import {
  Puzzle,
  Plus,
  Trash2,
  Power,
  RefreshCw,
  Folder,
  FileText,
  X,
  ExternalLink,
  Globe,
  LayoutTemplate,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { useModal } from '../components/Modal';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { Mod, Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type ModView = {
  id: string;
  modId: string;
  kind: 'iframe' | 'tab';
  label: string;
  description?: string;
  path?: string;
};

export function Mods({ snapshot, refreshSnapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [mods, setMods] = useState<Mod[]>(snapshot.mods || []);
  const [loading, setLoading] = useState(!snapshot.mods);
  const [selected, setSelected] = useState<string | null>(null);
  const [modViews, setModViews] = useState<ModView[]>([]);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);

  const reload = async () => {
    try {
      const r = await api.get<{ mods: Mod[] }>('/mods');
      setMods(r.mods || []);
      const v = await api.get<{ views: ModView[] }>('/mods/views');
      setModViews(v.views || []);
    } catch (err) {
      toast.error(`Mods load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (snapshot.mods?.length || snapshot.mods) {
      setMods(snapshot.mods || []);
      setLoading(false);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.mods]);

  // Load mod views when tab becomes active
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onInstall = () => {
    let pathEl: HTMLInputElement | null = null;
    modal.open({
      title: 'Install mod',
      children: (
        <div>
          <p className="muted">
            Provide the absolute path to a mod folder (one that contains
            a <code>mod.json</code>). The folder will be copied to
            {' '}<code>~/.config/bizar/mods/&lt;id&gt;/</code>.
          </p>
          <label className="field-label">Path</label>
          <input
            ref={(el) => (pathEl = el)}
            className="input"
            type="text"
            placeholder="/path/to/my-mod"
            autoFocus
          />
        </div>
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const path = (pathEl?.value || '').trim();
              if (!path) {
                toast.warning('Path is required.');
                return;
              }
              try {
                const m = await api.post<Mod>('/mods', { path });
                setMods((cur) => [...cur, m]);
                toast.success(`Mod "${m.id}" installed.`);
                modal.close();
                await refreshSnapshot();
              } catch (err) {
                toast.error(`Install failed: ${(err as Error).message}`);
              }
            }}
          >
            Install
          </Button>
        </div>
      ),
    });
  };

  const onUninstall = async (id: string) => {
    if (!confirm(`Uninstall mod "${id}"? This removes the folder from ~/.config/bizar/mods/.`)) return;
    try {
      await api.del(`/mods/${encodeURIComponent(id)}`);
      setMods((cur) => cur.filter((m) => m.id !== id));
      if (selected === id) setSelected(null);
      toast.success('Mod uninstalled.');
    } catch (err) {
      toast.error(`Uninstall failed: ${(err as Error).message}`);
    }
  };

  const onToggleEnabled = async (mod: Mod) => {
    try {
      const next = await api.put<Mod>(`/mods/${encodeURIComponent(mod.id)}`, { enabled: !mod.enabled });
      setMods((cur) => cur.map((m) => (m.id === mod.id ? next : m)));
      toast.success(`Mod ${next.enabled ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      toast.error(`Toggle failed: ${(err as Error).message}`);
    }
  };

  const sel = mods.find((m) => m.id === selected) || null;

  if (loading) {
    return (
      <div className="view-loading">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="view view-mods">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Puzzle size={18} /> Mods ({mods.length})
          </h2>
          <p className="view-subtitle">
            Extensions installed in <code>~/.config/bizar/mods/</code>.
            Mods can add agents, commands, routes, and views.
          </p>
        </div>
        <div className="view-actions">
          <Button variant="secondary" size="sm" onClick={reload}>
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={onInstall}>
            <Plus size={14} /> Install mod
          </Button>
        </div>
      </header>

      {mods.length === 0 ? (
        <EmptyState
          icon={<Puzzle size={32} />}
          title="No mods installed"
          message="Mods are folders with a mod.json. Install one to extend Bizar with custom agents, commands, and views."
        />
      ) : (
        <div className="mods-layout">
          <div className="mods-list">
            {mods.map((m) => (
              <div
                key={m.id}
                className={cn('mod-list-item', selected === m.id && 'mod-list-item-active')}
                onClick={() => setSelected(m.id)}
              >
                <div className="mod-list-item-head">
                  <div>
                    <div className="mod-list-item-name">{m.name}</div>
                    <div className="mod-list-item-meta">v{m.version} · {m.type} · {m.author}</div>
                  </div>
                  <div className="mod-list-item-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Toggle enabled"
                      title={m.enabled ? 'Disable' : 'Enable'}
                      onClick={() => onToggleEnabled(m)}
                    >
                      <Power size={12} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      aria-label="Uninstall"
                      title="Uninstall"
                      onClick={() => onUninstall(m.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="mod-list-item-desc ellipsis-2" title={m.description}>
                  {m.description}
                </div>
                <div className="mod-list-item-status">
                  <span className={`mod-mini-pill ${m.enabled ? 'mod-mini-pill-on' : 'mod-mini-pill-off'}`}>
                    {m.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {sel && <ModDetails mod={sel} />}
        </div>
      )}

      {/* Mod views section — web/index.html and registered tabs */}
      {modViews.length > 0 && (
        <div className="mods-views-section">
          <h3 className="view-subtitle">
            <Globe size={14} /> Mod views
          </h3>
          <div className="mods-views-grid">
            {modViews.map((v) => (
              <Card key={v.id} className="mod-view-card">
                <div className="mod-view-card-head">
                  <div>
                    <div className="mod-view-label">
                      {v.kind === 'tab' ? <LayoutTemplate size={12} /> : <Globe size={12} />}
                      {v.label}
                    </div>
                    <div className="mod-view-mod muted">by {v.modId}</div>
                    {v.description && (
                      <div className="mod-view-desc muted ellipsis-2">{v.description}</div>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (v.kind === 'iframe' && v.path) {
                        // Open the mod's web/index.html in an iframe panel
                        setIframeUrl(`/api/mods/${v.modId}/web/index.html`);
                      } else {
                        // For registered tabs without web view, show placeholder
                        toast.info(`Tab view for "${v.label}" — full TSX loading lands in v3.1.`, 2500);
                      }
                    }}
                  >
                    <ExternalLink size={12} /> Open
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Iframe panel for mod web views */}
      {iframeUrl && (
        <div className="mod-iframe-panel">
          <div className="mod-iframe-header">
            <span>Mod view — <a href={iframeUrl} target="_blank" rel="noreferrer">{iframeUrl}</a></span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close iframe"
              onClick={() => setIframeUrl(null)}
            >
              <X size={14} />
            </button>
          </div>
          <iframe
            src={iframeUrl}
            className="mod-iframe"
            title="Mod view"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      )}
    </div>
  );
}

function ModDetails({ mod }: { mod: Mod }) {
  return (
    <Card className="mod-details">
      <CardTitle><FileText size={14} /> Mod details — {mod.name}</CardTitle>
      <CardMeta>
        <code>{mod.path}</code>
      </CardMeta>
      <dl className="env-table">
        <dt>ID</dt>
        <dd className="mono">{mod.id}</dd>
        <dt>Version</dt>
        <dd className="mono">{mod.version}</dd>
        <dt>Type</dt>
        <dd className="mono">{mod.type}</dd>
        <dt>Author</dt>
        <dd className="mono">{mod.author || '—'}</dd>
        <dt>Bizar</dt>
        <dd className="mono">{mod.bizar || '*'}</dd>
        <dt>Enabled</dt>
        <dd>{mod.enabled ? 'yes' : 'no'}</dd>
        <dt>Permissions</dt>
        <dd>
          {(mod.permissions || []).map((p) => (
            <span key={p} className="tag">{p}</span>
          ))}
          {(mod.permissions || []).length === 0 && <span className="muted">(none)</span>}
        </dd>
      </dl>
      <div className="mod-files">
        <div className="muted">Files</div>
        <ul>
          {(mod.files || []).map((f) => (
            <li key={f.path}>
              <span className="mod-file-cat">{f.category}</span>
              <span className="mono">{f.path}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
