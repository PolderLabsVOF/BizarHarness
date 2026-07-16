import { useEffect, useState } from 'react';
import { Activity, RefreshCw, FileText } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Badge } from '../../ui/data/Badge.js';
import { Button } from '../../ui/controls/Button.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { useFetch } from '../../data/useFetch.js';

/**
 * DiagnosticsView — Sprint S35. System snapshot + active log tail.
 */

interface DiagnosticsHealth {
  status: string;
  checks?: Array<{ name: string; status: string; message?: string }>;
}

interface DiagnosticsSnapshot {
  health?: DiagnosticsHealth;
  uptime?: number;
  version?: string;
  memory?: { used?: number; total?: number };
  checks?: Array<{ name: string; status: string; message?: string }>;
}

interface LogsResponse {
  lines: string[];
  file: string | null;
  total: number;
}

function fmtUptime(secs: number | undefined): string {
  if (!secs || secs <= 0) return '—';
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function DiagnosticsView(): JSX.Element {
  const snap = useFetch<DiagnosticsSnapshot>('/api/diagnostics');
  const logs = useFetch<LogsResponse>('/api/diagnostics/logs?tail=200');

  // Auto-refresh logs every 10s while page is open.
  useEffect(() => {
    const id = setInterval(() => { void logs.refetch(); }, 10_000);
    return () => clearInterval(id);
  }, [logs]);

  const health = snap.data?.health;
  const uptime = snap.data?.uptime;
  const checks = snap.data?.checks ?? [];
  const lines = logs.data?.lines ?? [];
  const logFile = logs.data?.file ?? null;

  return (
    <Stack gap={5} data-testid="diagnostics-view">
      <ViewHeader
        title="Diagnostics"
        description="Live system snapshot + active log tail. Auto-refresh every 10s."
        actions={
          <Button variant="ghost" onClick={() => { void snap.refetch(); void logs.refetch(); }} data-testid="diagnostics-refresh">
            <RefreshCw size={14} aria-hidden /> Refresh
          </Button>
        }
      />

      <Grid cols={3}>
        <Card variant="default">
          <CardBody>
            <Stack gap={1}>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Status</span>
              <Inline align="center" gap={2}>
                <Activity size={14} aria-hidden />
                <strong style={{ fontFamily: 'var(--font-mono)' }}>{snap.loading ? '…' : health?.status ?? 'unknown'}</strong>
              </Inline>
            </Stack>
          </CardBody>
        </Card>
        <Card variant="default">
          <CardBody>
            <Stack gap={1}>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Uptime</span>
              <strong style={{ fontFamily: 'var(--font-mono)' }}>{fmtUptime(uptime)}</strong>
            </Stack>
          </CardBody>
        </Card>
        <Card variant="default">
          <CardBody>
            <Stack gap={1}>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Version</span>
              <strong style={{ fontFamily: 'var(--font-mono)' }}>{snap.data?.version ?? '—'}</strong>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      {checks.length > 0 && (
        <Card variant="default">
          <CardBody>
            <Stack gap={2}>
              <strong>Checks ({checks.length})</strong>
              <Inline gap={1} wrap={true}>
                {checks.map((c) => (
                  <Badge key={c.name} tone={c.status === 'ok' ? 'success' : c.status === 'warn' ? 'warning' : 'danger'}>
                    {c.name}
                  </Badge>
                ))}
              </Inline>
            </Stack>
          </CardBody>
        </Card>
      )}

      <Card variant="default">
        <CardBody>
          <Stack gap={2}>
            <Inline align="center" justify="between">
              <Inline align="center" gap={2}>
                <FileText size={14} aria-hidden />
                <strong>Log tail</strong>
                {logFile && <code style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{logFile}</code>}
              </Inline>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{lines.length} / {logs.data?.total ?? 0} lines</span>
            </Inline>
            {logs.loading && lines.length === 0 ? (
              <Skeleton style={{ height: 240 }} />
            ) : lines.length === 0 ? (
              <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>No log lines yet.</span>
            ) : (
              <pre
                data-testid="diagnostics-log-tail"
                style={{
                  maxHeight: 320,
                  overflowY: 'auto',
                  padding: 'var(--space-3)',
                  background: 'var(--surface-1)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--fs-12)',
                  fontFamily: 'var(--font-mono)',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {lines.join('\n')}
              </pre>
            )}
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}