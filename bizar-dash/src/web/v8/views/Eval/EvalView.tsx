import { useEffect, useState } from 'react';
import { FlaskConical, Play, RefreshCw, Loader2 } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Badge } from '../../ui/data/Badge.js';
import { Button } from '../../ui/controls/Button.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

/**
 * EvalView — Sprint S35. Eval runs list + launch new suite.
 */

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface EvalRun {
  id: string;
  suite?: string;
  status?: 'queued' | 'running' | 'done' | 'failed';
  passed?: number;
  failed?: number;
  total?: number;
  startedAt?: string;
  durationMs?: number;
}

function statusTone(s: EvalRun['status'] | undefined): Tone {
  if (s === 'done') return 'success';
  if (s === 'failed') return 'danger';
  if (s === 'running') return 'info';
  if (s === 'queued') return 'warning';
  return 'neutral';
}

function fmtDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function EvalView(): JSX.Element {
  const runs = useFetch<{ runs: EvalRun[] }>('/api/eval/runs?limit=20');
  const [launching, setLaunching] = useState(false);
  const [suite, setSuite] = useState('default');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (runs.data?.runs) {
      const hasActive = runs.data.runs.some((r) => r.status === 'running' || r.status === 'queued');
      if (hasActive) {
        const id = setTimeout(() => { void runs.refetch(); }, 5_000);
        return () => clearTimeout(id);
      }
    }
  }, [runs]);

  const launch = async (): Promise<void> => {
    setLaunching(true);
    setError(null);
    try {
      await fetchJson('/api/eval/run', { method: 'POST', body: { suite } });
      void runs.refetch();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const list = runs.data?.runs ?? [];

  return (
    <Stack gap={5} data-testid="eval-view">
      <ViewHeader
        title="Eval framework"
        description="Run evaluation suites against the agent model. Suites live under fixtures/."
        actions={
          <Inline gap={2} align="center">
            {error !== null && <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>}
            <input
              value={suite}
              onChange={(e) => setSuite(e.target.value)}
              placeholder="suite name"
              disabled={launching}
              data-testid="eval-suite-input"
              style={{
                padding: '6px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-0)',
                color: 'var(--fg)',
                fontSize: 'var(--fs-13)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <Button variant="primary" onClick={() => void launch()} disabled={launching || !suite.trim()} data-testid="eval-launch">
              {launching ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Play size={14} aria-hidden />}
              {launching ? 'Launching…' : 'Run suite'}
            </Button>
            <Button variant="ghost" onClick={() => void runs.refetch()} data-testid="eval-refresh">
              <RefreshCw size={14} aria-hidden /> Refresh
            </Button>
          </Inline>
        }
      />

      {runs.loading && list.length === 0 ? (
        <Stack gap={2}>
          <Skeleton style={{ height: 80 }} />
          <Skeleton style={{ height: 80 }} />
        </Stack>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<FlaskConical size={32} aria-hidden />}
          title="No eval runs yet"
          description="Launch a suite to begin measuring agent quality."
        />
      ) : (
        <Stack gap={2}>
          {list.map((r) => (
            <Card key={r.id} variant="default">
              <CardBody>
                <Inline align="center" justify="between" gap={3}>
                  <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                    <Inline align="center" gap={2}>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{r.id}</strong>
                      <Badge tone={statusTone(r.status)}>{r.status ?? 'unknown'}</Badge>
                      {r.suite && <Badge tone="neutral">{r.suite}</Badge>}
                    </Inline>
                    <Inline align="center" gap={3} style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>
                      <span>{r.startedAt ? new Date(r.startedAt).toLocaleString() : ''}</span>
                      <span>{fmtDuration(r.durationMs)}</span>
                    </Inline>
                  </Stack>
                  <Stack align="end" gap={0}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-14)' }}>
                      <strong style={{ color: 'var(--success)' }}>{r.passed ?? 0}</strong> pass
                      {' / '}
                      <strong style={{ color: 'var(--danger)' }}>{r.failed ?? 0}</strong> fail
                    </span>
                    <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{(r.total ?? 0)} total</span>
                  </Stack>
                </Inline>
              </CardBody>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}