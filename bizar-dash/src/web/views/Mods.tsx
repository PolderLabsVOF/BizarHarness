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
  FileCode,
  User,
  Terminal,
  BookOpen,
  X,
  ExternalLink,
  Globe,
  LayoutTemplate,
  Download,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
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
  // v3.3.0 — Always start by loading from the server, not just the
  // snapshot. The snapshot can be stale if the user installed a mod
  // from the CLI or added files directly to ~/.config/bizar/mods.
  // We seed the initial state from the snapshot for instant paint
  // but always re-fetch on mount and after every mutation.
  const [mods, setMods] = useState<Mod[]>(Array.isArray(snapshot.mods) ? snapshot.mods : []);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [modViews, setModViews] = useState<ModView[]>([]);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  // v3.16.0 — Registry browser
  const [registryOpen, setRegistryOpen] = useState(false);
  const [registry, setRegistry] = useState<{
    source: string;
    version?: number;
    updatedAt?: string;
    mods: Array<{
      id: string;
      name: string;
      latest?: string;
      description?: string;
      author?: string;
      tags?: string[];
      permissions?: string[];
      homepage?: string;
      installed?: boolean;
      installedVersion?: string | null;
      upgradeAvailable?: string | null;
    }>;
    error?: string;
  } | null>(null);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});

  const loadRegistry = async () => {
    setRegistryLoading(true);
    try {
      const r = await api.get<{
        registry?: { source?: string; version?: number; updatedAt?: string };
        mods?: Array<{
          id: string;
          name: string;
          latest?: string;
          description?: string;
          author?: string;
          tags?: string[];
          permissions?: string[];
          homepage?: string;
          installed?: boolean;
          installedVersion?: string | null;
          upgradeAvailable?: string | null;
        }>;
      }>('/mods/registry');
      setRegistry({
        source: r.registry?.source || '',
        version: r.registry?.version,
        updatedAt: r.registry?.updatedAt,
        mods: r.mods || [],
      });
    } catch (err) {
      setRegistry({ source: '', mods: [], error: (err as Error).message });
    } finally {
      setRegistryLoading(false);
    }
  };

  const onInstallFromRegistry = async (id: string) => {
    setInstalling((cur) => ({ ...cur, [id]: true }));
    try {
      const m = await api.post<Mod>('/mods', { id });
      setMods((cur) => [...cur.filter((x) => x.id !== m.id), m]);
      toast.success(`Mod "${m.id}" installed from registry.`);
      await refreshSnapshot();
    } catch (err) {
      toast.error(`Install failed: ${(err as Error).message}`);
    } finally {
      setInstalling((cur) => ({ ...cur, [id]: false }));
    }
  };

  const reload = async () => {
    try {
      // Always pull fresh from the server. snapshot is fine for
      // optimistic initial render, but a fresh fetch makes the page
      // behave correctly even if the snapshot was empty or stale.
      const r = await api.get<{ mods: Mod[] }>('/mods');
      setMods(r.mods || []);
      try {
        const v = await api.get<{ views: ModView[] }>('/mods/views');
        setModViews(v.views || []);
      } catch {
        setModViews([]);
      }
    } catch (err) {
      toast.error(`Mods load failed: ${(err as Error).message}`);
    } finally {
      // v3.3.0 — Always clear loading even on failure so the empty
      // state can render. Without this, a network blip would leave
      // the user staring at a spinner forever.
      setLoading(false);
    }
  };

  // Initial load — runs once on mount.
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sync from snapshot when it changes (other tabs may have
  // triggered a refreshSnapshot that updated the mod list).
  useEffect(() => {
    if (Array.isArray(snapshot.mods) && snapshot.mods !== mods) {
      setMods(snapshot.mods);
    }
    // eslint-disable-next-line react-hooks-exhaustive-deps
  }, [snapshot.mods]);

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

      {/* v3.16.0 — Registry browser */}
      <Card className="mods-registry-card">
        <div className="mods-registry-head" onClick={() => {
          if (!registry && !registryLoading) loadRegistry();
          setRegistryOpen((v) => !v);
        }}>
          <Globe size={14} />
          <span className="mods-registry-title">Mod registry</span>
          <span className="muted" style={{ fontSize: 11 }}>
            {registry?.mods ? `${registry.mods.length} available` : 'click to browse'}
          </span>
          <span className="mods-registry-spacer" />
          {registryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        {registryOpen && (
          <div className="mods-registry-body">
            {registryLoading ? (
              <div className="muted" style={{ padding: 12, fontSize: 12 }}>Loading registry…</div>
            ) : registry?.error ? (
              <div className="mods-registry-error">
                <ShieldCheck size={12} /> Could not load registry: {registry.error}
              </div>
            ) : !registry || registry.mods.length === 0 ? (
              <div className="muted" style={{ padding: 12, fontSize: 12 }}>
                No mods listed in the registry yet.
              </div>
            ) : (
              <>
                {registry.source && (
                  <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                    Source: <code>{registry.source}</code>
                  </div>
                )}
                <div className="mods-registry-grid">
                  {registry.mods.map((rm) => {
                    const installed = mods.some((m) => m.id === rm.id);
                    const isInstalling = !!installing[rm.id];
                    return (
                      <div key={rm.id} className="mod-registry-card">
                        <div className="mod-registry-card-head">
                          <div className="mod-registry-card-name">{rm.name}</div>
                          {rm.latest && (
                            <span className={cn('mod-registry-version', rm.upgradeAvailable && 'mod-registry-version-upgrade')}>
                              v{rm.latest}{rm.upgradeAvailable ? ' ↑' : ''}
                            </span>
                          )}
                        </div>
                        {rm.description && (
                          <div className="mod-registry-card-desc">{rm.description}</div>
                        )}
                        <div className="mod-registry-card-meta">
                          {rm.author && <span className="muted">by {rm.author}</span>}
                          {rm.homepage && (
                            <a href={rm.homepage} target="_blank" rel="noopener noreferrer" className="mod-registry-link">
                              homepage
                            </a>
                          )}
                        </div>
                        {(rm.permissions || []).length > 0 && (
                          <div className="mod-registry-perms">
                            <ShieldCheck size={10} />
                            {(rm.permissions || []).slice(0, 4).map((p) => (
                              <span key={p} className="mod-registry-perm">{p}</span>
                            ))}
                            {(rm.permissions || []).length > 4 && (
                              <span className="mod-registry-perm-more">+{rm.permissions!.length - 4}</span>
                            )}
                          </div>
                        )}
                        <div className="mod-registry-card-actions">
                          <Button
                            variant={installed ? 'ghost' : 'primary'}
                            size="sm"
                            disabled={installed || isInstalling}
                            onClick={() => onInstallFromRegistry(rm.id)}
                            title={
                              installed
                                ? `Installed v${rm.installedVersion || '?'}`
                                : rm.upgradeAvailable
                                  ? `Upgrade to v${rm.upgradeAvailable}`
                                  : 'Install from registry'
                            }
                          >
                            {isInstalling ? <Spinner size="sm" /> : installed ? `Installed${rm.upgradeAvailable ? ` — upgrade` : ''}` : (<><Download size={12} /> Install</>)}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </Card>

      {/* v3.20.3 — Mod views now appear in the sidebar nav as first-class
          tabs (handled by App.tsx), so this section is a hint pointing
          users to the sidebar. */}
      {modViews.length > 0 && (
        <Card className="mod-views-hint">
          <CardTitle><Globe size={14} /> Mod views</CardTitle>
          <CardMeta>
            {modViews.length} mod-supplied view{modViews.length === 1 ? '' : 's'} are now available in the sidebar navigation.
            Look for the <strong>Mods</strong> section at the bottom of the sidebar.
          </CardMeta>
        </Card>
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
  const toast = useToast();
  const [instructions, setInstructions] = useState<{
    modId: string;
    modName: string;
    total: number;
    agents: Array<{ filename: string; path: string; fullPath: string; content: string | null }>;
    commands: Array<{ filename: string; path: string; fullPath: string; content: string | null }>;
    skills: Array<{ name: string; fullPath: string; content: string | null }>;
  } | null>(null);
  const [instructionsLoading, setInstructionsLoading] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const loadInstructions = async () => {
    setInstructionsLoading(true);
    try {
      const r = await api.get<typeof instructions>(`/mods/${mod.id}/instructions`);
      setInstructions(r);
      setInstructionsOpen(true);
    } catch (err) {
      toast.error(`Failed to load instructions: ${(err as Error).message}`);
    } finally {
      setInstructionsLoading(false);
    }
  };

  const onReinstallInstructions = async () => {
    try {
      const r = await api.post<{ ok: boolean; counts: { agents: number; commands: number; skills: number; instructions: number } }>(
        `/mods/${mod.id}/instructions/reinstall`,
        {},
      );
      toast.success(`Reinstalled: ${r.counts.agents} agents, ${r.counts.commands} commands, ${r.counts.skills} skills, ${r.counts.instructions} instructions.`);
      await loadInstructions();
    } catch (err) {
      toast.error(`Reinstall failed: ${(err as Error).message}`);
    }
  };

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

      {/* v3.20 — Installed instructions (agents / commands / skills) */}
      <div className="mod-instructions">
        <div className="mod-instructions-head" onClick={() => {
          if (!instructions && !instructionsLoading) loadInstructions();
          setInstructionsOpen((v) => !v);
        }}>
          <FileCode size={14} />
          <span>Installed instructions</span>
          <span className="muted" style={{ fontSize: 11 }}>
            {instructions ? `${instructions.total} files` : 'click to view'}
          </span>
          <span className="mod-instructions-spacer" />
          {instructionsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        {instructionsOpen && instructions && (
          <div className="mod-instructions-body">
            {instructions.agents.length > 0 && (
              <div className="mod-instructions-section">
                <div className="mod-instructions-section-title">
                  <User size={11} /> Agents ({instructions.agents.length})
                </div>
                {instructions.agents.map((f) => (
                  <div key={f.filename} className="mod-instructions-file">
                    <div
                      className="mod-instructions-file-head"
                      onClick={() => setExpandedFile((cur) => cur === f.filename ? null : f.filename)}
                    >
                      <span className="mono">{f.filename}</span>
                      <span className="muted" style={{ fontSize: 10 }}>
                        installed at {f.fullPath}
                      </span>
                    </div>
                    {expandedFile === f.filename && (
                      <pre className="mod-instructions-content">
                        {f.content || <em className="muted">(file missing on disk)</em>}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
            {instructions.commands.length > 0 && (
              <div className="mod-instructions-section">
                <div className="mod-instructions-section-title">
                  <Terminal size={11} /> Commands ({instructions.commands.length})
                </div>
                {instructions.commands.map((f) => (
                  <div key={f.filename} className="mod-instructions-file">
                    <div
                      className="mod-instructions-file-head"
                      onClick={() => setExpandedFile((cur) => cur === f.filename ? null : f.filename)}
                    >
                      <span className="mono">{f.filename}</span>
                      <span className="muted" style={{ fontSize: 10 }}>
                        installed at {f.fullPath}
                      </span>
                    </div>
                    {expandedFile === f.filename && (
                      <pre className="mod-instructions-content">
                        {f.content || <em className="muted">(file missing on disk)</em>}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
            {instructions.skills.length > 0 && (
              <div className="mod-instructions-section">
                <div className="mod-instructions-section-title">
                  <BookOpen size={11} /> Skills ({instructions.skills.length})
                </div>
                {instructions.skills.map((s) => (
                  <div key={s.name} className="mod-instructions-file">
                    <div
                      className="mod-instructions-file-head"
                      onClick={() => setExpandedFile((cur) => cur === s.name ? null : s.name)}
                    >
                      <span className="mono">{s.name}</span>
                      <span className="muted" style={{ fontSize: 10 }}>
                        installed at {s.fullPath}
                      </span>
                    </div>
                    {expandedFile === s.name && (
                      <pre className="mod-instructions-content">
                        {s.content || <em className="muted">(file missing on disk)</em>}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
            {instructions.total === 0 && (
              <div className="muted" style={{ padding: 8, fontSize: 12 }}>
                This mod did not install any instruction files. Mods install instructions by shipping a top-level <code>INSTRUCTIONS.md</code>, an <code>agents/</code> directory, a <code>commands/</code> directory, or a <code>skills/</code> directory.
              </div>
            )}
            <div className="mod-instructions-actions">
              <Button variant="ghost" size="sm" onClick={onReinstallInstructions}>
                <RefreshCw size={11} /> Reinstall from mod folder
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
