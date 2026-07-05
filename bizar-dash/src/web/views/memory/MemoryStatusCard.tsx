// src/web/views/memory/MemoryStatusCard.tsx — overview status card for the Memory subsystem.
//
// Slimmed-down version of MemoryOverview: a single Card with lightrag status,
// vault note count, git sync state, and a button to open the full Memory tab.
import { useEffect, useState } from 'react';
import {
  Activity,
  Brain,
  ExternalLink,
  FileText,
  GitBranch,
  RefreshCw,
} from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, CardMeta, CardTitle } from '../../components/Card';
import { api } from '../../lib/api';
import { formatTime, cn } from '../../lib/utils';

type MemoryCardData = {
  initialized: boolean;
  mode?: string;
  projectId?: string;
  vaultRoot?: string;
  branch?: string;
  gitClean?: boolean | null;
  noteCount?: number;
  healthScore?: number;
  healthStatus?: 'healthy' | 'degraded' | 'unhealthy' | 'unconfigured';
  lightrag?: { running: boolean; indexedApprox: number };
};

type Props = {
  setActiveTab: (id: string) => void;
  refreshKey?: number;
};

export function MemoryStatusCard({ setActiveTab, refreshKey = 0 }: Props) {
  const [data, setData] = useState<MemoryCardData | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const [status, health, lightrag] = await Promise.all([
        api.get<MemoryCardData>('/memory/status').catch(() => null),
        api.get<{ score: number; status: 'healthy' | 'degraded' | 'unhealthy' | 'unconfigured' }>(
          '/memory/health',
        ).catch(() => null),
        api.get<{ running: boolean; indexedApprox: number }>('/memory/lightrag/stats').catch(() => null),
      ]);
      setData({
        initialized: !!status?.initialized,
        mode: status?.mode,
        projectId: status?.projectId,
        vaultRoot: status?.vaultRoot,
        branch: status?.branch,
        gitClean: status?.gitClean,
        noteCount: status?.noteCount || 0,
        healthScore: health?.score,
        healthStatus: health?.status,
        lightrag: lightrag ? { running: lightrag.running, indexedApprox: lightrag.indexedApprox } : undefined,
      });
    } catch {
      setData({ initialized: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const openMemory = () => setActiveTab('memory');

  const healthColor =
    data?.healthStatus === 'healthy' ? 'var(--success)' :
    data?.healthStatus === 'degraded' ? 'var(--warning)' :
    data?.healthStatus === 'unhealthy' ? 'var(--error)' :
    'var(--text-dim)';

  return (
    <Card className="memory-overview-card">
      <CardTitle>
        <Brain size={14} /> Memory
        <Button variant="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={openMemory}>
          Open Memory <ExternalLink size={12} />
        </Button>
        <Button variant="ghost" size="sm" onClick={reload} aria-label="Refresh" title="Refresh">
          <RefreshCw size={12} />
        </Button>
      </CardTitle>
      <CardMeta>
        LightRAG + Obsidian vault + git sync — opens the dedicated Memory tab.
      </CardMeta>

      {!data?.initialized ? (
        <div className="muted">
          Memory not initialised. Click <strong>Open Memory</strong> to set it up.
        </div>
      ) : (
        <div className="memory-status-card-grid">
          <div className="memory-status-card-cell">
            <div className="memory-status-card-label">
              <Activity size={11} /> Health
            </div>
            <div className="memory-status-card-value" style={{ color: healthColor }}>
              {data.healthScore !== undefined ? `${data.healthScore}/100` : '—'}
            </div>
            <div className="memory-status-card-sub muted">{data.healthStatus || '—'}</div>
          </div>

          <div className="memory-status-card-cell">
            <div className="memory-status-card-label">
              <Brain size={11} /> LightRAG
            </div>
            <div className="memory-status-card-value">
              {data.lightrag?.running ? 'running' : 'stopped'}
            </div>
            <div className="memory-status-card-sub muted">
              {data.lightrag ? `${data.lightrag.indexedApprox} chunks` : '—'}
            </div>
          </div>

          <div className="memory-status-card-cell">
            <div className="memory-status-card-label">
              <FileText size={11} /> Vault
            </div>
            <div className="memory-status-card-value">{data.noteCount} notes</div>
            <div className="memory-status-card-sub muted ellipsis" title={data.vaultRoot || ''}>
              {data.vaultRoot ? data.vaultRoot.split('/').slice(-2).join('/') : '—'}
            </div>
          </div>

          <div className="memory-status-card-cell">
            <div className="memory-status-card-label">
              <GitBranch size={11} /> Git
            </div>
            <div className="memory-status-card-value">
              {data.gitClean === null
                ? data.mode === 'local-only' ? 'local-only' : '—'
                : data.gitClean ? 'clean' : 'dirty'}
            </div>
            <div className="memory-status-card-sub muted">
              {data.branch ? `branch ${data.branch}` : formatTime(data.branch || '') || '—'}
            </div>
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="muted text-sm">Loading…</div>
      )}
    </Card>
  );
}

// Allow css class composition without TS complaining about missing module declarations.
void cn;