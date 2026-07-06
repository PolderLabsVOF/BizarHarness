// src/web/views/memory/MemoryOverview.tsx — Memory tab overview panel (KPIs + sub-system pills).
import { useEffect, useState } from 'react';
import {
  Activity,
  Brain,
  CheckCircle2,
  Database,
  FileText,
  GitBranch,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, CardMeta, CardTitle } from '../../components/Card';
import { Spinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { formatTime, cn } from '../../lib/utils';

export type HealthResponse = {
  score: number;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unconfigured';
  checks: Array<{ name: string; pass: boolean; detail: string }>;
  message: string;
};

export type VaultStats = {
  exists: boolean;
  vaultRoot: string;
  mode: string;
  noteCount: number;
  totalSize: number;
  folderCount: number;
  folders: string[];
  lastModified: number | null;
  gitClean: boolean | null;
  gitBranch: string | null;
};

type MemoryStatus = {
  initialized: boolean;
  mode?: string;
  projectId?: string;
  vaultRoot?: string;
  branch?: string;
  gitClean?: boolean | null;
  noteCount?: number;
  lastSecretScan?: string | null;
};

type LightragStats = {
  running: boolean;
  pid: number | null;
  host: string;
  port: number;
  indexedApprox: number;
  queryCountLast24h: number;
  lastReindexAt: string | null;
  avgResponseMs?: number | null;
  noteCount?: number;
};

type StorageStats = {
  total: number;
  breakdown: Array<{ name: string; path: string; size: number }>;
};

export type MemoryOverviewData = {
  health: HealthResponse;
  vault: VaultStats;
  lightrag: {
    running: boolean;
    pid: number | null;
    host: string;
    port: number;
    indexedApprox: number;
    queryCountLast24h: number;
    lastReindexAt: string | null;
  };
  storage: {
    total: number;
    breakdown: Array<{ name: string; path: string; size: number }>;
  };
};

type Props = {
  refreshKey: number;
  onRefresh: () => void;
  setActiveSubPanel: (panel: 'overview' | 'lightrag' | 'obsidian' | 'git' | 'semantic' | 'config') => void;
};

export function MemoryOverview({ refreshKey, onRefresh, setActiveSubPanel }: Props) {
  const toast = useToast();
  const [data, setData] = useState<MemoryOverviewData | null>(null);
  const [vaultPath, setVaultPath] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const reload = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [health, status, lightrag, storage] = await Promise.all([
        api.get<HealthResponse>('/memory/health', signal).catch(() => null),
        api.get<MemoryStatus>('/memory/status', signal).catch(() => null),
        api.get<LightragStats>('/memory/lightrag/stats', signal).catch(() => null),
        api.get<StorageStats>('/memory/storage', signal).catch(() => null),
      ]);
      // v6.x — Surface the resolved vault path as a top-level piece of state
      // so the section header can display it instead of relying on
      // derived fields. Resolves the "(loading…)" UI bug in the Config panel.
      setVaultPath(status?.vaultRoot || '');
      setData({
        health: health || {
          score: 0,
          status: 'unconfigured',
          checks: [],
          message: 'memory not initialised',
        },
        vault: {
          exists: !!status?.initialized,
          vaultRoot: status?.vaultRoot || '',
          mode: status?.mode || 'local-only',
          noteCount: status?.noteCount || 0,
          totalSize: storage?.total || 0,
          folderCount: 0,
          folders: [],
          lastModified: null,
          gitClean: status?.gitClean ?? null,
          gitBranch: status?.branch || null,
        },
        lightrag: lightrag || {
          running: false,
          pid: null,
          host: '127.0.0.1',
          port: 9621,
          indexedApprox: 0,
          queryCountLast24h: 0,
          lastReindexAt: null,
        },
        storage: storage || { total: 0, breakdown: [] },
      });
    } catch (err) {
      toast.error(`Memory overview failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const ctrl = new AbortController();
    void reload(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (loading && !data) {
    return (
      <div className="view-loading">
        <Spinner size="lg" />
        <p>Loading memory overview…</p>
      </div>
    );
  }
  if (!data) {
    return <div className="muted">No memory data available.</div>;
  }

  const { health, vault, lightrag, storage } = data;
  const scoreColor =
    health.score >= 80 ? 'var(--success)' :
    health.score >= 50 ? 'var(--warning)' :
    'var(--error)';

  return (
    <div className="memory-overview">
      {/* ── Health score hero ─────────────────────────────────────────── */}
      <Card variant="elevated" className="memory-health-hero">
        <div className="memory-health-score" style={{ borderColor: scoreColor }}>
          <span className="memory-health-score-value" style={{ color: scoreColor }}>
            {health.score}
          </span>
          <span className="memory-health-score-label">/ 100</span>
        </div>
        <div className="memory-health-meta">
          <h3 className="memory-health-title">
            <Activity size={16} />
            Memory health ·{' '}
            <span style={{ color: scoreColor }}>{health.status}</span>
          </h3>
          <p className="memory-health-message">{health.message}</p>
          {/* v6.x — Vault path surfaced as a top-level piece of context.
              Resolves the "(loading…)" stuck-state in the Config panel. */}
          <p className="memory-health-vault mono muted" data-testid="memory-overview-vault-path">
            <span className="memory-health-vault-label">Vault:</span>{' '}
            {vaultPath || <em>not initialised</em>}
          </p>
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <RefreshCw size={12} /> Refresh
          </Button>
        </div>
      </Card>

      {/* ── Source pills ─────────────────────────────────────────────── */}
      <div className="memory-source-pills">
        <button
          type="button"
          className="memory-source-pill"
          onClick={() => setActiveSubPanel('lightrag')}
        >
          <Brain size={14} />
          <span>LightRAG</span>
          <span className={cn('memory-source-pill-status', lightrag.running ? 'on' : 'off')}>
            {lightrag.running ? 'running' : 'stopped'}
          </span>
        </button>
        <button
          type="button"
          className="memory-source-pill"
          onClick={() => setActiveSubPanel('obsidian')}
        >
          <FileText size={14} />
          <span>Obsidian Vault</span>
          <span className={cn('memory-source-pill-status', vault.exists ? 'on' : 'off')}>
            {vault.noteCount} notes
          </span>
        </button>
        <button
          type="button"
          className="memory-source-pill"
          onClick={() => setActiveSubPanel('git')}
        >
          <GitBranch size={14} />
          <span>Git Sync</span>
          <span className={cn(
            'memory-source-pill-status',
            vault.gitClean === null ? 'na' : vault.gitClean ? 'on' : 'warn',
          )}>
            {vault.gitClean === null ? '—' : vault.gitClean ? 'clean' : 'dirty'}
          </span>
        </button>
        <button
          type="button"
          className="memory-source-pill"
          onClick={() => setActiveSubPanel('semantic')}
        >
          <Search size={14} />
          <span>Semantic Search</span>
          <span className="memory-source-pill-status na">cross-source</span>
        </button>
      </div>

      {/* ── KPI grid ─────────────────────────────────────────────────── */}
      <div className="memory-stat-grid">
        <StatCard
          icon={<Brain size={16} />}
          label="LightRAG"
          value={lightrag.running ? `running · ${lightrag.queryCountLast24h} q/24h` : 'stopped'}
          sub={lightrag.running ? `${lightrag.indexedApprox} indexed chunks` : 'start from the LightRAG panel'}
          onClick={() => setActiveSubPanel('lightrag')}
        />
        <StatCard
          icon={<FileText size={16} />}
          label="Obsidian"
          value={`${vault.noteCount} notes`}
          sub={vault.folderCount > 0 ? `${vault.folderCount} folders` : 'no folders yet'}
          onClick={() => setActiveSubPanel('obsidian')}
        />
        <StatCard
          icon={<GitBranch size={16} />}
          label="Git"
          value={vault.gitBranch ? `branch ${vault.gitBranch}` : 'local-only'}
          sub={
            vault.gitClean === null ? 'not configured' :
            vault.gitClean ? 'clean working tree' :
            'dirty — commit or pull'
          }
          onClick={() => setActiveSubPanel('git')}
        />
        <StatCard
          icon={<Database size={16} />}
          label="Storage"
          value={formatBytes(storage.total)}
          sub={storage.breakdown.length > 0
            ? `${storage.breakdown.length} dirs tracked`
            : 'no memory data on disk'}
        />
        <StatCard
          icon={<Sparkles size={16} />}
          label="Last reindex"
          value={lightrag.lastReindexAt ? formatTime(lightrag.lastReindexAt) : 'never'}
          sub="lightrag ingest"
          onClick={() => setActiveSubPanel('lightrag')}
        />
        <StatCard
          icon={<ShieldCheck size={16} />}
          label="Health"
          value={`${health.score}/100`}
          sub={health.status}
          onClick={() => setActiveSubPanel('config')}
        />
      </div>

      {/* ── Health checks detail ─────────────────────────────────────── */}
      {health.checks.length > 0 && (
        <Card>
          <CardTitle>Health checks</CardTitle>
          <CardMeta>Composite score across all memory subsystems</CardMeta>
          <ul className="memory-check-list">
            {health.checks.map((c) => (
              <li key={c.name} className="memory-check-row">
                <span className="memory-check-icon">
                  {c.pass
                    ? <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
                    : c.name.includes('secrets') || c.name.includes('schema')
                      ? <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />
                      : <XCircle size={14} style={{ color: 'var(--error)' }} />}
                </span>
                <span className="memory-check-name">{c.name}</span>
                <span className="memory-check-detail muted">{c.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  onClick?: () => void;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn('memory-stat-card', onClick && 'memory-stat-card-clickable')}
    >
      <div className="memory-stat-icon">{icon}</div>
      <div className="memory-stat-body">
        <div className="memory-stat-label">{label}</div>
        <div className="memory-stat-value">{value}</div>
        <div className="memory-stat-sub muted">{sub}</div>
      </div>
    </Comp>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}