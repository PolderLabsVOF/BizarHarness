import { useCallback, useMemo, useState } from 'react';
import { Plus, Play, Power, Trash2, RefreshCw, Clock, type LucideIcon } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Badge } from '../../ui/data/Badge.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { ErrorState } from '../../ui/feedback/ErrorState.js';
import { Button } from '../../ui/controls/Button.js';
import { Switch } from '../../ui/controls/Switch.js';
import { Textarea } from '../../ui/controls/Textarea.js';
import { Sheet, SheetContent } from '../../ui/feedback/Sheet.js';
import { Input } from '../../ui/controls/Input.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import { useWsMessage } from '../../data/useWebSocket.js';

/**
 * SchedulesView — recurring / one-time job management.
 *
 * Renders `/api/schedules` (list), lets users toggle enabled, run on
 * demand, create new schedules (interval / cron / once), and delete.
 */

type ScheduleType = 'interval' | 'cron' | 'once';

interface ScheduleAction {
  type: string;
  prompt?: string;
  agent?: string;
  command?: string;
  [key: string]: unknown;
}

interface Schedule {
  id: string;
  name: string;
  type: ScheduleType;
  schedule: string;
  timezone: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun: string | null;
  lastResult: unknown;
  lastError: unknown;
  nextRun: string | null;
  action: ScheduleAction;
  budgetCheck?: { maxConcurrent: number; skipIfBudgetLow: boolean };
}

interface SchedulesResponse extends Array<Schedule> {}

interface CreateDraft {
  id?: string;
  name: string;
  type: ScheduleType;
  schedule: string;
  timezone: string;
  actionType: string;
  prompt: string;
}

const TYPE_LABEL: Record<ScheduleType, string> = {
  interval: 'Interval',
  cron: 'Cron',
  once: 'One-time',
};

const TYPE_ICON: Record<ScheduleType, LucideIcon> = {
  interval: RefreshCw,
  cron: Clock,
  once: Play,
};

function StatusBadge({ sched }: { sched: Schedule }): JSX.Element {
  if (!sched.enabled) return <Badge tone="neutral">disabled</Badge>;
  if (sched.lastError) return <Badge tone="danger">error</Badge>;
  if (sched.lastRun === null) return <Badge tone="info">never run</Badge>;
  return <Badge tone="success">active</Badge>;
}

