// src/web/views/memory/ConfigPanel.tsx — simplified memory config.
import { useEffect, useState } from 'react';
import {
  GitBranch,
  GitCommitHorizontal,
  Download,
  Upload,
  Loader2,
  Plug,
  Save,
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

type Props = { refreshKey: number };

export function ConfigPanel({ refreshKey }: Props) {
  const toast = useToast();
  const [cfg, setCfg] = useState<GlobalConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [vaultPath] = useState<string>('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [tests, setTests] = useState<Array<{ name: string; pass: boolean; detail: string }> | null>(null);
  const [testing, setTesting] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await api.get<{ config: GlobalConfig }>('/memory/config/global');
      setCfg(r.config);
      setRemoteUrl(r.config?.git?.remoteUrl || '');
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

  return (
    <div className="memory-panel-content">
      {/* ── Git sync ───────────────────────────────────────────────────── */}
      <Card>
        <CardTitle><GitBranch size={14} /> Git sync</CardTitle>
        <CardMeta>Configure the git remote and sync your memory vault.</CardMeta>
        <div className="memory-config-form">
          <Row label="Vault path" inline>
            <span className="memory-vault-path mono muted">{vaultPath || '(loading…)'}</span>
          </Row>
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
