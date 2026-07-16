import { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, Clock, Zap } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { ErrorState } from '../../ui/feedback/ErrorState.js';
import { useFetch } from '../../data/useFetch.js';

/**
 * UsageView — Sprint S35. Token usage analytics from JSONL logs.
 */

type Range = '24h' | '7d' | '30d';

interface UsageTotals {
  tokens: number;
  cost?: number;
  requests: number;
}

interface UsageByProvider {
  providerId: string;
  tokens: number;
  requests: number;
}

interface UsageResponse {
  totals: UsageTotals;
  byProvider?: UsageByProvider[];
  byModel?: Array<{ modelId: string; tokens: number; requests: number }>;
  series?: Array<{ ts: number; tokens: number }>;
}

interface LimitEntry {
  providerId?: string;
  modelId?: string;
  remaining?: number;
  limit?: number;
}

interface LimitsResponse {
  models: LimitEntry[];
}

const RANGE_OPTIONS: Array<{ id: Range; label: string }> = [
  { id: '24h', label: '24 hours' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
];

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function StatTile({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: typeof BarChart3 }): JSX.Element {
  return (
    <Card variant="default">
      <CardBody>
        <Stack gap={1}>
          <Inline align="center" gap={2}>
            <Icon size={14} aria-hidden />
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{label}</span>
          </Inline>
          <strong style={{ fontSize: 'var(--fs-18)', fontFamily: 'var(--font-mono)' }}>{value}</strong>
          {sub && <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{sub}</span>}
        </Stack>
      </CardBody>
    </Card>
  );
}

export function UsageView(): JSX.Element {
  const [range, setRange] = useState<Range>('24h');
  const res = useFetch<UsageResponse>(`/api/usage?range=${range}`);
  const limits = useFetch<LimitsResponse>('/api/usage/limits');

  useEffect(() => {
    // refetch on range change is implicit (useFetch re-keys on URL change).
  }, [range]);

  const totals = res.data?.totals;
  const byProvider = res.data?.byProvider ?? [];
  const byModel = res.data?.byModel ?? [];
  const maxProvider = byProvider.reduce((m, p) => Math.max(m, p.tokens), 0);

  return (
    <Stack gap={5} data-testid="usage-view">
      <ViewHeader
        title="Usage"
        description="Token consumption + quota limits from the rolling JSONL log."
        actions={
          <Inline gap={1}>
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                aria-pressed={range === r.id}
                data-testid={`usage-range-${r.id}`}
                style={{
                  padding: '4px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: range === r.id ? 'var(--accent)' : 'var(--surface-1)',
                  color: range === r.id ? 'var(--accent-fg)' : 'var(--fg)',
                  fontSize: 'var(--fs-12)',
                  cursor: 'pointer',
                }}
              >
                {r.label}
              </button>
            ))}
          </Inline>
        }
      />

      <Grid cols={3}>
        <StatTile
          label="Total tokens"
          icon={BarChart3}
          value={res.loading ? '…' : fmtTokens(totals?.tokens ?? 0)}
          sub={totals ? `${totals.requests} requests` : ''}
        />
        <StatTile
          label="Distinct providers"
          icon={TrendingUp}
          value={res.loading ? '…' : String(byProvider.length)}
        />
        <StatTile
          label="Live limits"
          icon={Zap}
          value={limits.loading ? '…' : String(limits.data?.models?.length ?? 0)}
          sub="active quotas"
        />
      </Grid>

      {res.loading ? (
        <Skeleton style={{ height: 200 }} />
      ) : res.error && byProvider.length === 0 ? (
        <ErrorState
          block
          title="Couldn't load usage"
          description="Token analytics failed to fetch. Retry to refetch."
          error={res.error}
          onRetry={() => void res.refetch()}
          testid="usage-error"
        />
      ) : byProvider.length === 0 ? (
        <Card variant="default">
          <CardBody>
            <Stack gap={1} align="center" style={{ padding: 'var(--space-4)' }}>
              <Clock size={24} aria-hidden />
              <span style={{ color: 'var(--fg-muted)' }}>No usage records for the last {range}.</span>
            </Stack>
          </CardBody>
        </Card>
      ) : (
        <Card variant="default">
          <CardBody>
            <Stack gap={3}>
              <strong>By provider</strong>
              <Stack gap={2}>
                {byProvider.map((p) => (
                  <Stack key={p.providerId} gap={1}>
                    <Inline align="center" justify="between">
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>{p.providerId}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                        {fmtTokens(p.tokens)} · {p.requests} req
                      </span>
                    </Inline>
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={maxProvider || 1}
                      aria-valuenow={p.tokens}
                      style={{
                        height: 6,
                        background: 'var(--surface-1)',
                        borderRadius: 'var(--radius-pill)',
                        overflow: 'hidden',
                      }}
                    >
                      <div style={{ width: `${maxProvider > 0 ? (p.tokens / maxProvider) * 100 : 0}%`, height: '100%', background: 'var(--accent)' }} />
                    </div>
                  </Stack>
                ))}
              </Stack>
              {byModel.length > 0 && (
                <Stack gap={2}>
                  <strong>Top models</strong>
                  {byModel.slice(0, 5).map((m) => (
                    <Inline key={m.modelId} align="center" justify="between" style={{ fontSize: 'var(--fs-12)' }}>
                      <code style={{ fontFamily: 'var(--font-mono)' }}>{m.modelId}</code>
                      <span style={{ color: 'var(--fg-muted)' }}>{fmtTokens(m.tokens)}</span>
                    </Inline>
                  ))}
                </Stack>
              )}
            </Stack>
          </CardBody>
        </Card>
      )}
    </Stack>
  );
}