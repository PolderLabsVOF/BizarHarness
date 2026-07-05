// src/web/views/memory/LightragPanel.tsx — LightRAG controls, stats, query.
import { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  CheckCircle2,
  Database,
  Loader2,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  RotateCw,
  Search as SearchIcon,
  Sparkles,
  XCircle,
  Zap,
} from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, CardMeta, CardTitle } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Spinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { formatTime, cn } from '../../lib/utils';

type Stats = {
  running: boolean;
  pid: number | null;
  host: string;
  port: number;
  workingDir: string;
  lastReindexAt: string | null;
  lastReindexOk: boolean | null;
  lastReindexInserted: number | null;
  lastReindexFailed: number | null;
  noteCount: number;
  indexedApprox: number;
  queryCountLast24h: number;
  avgResponseMs: number | null;
};

type Config = {
  enabled: boolean;
  host: string;
  port: number;
  workingDir: string;
  llmBinding: string;
  embeddingBinding: string;
  llmModel: string;
  embeddingModel: string;
};

type Props = { refreshKey: number };

export function LightragPanel({ refreshKey }: Props) {
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [logTail, setLogTail] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [s, c, log] = await Promise.all([
        api.get<Stats>('/memory/lightrag/stats').catch(() => null),
        api.get<{ lightrag?: Config }>('/memory/config').then((r) => r?.lightrag || null).catch(() => null),
        api.get<{ lines: string[] }>('/memory/lightrag/log').catch(() => ({ lines: [] })),
      ]);
      setStats(s);
      setConfig(c);
      setLogTail(log?.lines || []);
    } catch (err) {
      toast.error(`LightRAG status failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const runCommand = async (key: string, fn: () => Promise<unknown>, successMsg: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(successMsg);
      await reload();
    } catch (err) {
      toast.error(`${key} failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onStart = () => runCommand('start', () => api.post('/memory/lightrag/start', {}), 'LightRAG starting…');
  const onStop = () => runCommand('stop', () => api.post('/memory/lightrag/stop', {}), 'LightRAG stopping…');
  const onRestart = async () => {
    setBusy('restart');
    try {
      await api.post('/memory/lightrag/stop', {}).catch(() => {});
      await new Promise((r) => setTimeout(r, 600));
      await api.post('/memory/lightrag/start', {});
      toast.success('LightRAG restarted.');
      await reload();
    } catch (err) {
      toast.error(`Restart failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  const onReindex = () => runCommand('reindex', () => api.post('/memory/lightrag/reindex', {}), 'Reindex complete.');
  const onRebuild = () => runCommand('rebuild', () => api.post('/memory/lightrag/rebuild-graph', {}), 'Graph rebuilt.');

  const onQuery = async () => {
    if (!query.trim()) return;
    setBusy('query');
    try {
      const r = await api.get<{ ok: boolean; q: string; semantic?: { ok: boolean; response?: unknown; error?: string } }>(
        `/memory/query?q=${encodeURIComponent(query)}&topK=8`,
      );
      const text = r?.semantic?.response
        ? (typeof r.semantic.response === 'string'
          ? r.semantic.response
          : JSON.stringify(r.semantic.response))
        : (r?.semantic?.error || 'No response');
      setQueryResult({ ok: !!r?.semantic?.ok, text });
    } catch (err) {
      setQueryResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (loading && !stats) {
    return (
      <div className="view-loading">
        <Spinner size="lg" />
        <p>Loading LightRAG status…</p>
      </div>
    );
  }
  if (!stats) {
    return <div className="muted">No LightRAG data available.</div>;
  }

  return (
    <div className="memory-panel-content">
      {/* ── Status header ───────────────────────────────────────────── */}
      <Card variant="elevated">
        <CardTitle>
          <Brain size={14} />
          LightRAG
          <span className={cn('memory-source-pill-status', stats.running ? 'on' : 'off')}>
            {stats.running ? 'running' : 'stopped'}
          </span>
        </CardTitle>
        <CardMeta>
          {stats.running
            ? <>PID <code>{stats.pid}</code> · {stats.host}:{stats.port}</>
            : <>Server is not running. Start it from the controls below.</>}
        </CardMeta>
        <div className="memory-action-row">
          <Button variant="primary" size="sm" onClick={onStart} disabled={!!busy || stats.running}>
            {busy === 'start' ? <Loader2 size={12} className="memory-spin" /> : <Play size={12} />}
            Start
          </Button>
          <Button variant="secondary" size="sm" onClick={onStop} disabled={!!busy || !stats.running}>
            {busy === 'stop' ? <Loader2 size={12} className="memory-spin" /> : <PowerOff size={12} />}
            Stop
          </Button>
          <Button variant="secondary" size="sm" onClick={onRestart} disabled={!!busy}>
            {busy === 'restart' ? <Loader2 size={12} className="memory-spin" /> : <Power size={12} />}
            Restart
          </Button>
          <Button variant="ghost" size="sm" onClick={onReindex} disabled={!!busy}>
            {busy === 'reindex' ? <Loader2 size={12} className="memory-spin" /> : <RefreshCw size={12} />}
            Reindex all
          </Button>
          <Button variant="ghost" size="sm" onClick={onRebuild} disabled={!!busy} title="Wipe working dir + reindex from scratch">
            {busy === 'rebuild' ? <Loader2 size={12} className="memory-spin" /> : <RotateCw size={12} />}
            Rebuild graph
          </Button>
        </div>
      </Card>

      {/* ── Stat cards ─────────────────────────────────────────────── */}
      <div className="memory-stat-grid">
        <StatBox icon={<Database size={14} />} label="Indexed chunks (approx)" value={String(stats.indexedApprox)} />
        <StatBox icon={<FileTextCount n={stats.noteCount} />} label="Notes in vault" value={String(stats.noteCount)} />
        <StatBox icon={<Zap size={14} />} label="Queries last 24h" value={String(stats.queryCountLast24h)} />
        <StatBox
          icon={<Sparkles size={14} />}
          label="Avg response"
          value={stats.avgResponseMs !== null ? `${stats.avgResponseMs} ms` : '—'}
        />
        <StatBox
          icon={stats.lastReindexOk ? <CheckCircle2 size={14} /> : stats.lastReindexOk === false ? <XCircle size={14} /> : <RefreshCw size={14} />}
          label="Last reindex"
          value={stats.lastReindexAt ? formatTime(stats.lastReindexAt) : 'never'}
          sub={stats.lastReindexInserted !== null
            ? `${stats.lastReindexInserted} inserted${stats.lastReindexFailed ? `, ${stats.lastReindexFailed} failed` : ''}`
            : undefined}
        />
      </div>

      {/* ── Quick search ───────────────────────────────────────────── */}
      <Card>
        <CardTitle>
          <SearchIcon size={14} /> Quick search
        </CardTitle>
        <CardMeta>Send a natural-language query to the LightRAG index.</CardMeta>
        <div className="memory-search-row">
          <input
            type="text"
            className="input"
            placeholder="e.g. how does the memory service write notes?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onQuery();
            }}
            disabled={busy === 'query'}
          />
          <Button variant="primary" onClick={onQuery} disabled={busy === 'query' || !query.trim()}>
            {busy === 'query' ? <Loader2 size={12} className="memory-spin" /> : <SearchIcon size={12} />}
            Query
          </Button>
        </div>
        {queryResult && (
          <div className={cn('memory-query-result', queryResult.ok ? 'ok' : 'err')}>
            <pre className="mono text-sm">{queryResult.text}</pre>
          </div>
        )}
      </Card>

      {/* ── Config snapshot ────────────────────────────────────────── */}
      {config && (
        <Card>
          <CardTitle>Configuration</CardTitle>
          <CardMeta>Effective values from <code>.bizar/memory.json</code> + env defaults.</CardMeta>
          <dl className="memory-config-row">
            <dt>LLM binding</dt>
            <dd><code>{config.llmBinding}</code> · <code>{config.llmModel}</code></dd>
            <dt>Embedding</dt>
            <dd><code>{config.embeddingBinding}</code> · <code>{config.embeddingModel}</code></dd>
            <dt>Host</dt>
            <dd><code>{config.host}:{config.port}</code></dd>
            <dt>Working dir</dt>
            <dd className="mono ellipsis" title={config.workingDir}>{config.workingDir}</dd>
          </dl>
        </Card>
      )}

      {/* ── Log tail ───────────────────────────────────────────────── */}
      {logTail.length > 0 && (
        <Card>
          <CardTitle>
            <RefreshCw size={14} /> Server log (tail)
          </CardTitle>
          <CardMeta>Last {logTail.length} lines from <code>lightrag.log</code></CardMeta>
          <pre className="memory-log-tail mono text-xs">
            {logTail.join('\n')}
          </pre>
        </Card>
      )}
    </div>
  );
}

function StatBox({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="memory-stat-card">
      <div className="memory-stat-icon">{icon}</div>
      <div className="memory-stat-body">
        <div className="memory-stat-label">{label}</div>
        <div className="memory-stat-value">{value}</div>
        {sub && <div className="memory-stat-sub muted">{sub}</div>}
      </div>
    </div>
  );
}

function FileTextCount({ n }: { n: number }) {
  // Stable icon — use FileText with a small badge
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <SearchIcon size={14} />
      <span className="memory-mini-badge">{n}</span>
    </span>
  );
}