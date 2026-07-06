// src/web/views/memory/ConfigPanel.tsx — simplified memory config.
// v6.x — Vault path is now fetched from /api/memory/status so the row
// stops saying "(loading…)" forever. Users can change the vault path
// inline and initialise the vault if it doesn't exist yet.
import { useEffect, useState } from 'react';
import {
  GitBranch,
  GitCommitHorizontal,
  Download,
  Upload,
  Loader2,
  Plug,
  Save,
  FolderInput,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, CardMeta, CardTitle } from '../../components/Card';
import { Spinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

type GitConfig = {
  remoteUrl?: string;
};

type GlobalConfig = {
  git?: GitConfig;
};

type SyncStatus = {
  clean?: boolean;
  branch?: string;
  modified?: number;
  untracked?: number;
};

type MemoryStatus = {
  initialized: boolean;
  mode?: string | null;
  projectId?: string | null;
  vaultRoot?: string | null;
  branch?: string | null;
  gitClean?: boolean | null;
  noteCount?: number;
  lastSecretScan?: string | null;
};

type Props = { refreshKey: number };

export function ConfigPanel({ refreshKey }: Props) {
  const toast = useToast();
  const [cfg, setCfg] = useState<GlobalConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const [vaultPathDraft, setVaultPathDraft] = useState<string>('');
  const [pathInitialising, setPathInitialising] = useState(false);
  const [pathSaving, setPathSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [tests, setTests] = useState<Array<{ name: string; pass: boolean; detail: string }> | null>(null);
  const [testing, setTesting] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [cfgRes, statusRes] = await Promise.all([
        api.get<{ config: GlobalConfig }>('/memory/config/global').catch(() => null),
        api.get<MemoryStatus>('/memory/status').catch(() => null),
      ]);
      if (cfgRes) {
        setCfg(cfgRes.config);
        setRemoteUrl(cfgRes.config?.git?.remoteUrl || '');
      } else {
        setCfg({});
      }
      if (statusRes) {
        setMemoryStatus(statusRes);
        // Initialise the draft input from the server's current vaultRoot.
        // Only overwrite while the user hasn't started editing.
        setVaultPathDraft((cur) => cur || statusRes.vaultRoot || '');
      }
      // Also fetch git status from the per-project vault
      await loadSyncStatus();
    } catch (err) {
      toast.error(`Config load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadSyncStatus = async () => {
    try {
      const r = await api.get<{ ok: boolean; clean?: boolean; branch?: string; modified?: number; untracked?: number }>('/memory/git/status');
      if (r.ok) {
        setSyncStatus({
          clean: r.clean,
          branch: r.branch,
          modified: r.modified,
          untracked: r.untracked,
        });
      }
    } catch {
      // git status is best-effort
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // v6.x — Save the new vault path. If the folder doesn't exist, the
  // backend's /memory/init endpoint can be used to create it (handled
  // by ensureVaultExists()).
  const onSaveVaultPath = async () => {
    const target = vaultPathDraft.trim();
    if (!target) {
      toast.error('Vault path cannot be empty.');
      return;
    }
    setPathSaving(true);
    try {
      const status = await api.get<MemoryStatus & { exists?: boolean }>('/memory/status').catch(() => null);
      const initialised = status?.initialized;
      if (!initialised) {
        // Initialise the vault at the chosen path.
        await api.post('/memory/init', { vaultRoot: target });
        toast.success(`Vault initialised at ${target}.`);
      } else {
        // v6.x — Call the new vault config endpoint to persist the path.
        await api.post('/memory/config/vault', { vaultRoot: target });
        toast.success(`Vault path updated to ${target}.`);
      }
      setVaultPathDraft(target);
      await reload();
    } catch (err) {
      toast.error(`Vault path save failed: ${(err as Error).message}`);
    } finally {
      setPathSaving(false);
    }
  };

  const onInitVault = async () => {
    setPathInitialising(true);
    try {
      await api.post('/memory/init', {});
      toast.success('Vault initialised.');
      await reload();
    } catch (err) {
      toast.error(`Init failed: ${(err as Error).message}`);
    } finally {
      setPathInitialising(false);
    }
  };

  const onSave = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await api.put('/memory/config/global', { git: { remoteUrl } });
      toast.success('Config saved.');
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (action: 'pull' | 'push' | 'commit') => {
    setActionLoading(action);
    try {
      if (action === 'pull') {
        const r = await api.post<{ ok: boolean; output?: string }>('/memory/git/pull', {});
        if (r.ok) toast.success('Pull successful.');
        else toast.error(`Pull failed: ${r.output || 'unknown error'}`);
      } else if (action === 'push') {
        const r = await api.post<{ ok: boolean }>('/memory/git/push', {});
        if (r.ok) toast.success('Push successful.');
        else toast.error('Push failed.');
      } else if (action === 'commit') {
        const r = await api.post<{ ok: boolean; message?: string }>('/memory/git/commit', {});
        if (r.ok) toast.success(`Committed: ${r.message}`);
        else toast.error('Commit failed.');
      }
      await loadSyncStatus();
    } catch (err) {
      toast.error(`${action} failed: ${(err as Error).message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const onTest = async () => {
    setTesting(true);
    try {
      const r = await api.post<{ ok: boolean; checks: Array<{ name: string; pass: boolean; detail: string }> }>(
        '/memory/test-git',
        {},
      );
      setTests(r.checks);
    } catch (err) {
      toast.error(`Test failed: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  if (loading && !cfg) {
    return (
      <div className="view-loading">
        <Spinner size="md" />
        <p>Loading config…</p>
      </div>
    );
  }
  if (!cfg) return <div className="muted">No config available.</div>;

  const initialised = !!memoryStatus?.initialized;
  const currentVaultPath = memoryStatus?.vaultRoot ?? '';

  return (
    <div className="memory-panel-content">
      {/* ── Vault path ──────────────────────────────────────────────────── */}
      <Card>
        <CardTitle>
          <FolderInput size={14} /> Vault location
        </CardTitle>
        <CardMeta>
          The on-disk folder where notes and memory metadata live. Default:{' '}
          <code>~/.bizar_memory</code>.
        </CardMeta>
        <div className="memory-config-form">
          <Row label="Current path" inline>
            <span className="memory-vault-path mono" data-testid="memory-current-vault-path">
              {currentVaultPath || <span className="muted">not initialised</span>}
            </span>
            {initialised ? (
              <span
                className="memory-pill memory-pill-ok"
                style={{ marginLeft: 8 }}
                title="Vault folder exists on disk"
              >
                <CheckCircle2 size={10} /> initialised
              </span>
            ) : (
              <span
                className="memory-pill memory-pill-warn"
                style={{ marginLeft: 8 }}
                title="Vault folder does not exist yet"
              >
                <XCircle size={10} /> not initialised
              </span>
            )}
          </Row>
          <Row label="Set path">
            <input
              type="text"
              className="input mono"
              value={vaultPathDraft}
              onChange={(e) => setVaultPathDraft(e.target.value)}
              placeholder="~/.bizar_memory"
              aria-label="Vault path"
              data-testid="memory-vault-path-input"
            />
            <span className="field-hint">
              {initialised
                ? 'Save to update the working path.'
                : 'Save and initialise will create this folder if it does not exist.'}
            </span>
          </Row>
        </div>
        <div className="memory-action-row" style={{ marginTop: 12 }}>
          <Button
            variant="primary"
            onClick={onSaveVaultPath}
            disabled={pathSaving || pathInitialising || !vaultPathDraft.trim()}
            data-testid="memory-save-vault-path"
          >
            {pathSaving ? <Loader2 size={12} className="memory-spin" /> : <Save size={12} />}
            {initialised ? 'Save path' : 'Save and initialise'}
          </Button>
          {!initialised && (
            <Button
              variant="secondary"
              onClick={onInitVault}
              disabled={pathInitialising || pathSaving}
              data-testid="memory-init-vault"
            >
              {pathInitialising ? <Loader2 size={12} className="memory-spin" /> : <FolderInput size={12} />}
              Initialise default
            </Button>
          )}
        </div>
      </Card>

      {/* ── Git sync ───────────────────────────────────────────────────── */}
      <Card>
        <CardTitle><GitBranch size={14} /> Git sync</CardTitle>
        <CardMeta>Configure the git remote and sync your memory vault.</CardMeta>
        <div className="memory-config-form">
          <Row label="Remote URL">
            <input
              type="text"
              className="input mono"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="git@github.com:org/repo.git"
            />
          </Row>
          {syncStatus && (
            <Row label="Status" inline>
              <span className={cn('memory-pill', syncStatus.clean ? 'memory-pill-ok' : 'memory-pill-warn')}>
                {syncStatus.clean ? 'clean' : 'dirty'}
              </span>
              {syncStatus.branch && (
                <span className="muted" style={{ marginLeft: 8 }}>
                  <GitBranch size={12} style={{ display: 'inline' }} /> {syncStatus.branch}
                </span>
              )}
              {!syncStatus.clean && syncStatus.modified !== undefined && (
                <span className="muted" style={{ marginLeft: 8 }}>
                  {syncStatus.modified} modified, {syncStatus.untracked} untracked
                </span>
              )}
            </Row>
          )}
        </div>
        <div className="memory-action-row" style={{ marginTop: 12 }}>
          <Button
            variant="secondary"
            onClick={() => runAction('pull')}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'pull' ? <Loader2 size={12} className="memory-spin" /> : <Download size={12} />}
            Pull
          </Button>
          <Button
            variant="secondary"
            onClick={() => runAction('commit')}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'commit' ? <Loader2 size={12} className="memory-spin" /> : <GitCommitHorizontal size={12} />}
            Commit
          </Button>
          <Button
            variant="secondary"
            onClick={() => runAction('push')}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'push' ? <Loader2 size={12} className="memory-spin" /> : <Upload size={12} />}
            Push
          </Button>
        </div>
      </Card>

      {/* ── Connection tests ─────────────────────────────────────────── */}
      <Card>
        <CardTitle>
          <Plug size={14} /> Connection tests
        </CardTitle>
        <CardMeta>Verify the configured git remote is reachable.</CardMeta>
        <div className="memory-action-row">
          <Button variant="secondary" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 size={12} className="memory-spin" /> : <Plug size={12} />}
            Test git connection
          </Button>
          <Button variant="primary" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 size={12} className="memory-spin" /> : <Save size={12} />}
            Save config
          </Button>
        </div>
        {tests && tests.length > 0 && (
          <ul className="memory-check-list" style={{ marginTop: 12 }}>
            {tests.map((t, i) => (
              <li key={i} className="memory-check-row">
                <span className="memory-check-icon">
                  <span className={cn('memory-pill', t.pass ? 'memory-pill-ok' : 'memory-pill-warn')}>
                    {t.pass ? 'OK' : 'FAIL'}
                  </span>
                </span>
                <span className="memory-check-name">{t.name}</span>
                <span className="memory-check-detail muted">{t.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Row({
  label,
  children,
  inline,
}: {
  label: string;
  children: React.ReactNode;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className="memory-config-row-inline">
        <div className="memory-config-row-label" id={`cfg-${label.replace(/\s+/g, '-').toLowerCase()}`}>{label}</div>
        <div
          className="memory-config-row-control"
          role="group"
          aria-labelledby={`cfg-${label.replace(/\s+/g, '-').toLowerCase()}`}
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <label className="memory-config-row-stack">
      <span>{label}</span>
      {children}
    </label>
  );
}
