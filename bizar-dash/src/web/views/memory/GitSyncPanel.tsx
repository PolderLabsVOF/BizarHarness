// src/web/views/memory/GitSyncPanel.tsx — git status, pull/push/commit/fetch, diff viewer.
import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, CardMeta, CardTitle } from '../../components/Card';
import { Spinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { formatTime, cn } from '../../lib/utils';

type GitStatus = {
  ok: boolean;
  clean?: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  modified?: string[];
  untracked?: string[];
  mode?: string;
};

type GitDiff = {
  hasDiff: boolean;
  lines: string[];
  files: string[];
  mode: string;
};

type Props = { refreshKey: number };

export function GitSyncPanel({ refreshKey }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [config, setConfig] = useState<{ repoPath?: string; remoteUrl?: string; branch?: string; autoSync?: boolean } | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [s, d, g] = await Promise.all([
        api.get<GitStatus>('/memory/git/status').catch(() => null),
        api.get<GitDiff>('/memory/git/diff').catch(() => null),
        api.get<{ config?: { git?: { repoPath?: string; remoteUrl?: string; branch?: string; autoSync?: boolean } } }>(
          '/memory/config/global',
        ).catch(() => null),
      ]);
      setStatus(s);
      setDiff(d);
      setConfig(g?.config?.git || null);
    } catch (err) {
      toast.error(`Git status failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const run = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(msg);
      await reload();
    } catch (err) {
      toast.error(`${key} failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onPull = () => run('pull', () => api.post('/memory/git/pull', {}), 'Pull complete.');
  const onPush = () => run('push', () => api.post('/memory/git/push', {}), 'Push complete.');
  const onCommit = () => {
    const message = prompt('Commit message:', `[memory-sync] ${new Date().toISOString().slice(0, 10)} vault sync`);
    if (!message) return;
    run('commit', () => api.post('/memory/git/commit', { message }), 'Committed.');
  };
  const onFetch = () => run('fetch', () => api.post('/memory/git/sync', { push: false }), 'Fetch complete.');

  if (loading && !status) {
    return (
      <div className="view-loading">
        <Spinner size="lg" />
        <p>Loading git status…</p>
      </div>
    );
  }
  if (!status) {
    return <div className="muted">No git data available.</div>;
  }

  const isLocal = status.mode === 'local-only';

  return (
    <div className="memory-panel-content">
      {/* ── Status card ───────────────────────────────────────────── */}
      <Card variant="elevated">
        <CardTitle>
          <GitBranch size={14} /> Git sync
          {isLocal ? (
            <span className="memory-source-pill-status na">local-only</span>
          ) : (
            <span className={cn('memory-source-pill-status', status.clean ? 'on' : 'warn')}>
              {status.clean ? 'clean' : 'dirty'}
            </span>
          )}
        </CardTitle>
        <CardMeta>
          {isLocal
            ? 'Memory is in local-only mode. Configure a shared repo in Settings → Memory to enable git sync.'
            : <>Branch <code>{status.branch || '—'}</code>{status.ahead ? <> · ahead {status.ahead}</> : null}{status.behind ? <> · behind {status.behind}</> : null}</>}
        </CardMeta>

        {!isLocal && (
          <div className="memory-git-status-row">
            <Pill ok={status.clean ?? false} label="Working tree" />
            <Pill ok={(status.ahead ?? 0) === 0} label={`Ahead: ${status.ahead ?? 0}`} />
            <Pill ok={(status.behind ?? 0) === 0} label={`Behind: ${status.behind ?? 0}`} />
            <Pill ok={(status.modified?.length ?? 0) === 0} label={`Modified: ${status.modified?.length ?? 0}`} />
            <Pill ok={(status.untracked?.length ?? 0) === 0} label={`Untracked: ${status.untracked?.length ?? 0}`} />
          </div>
        )}

        <div className="memory-action-row">
          <Button variant="secondary" size="sm" onClick={onPull} disabled={!!busy || isLocal}>
            {busy === 'pull' ? <Loader2 size={12} className="memory-spin" /> : <ArrowDown size={12} />}
            Pull
          </Button>
          <Button variant="secondary" size="sm" onClick={onPush} disabled={!!busy || isLocal}>
            {busy === 'push' ? <Loader2 size={12} className="memory-spin" /> : <ArrowUp size={12} />}
            Push
          </Button>
          <Button variant="secondary" size="sm" onClick={onCommit} disabled={!!busy || isLocal}>
            {busy === 'commit' ? <Loader2 size={12} className="memory-spin" /> : <GitCommit size={12} />}
            Commit
          </Button>
          <Button variant="ghost" size="sm" onClick={onFetch} disabled={!!busy || isLocal}>
            {busy === 'fetch' ? <Loader2 size={12} className="memory-spin" /> : <GitPullRequest size={12} />}
            Fetch + sync
          </Button>
          <Button variant="ghost" size="sm" onClick={reload} disabled={!!busy}>
            <RefreshCw size={12} /> Refresh
          </Button>
        </div>
      </Card>

      {/* ── Repo config snapshot ──────────────────────────────────── */}
      {config && (
        <Card>
          <CardTitle>
            <Settings size={14} /> Repository
          </CardTitle>
          <CardMeta>Snapshot of <code>~/.config/bizar/memory-config.json</code> → git block.</CardMeta>
          <dl className="memory-config-row">
            <dt>Path</dt>
            <dd className="mono ellipsis" title={config.repoPath}>{config.repoPath || '—'}</dd>
            <dt>Remote</dt>
            <dd className="mono ellipsis" title={config.remoteUrl}>{config.remoteUrl || '—'}</dd>
            <dt>Branch</dt>
            <dd><code>{config.branch || 'main'}</code></dd>
            <dt>Auto-sync</dt>
            <dd>{config.autoSync ? 'enabled' : 'disabled'}</dd>
          </dl>
        </Card>
      )}

      {/* ── Working-tree diff ─────────────────────────────────────── */}
      <Card>
        <CardTitle>
          <GitMerge size={14} /> Working-tree diff
        </CardTitle>
        <CardMeta>
          {diff?.hasDiff
            ? `${diff.files.length} file(s) changed`
            : 'no working-tree changes'}
        </CardMeta>
        {diff && diff.files.length > 0 && (
          <ul className="memory-diff-files">
            {diff.files.map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
        )}
        {diff && diff.lines.length > 1 && (
          <pre className="memory-log-tail mono text-xs">
            {diff.lines.slice(0, 400).join('\n')}
          </pre>
        )}
      </Card>
    </div>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn('memory-git-status-pill', ok ? 'ok' : 'warn')}>
      {ok ? <CheckCircle2 size={11} /> : <Loader2 size={11} className="memory-spin" />}
      {label}
    </span>
  );
}