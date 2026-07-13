import { useCallback, useEffect, useState } from 'react';
import { Stethoscope, RefreshCw, ShieldCheck, AlertTriangle, XCircle, CheckCircle2, Loader2 } from 'lucide-react';
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
import type { LucideIcon } from 'lucide-react';

/**
 * DoctorView — Sprint S35. Health rollup + per-check triggers.
 */

type Status = 'ok' | 'warn' | 'fail';

interface CheckResult {
  name: string;
  status: Status;
  message: string;
  error?: string;
}

interface HealthRollup {
  status: Status;
  issues: Array<{ name: string; status: Status; message: string }>;
}

const STATUS_ICON: Record<Status, LucideIcon> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
};

const STATUS_TONE = {
  ok: 'success',
  warn: 'warning',
  fail: 'danger',
} as const;

export function DoctorView(): JSX.Element {
  const snap = useFetch<{ health: HealthRollup; checks: CheckResult[]; recentErrors?: unknown[] }>('/api/doctor');
  const health = useFetch<HealthRollup>('/api/doctor/health');
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-poll health every 30s for a live rollup.
  useEffect(() => {
    const id = setInterval(() => { void health.refetch(); }, 30_000);
    return () => clearInterval(id);
  }, [health]);

  const runCheck = async (name: string): Promise<void> => {
    setRunning(name);
    setError(null);
    try {
      await fetchJson('/api/doctor/check', { method: 'POST', body: { checkName: name } });
      void snap.refetch();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setRunning(null);
    }
  };

  const rollup = health.data ?? snap.data?.health;
  const checks = snap.data?.checks ?? [];

  return (
    <Stack gap={5}>
      <ViewHeader
        title="Doctor"
        description="System diagnostics. Health poll every 30s; click any check to re-run."
        actions={
          <Inline gap={2} align="center">
            {error !== null && <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>}
            <Button variant="ghost" onClick={() => void snap.refetch()} data-testid="doctor-refresh">
              <RefreshCw size={14} aria-hidden /> Refresh
            </Button>
          </Inline>
        }
      />

      {rollup ? (
        <Card variant="elevated">
          <CardBody>
            <Inline align="center" gap={3}>
              {(() => {
                const Icon = STATUS_ICON[rollup.status];
                return <Icon size={20} aria-hidden />;
              })()}
              <Stack gap={0}>
                <strong style={{ fontSize: 'var(--fs-14)' }}>Health: {rollup.status.toUpperCase()}</strong>
                <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>
                  {rollup.issues.length === 0 ? 'No issues detected.' : `${rollup.issues.length} issue${rollup.issues.length === 1 ? '' : 's'}`}
                </span>
              </Stack>
            </Inline>
          </CardBody>
        </Card>
      ) : (
        <Skeleton style={{ height: 64 }} />
      )}

      {snap.loading && checks.length === 0 ? (
        <Stack gap={2}>
          <Skeleton style={{ height: 64 }} />
          <Skeleton style={{ height: 64 }} />
        </Stack>
      ) : checks.length === 0 ? (
        <EmptyState
          icon={<Stethoscope size={32} aria-hidden />}
          title="No checks yet"
          description="The Doctor snapshot returned no checks."
        />
      ) : (
        <Stack gap={2}>
          {checks.map((c) => {
            const Icon = STATUS_ICON[c.status];
            const busy = running === c.name;
            return (
              <Card key={c.name} variant="default">
                <CardBody>
                  <Inline align="center" justify="between" gap={3}>
                    <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                      <Inline align="center" gap={2}>
                        <Icon size={14} aria-hidden />
                        <strong>{c.name}</strong>
                        <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                      </Inline>
                      <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>{c.message}</span>
                      {c.error && <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)', fontFamily: 'var(--font-mono)' }}>{c.error}</span>}
                    </Stack>
                    <Button variant="ghost" onClick={() => void runCheck(c.name)} disabled={busy} data-testid={`doctor-run-${c.name}`}>
                      {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <ShieldCheck size={12} aria-hidden />}
                      {busy ? 'Running…' : 'Re-run'}
                    </Button>
                  </Inline>
                </CardBody>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}