function Box(props: { children?: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return <div style={props.style}>{props.children}</div>;
}

export function SchedulesView(): JSX.Element {
  const res = useFetch<SchedulesResponse>('/api/schedules');
  const [live, setLive] = useState<Schedule[]>([]);
  const [draft, setDraft] = useState<CreateDraft | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useWsMessage('schedules:change', useCallback(() => { void res.refetch(); }, [res]));

  const schedules = useMemo<Schedule[]>(() => [...live, ...(res.data || [])], [live, res.data]);

  const refresh = (): void => { void res.refetch(); };

  const toggleEnabled = async (s: Schedule): Promise<void> => {
    setActionError(null);
    try {
      await fetchJson(`/api/schedules/${encodeURIComponent(s.id)}`, {
        method: 'PATCH',
        body: { enabled: !s.enabled },
      });
      refresh();
    } catch (err) {
      setActionError(err instanceof FetchError ? err.message : String(err));
    }
  };

  const runNow = async (s: Schedule): Promise<void> => {
    setActionError(null);
    setBusy(true);
    try {
      await fetchJson(`/api/schedules/${encodeURIComponent(s.id)}/run`, { method: 'POST' });
      refresh();
    } catch (err) {
      setActionError(err instanceof FetchError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteSchedule = async (id: string): Promise<void> => {
    setActionError(null);
    setBusy(true);
    try {
      await fetchJson(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
      refresh();
    } catch (err) {
      setActionError(err instanceof FetchError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const createSchedule = async (): Promise<void> => {
    if (!draft || !draft.name.trim() || !draft.schedule.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const action: ScheduleAction = { type: draft.actionType };
      if (draft.actionType === 'agent') action.prompt = draft.prompt;
      if (draft.actionType === 'command') action.command = draft.prompt;
      if (draft.id) {
        // Edit path — PATCH the existing schedule.
        await fetchJson(`/api/schedules/${encodeURIComponent(draft.id)}`, {
          method: 'PATCH',
          body: {
            name: draft.name,
            type: draft.type,
            schedule: draft.schedule,
            timezone: draft.timezone || 'UTC',
            action,
          },
        });
      } else {
        await fetchJson('/api/schedules', {
          method: 'POST',
          body: {
            name: draft.name,
            type: draft.type,
            schedule: draft.schedule,
            timezone: draft.timezone || 'UTC',
            action,
            enabled: true,
          },
        });
      }
      setDraft(null);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={5} data-testid="schedules-view">
      <ViewHeader
        title="Schedules"
        description="Recurring and one-time jobs. Toggle enabled, run on demand, or create new."
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setDraft({ name: '', type: 'interval', schedule: '1h', timezone: 'UTC', actionType: 'agent', prompt: '' })}
            data-testid="schedules-new"
          >
            <Plus size={14} aria-hidden /> New schedule
          </Button>
        }
      />

      {actionError !== null && (
        <div role="alert" style={{ padding: 'var(--space-2) var(--space-3)', background: 'color-mix(in oklch, var(--danger) 12%, var(--surface-0))', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-12)', color: 'var(--danger)' }}>
          {actionError}
        </div>
      )}

      {res.error != null ? (
        <ErrorState
          error={res.error}
          onRetry={refresh}
          description="Failed to load schedules."
        />
      ) : res.loading && schedules.length === 0 ? (
        <Stack gap={3} data-testid="schedules-skeleton">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i}>
              <CardBody>
                <Grid cols={4} gap={3} style={{ alignItems: 'center' }}>
                  <Stack gap={1}>
                    <Inline align="center" gap={2}>
                      <Skeleton style={{ width: 80, height: 14 }} />
                    </Inline>
                    <Inline gap={2}>
                      <Skeleton style={{ width: 56, height: 18 }} />
                      <Skeleton style={{ width: 56, height: 18 }} />
                    </Inline>
                  </Stack>
                  <Stack gap={1}>
                    <Skeleton style={{ width: 60, height: 10 }} />
                    <Skeleton style={{ width: 48, height: 12 }} />
                    <Skeleton style={{ width: 40, height: 10 }} />
                  </Stack>
                  <Stack gap={1}>
                    <Skeleton style={{ width: 100, height: 12 }} />
                    <Skeleton style={{ width: 80, height: 10 }} />
                  </Stack>
                  <Inline align="center" gap={2} justify="end">
                    <Skeleton style={{ width: 32, height: 24 }} />
                    <Skeleton style={{ width: 24, height: 24 }} />
                    <Skeleton style={{ width: 36, height: 24 }} />
                    <Skeleton style={{ width: 24, height: 24 }} />
                  </Inline>
                </Grid>
              </CardBody>
            </Card>
          ))}
        </Stack>
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={<Clock size={28} aria-hidden />}
          title="No schedules yet"
          description="Create one with the button above."
        />
      ) : (
        <Stack gap={3}>
          {schedules.map((s) => {
            const TypeIcon = TYPE_ICON[s.type] ?? Clock;
            return (
              <Card key={s.id} data-testid={`schedule-${s.id}`}>
                <CardBody>
                  <Grid cols={4} gap={3} style={{ alignItems: 'center' }}>
                    <Stack gap={1}>
                      <Inline align="center" gap={2}>
                        <TypeIcon size={12} aria-hidden style={{ color: 'var(--fg-muted)' }} />
                        <strong style={{ fontSize: 'var(--fs-14)' }}>{s.name}</strong>
                      </Inline>
                      <Inline gap={2}>
                        <Badge tone="neutral">{TYPE_LABEL[s.type]}</Badge>
                        <StatusBadge sched={s} />
                      </Inline>
                    </Stack>

                    <Stack gap={1}>
                      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Schedule</span>
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>{s.schedule}</code>
                      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{s.timezone}</span>
                    </Stack>

                    <Stack gap={1}>
                      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Next run</span>
                      {s.nextRun ? (
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>
                          {new Date(s.nextRun).toLocaleString()}
                        </code>
                      ) : (
                        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>—</span>
                      )}
                      {s.lastRun && (
                        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                          Last: {new Date(s.lastRun).toLocaleDateString()}
                        </span>
                      )}
                    </Stack>

                    <Inline align="center" gap={2} justify="end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDraft({
                          id: s.id,
                          name: s.name,
                          type: s.type,
                          schedule: s.schedule,
                          timezone: s.timezone || 'UTC',
                          actionType: 'agent',
                          prompt: (s.action && (s.action as { prompt?: string }).prompt) || '',
                        })}
                        data-testid={`schedule-edit-${s.id}`}
                        title="Edit"
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { void runNow(s); }}
                        disabled={busy}
                        data-testid={`schedule-run-${s.id}`}
                        title="Run now"
                      >
                        <Play size={12} aria-hidden />
                      </Button>
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={() => { void toggleEnabled(s); }}
                        aria-label={`Toggle ${s.name} enabled`}
                      />
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => { void deleteSchedule(s.id); }}
                        disabled={busy}
                        data-testid={`schedule-delete-${s.id}`}
                        title="Delete"
                      >
                        <Trash2 size={12} aria-hidden />
                      </Button>
                    </Inline>
                  </Grid>
                </CardBody>
              </Card>
            );
          })}
        </Stack>
      )}

      <Sheet open={draft !== null} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <SheetContent side="right" title={draft?.id ? 'Edit schedule' : 'New schedule'}>
          {draft !== null && (
            <Stack gap={4} style={{ padding: 'var(--space-4)' }}>
              <Stack gap={2}>
                <label htmlFor="sched-name" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Name</label>
                <Input
                  id="sched-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Daily digest"
                  disabled={busy}
                />
              </Stack>

              <Stack gap={2}>
                <label htmlFor="sched-type" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Type</label>
                <Inline gap={2}>
                  {(['interval', 'cron', 'once'] as const).map((t) => (
                    <Button
                      key={t}
                      variant={draft.type === t ? 'primary' : 'ghost'}
                      size="sm"
                      onClick={() => setDraft({ ...draft, type: t })}
                    >
                      {TYPE_LABEL[t]}
                    </Button>
                  ))}
                </Inline>
              </Stack>

              <Stack gap={2}>
                <label htmlFor="sched-expr" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                  {draft.type === 'interval' ? 'Interval (e.g. 1h, 30m)' : draft.type === 'cron' ? 'Cron expr' : 'ISO timestamp'}
                </label>
                <Input
                  id="sched-expr"
                  value={draft.schedule}
                  onChange={(e) => setDraft({ ...draft, schedule: e.target.value })}
                  placeholder={draft.type === 'interval' ? '1h' : draft.type === 'cron' ? '0 9 * * *' : '2026-07-14T09:00:00Z'}
                  disabled={busy}
                  data-testid="sched-expr"
                />
              </Stack>

              <Stack gap={2}>
                <label htmlFor="sched-tz" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Timezone</label>
                <Input
                  id="sched-tz"
                  value={draft.timezone}
                  onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
                  placeholder="UTC"
                  disabled={busy}
                />
              </Stack>

              <Stack gap={2}>
                <label style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Action type</label>
                <Inline gap={2}>
                  <Button
                    variant={draft.actionType === 'agent' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => setDraft({ ...draft, actionType: 'agent' })}
                  >
                    Agent prompt
                  </Button>
                  <Button
                    variant={draft.actionType === 'command' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => setDraft({ ...draft, actionType: 'command' })}
                  >
                    Shell command
                  </Button>
                </Inline>
              </Stack>

              <Stack gap={2}>
                <label htmlFor="sched-prompt" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                  {draft.actionType === 'agent' ? 'Agent prompt' : 'Command'}
                </label>
                <Textarea
                  id="sched-prompt"
                  value={draft.prompt}
                  onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                  placeholder={draft.actionType === 'agent' ? 'Run the daily digest report…' : 'echo "hello from cron"'}
                  rows={4}
                  disabled={busy}
                />
              </Stack>

              {error !== null && (
                <div role="alert" style={{ padding: 'var(--space-2)', background: 'color-mix(in oklch, var(--danger) 12%, var(--surface-0))', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--fs-12)', color: 'var(--danger)' }}>
                  {error}
                </div>
              )}

              <Inline gap={2}>
                <Button
                  variant="primary"
                  onClick={() => { void createSchedule(); }}
                  disabled={busy || !draft.name.trim() || !draft.schedule.trim()}
                >
                  {draft?.id ? 'Save' : 'Create'}
                </Button>
                <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                  Cancel
                </Button>
              </Inline>
            </Stack>
          )}
        </SheetContent>
      </Sheet>
    </Stack>
  );
}
