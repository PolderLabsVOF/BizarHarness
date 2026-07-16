import { useCallback, useMemo, useState } from 'react';
import {
  GitMerge,
  GitPullRequest,
  AlertTriangle,
  CheckCircle2,
  Bot,
  Wrench,
  Activity as ActivityIcon,
  Layers,
  Target,
  Settings as SettingsIcon,
  Cpu,
  Filter,
  Clock,
  Circle,
  type LucideIcon,
} from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { ListHeader } from '../../ui/data/ListHeader.js';
import { Sparkline } from '../../ui/data/Sparkline.js';
import { Badge } from '../../ui/data/Badge.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { ErrorState } from '../../ui/feedback/ErrorState.js';
import { Button } from '../../ui/controls/Button.js';
import { Switch } from '../../ui/controls/Switch.js';
import { Slider } from '../../ui/controls/Slider.js';
import { ActivityLane, type ActivityLaneEvent } from '../../ui/activity/ActivityLane.js';
import { ActivityLanes } from '../../ui/activity/ActivityLanes.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { useViewNavigate, activityTarget } from '../../data/useViewNavigate.js';
import type { ActivityEvent } from '../../data/types.js';

/**
 * ActivityView — Sprint S40 visual changelog.
 *
 * Inspired by patoles/agent-flow: vertical swimlanes per actor
 * (agent/system/user) with newest-first events, click-through to the
 * source entity (task / goal / agent / artifact), and multi-select
 * source filters.
 *
 * Layout: sticky header (search + live toggle + export) → counts row
 * with per-source badges → preferences card (live / compact / look-back)
 * → horizontal scroller of `ActivityLane`s.
 */

type Source = 'task' | 'agent' | 'goal' | 'settings' | 'system' | 'git' | 'all';

const SOURCE_META: Record<Exclude<Source, 'all'>, { label: string; icon: LucideIcon; tone: 'neutral' | 'info' | 'accent' | 'success' | 'warning' | 'danger' }> = {
  task: { label: 'Tasks', icon: Layers, tone: 'neutral' },
  agent: { label: 'Agents', icon: Bot, tone: 'info' },
  goal: { label: 'Goals', icon: Target, tone: 'accent' },
  settings: { label: 'Settings', icon: SettingsIcon, tone: 'neutral' },
  system: { label: 'System', icon: Cpu, tone: 'warning' },
  git: { label: 'Git', icon: GitMerge, tone: 'neutral' },
};

const EVENT_TONE_MAP: Record<string, { icon: LucideIcon; tone: ActivityLaneEvent['tone']; source: Source }> = {
  'git.merge': { icon: GitMerge, tone: 'success', source: 'git' },
  'git.pull-request': { icon: GitPullRequest, tone: 'info', source: 'git' },
  'task.completed': { icon: CheckCircle2, tone: 'success', source: 'task' },
  'task.failed': { icon: AlertTriangle, tone: 'danger', source: 'task' },
  'task.created': { icon: Layers, tone: 'info', source: 'task' },
  'task.moved': { icon: Layers, tone: 'neutral', source: 'task' },
  'agent.run': { icon: Bot, tone: 'info', source: 'agent' },
  'agent.tool': { icon: Wrench, tone: 'neutral', source: 'agent' },
  'agent.killed': { icon: AlertTriangle, tone: 'warning', source: 'agent' },
  'agent.message': { icon: ActivityIcon, tone: 'info', source: 'agent' },
  'goal.created': { icon: Target, tone: 'info', source: 'goal' },
  'goal.status': { icon: Target, tone: 'info', source: 'goal' },
  'goal.decomposed': { icon: Target, tone: 'success', source: 'goal' },
  'settings.changed': { icon: SettingsIcon, tone: 'neutral', source: 'settings' },
  'system.error': { icon: AlertTriangle, tone: 'danger', source: 'system' },
  'system.note': { icon: ActivityIcon, tone: 'neutral', source: 'system' },
};

function inferSource(e: ActivityEvent): Source {
  const hint = (e.kind || e.iconKey || '').toLowerCase();
  if (hint.startsWith('task')) return 'task';
  if (hint.startsWith('agent')) return 'agent';
  if (hint.startsWith('goal')) return 'goal';
  if (hint.startsWith('settings')) return 'settings';
  if (hint.startsWith('git')) return 'git';
  if (hint.startsWith('system')) return 'system';
  if (e.title && /goal/i.test(e.title)) return 'goal';
  if (e.title && /(agent|claude|cc)/i.test(e.title)) return 'agent';
  return 'system';
}

function eventVisual(e: ActivityEvent): { icon: LucideIcon; tone: ActivityLaneEvent['tone']; source: Source } {
  const m = EVENT_TONE_MAP[e.kind || e.iconKey || ''] || EVENT_TONE_MAP['system.note'];
  const inferred = inferSource(e);
  return { icon: m.icon, tone: m.tone, source: inferred };
}

function laneKey(e: ActivityEvent): string {
  return e.agent || e.actor || e.slug || 'system';
}

function laneLabel(key: string): string {
  if (key === 'system') return 'System';
  return key;
}

interface ExtendedEvent extends ActivityEvent {
  __source?: Source;
  __key?: string;
}

export function ActivityView(): JSX.Element {
  const events = useFetch<{ items?: ActivityEvent[]; total?: number; limit?: number; since?: string | null }>('/api/activity?limit=200');
  const [live, setLive] = useState<ActivityEvent[]>([]);
  // Active source filter (single source — clicking a chip narrows to one).
  const [source, setSource] = useState<Source>('all');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [compact, setCompact] = useState<boolean>(false);
  const [maxDays, setMaxDays] = useState<number>(14);
  const [exportError, setExportError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');
  const navigate = useViewNavigate();

  const onEvent = useCallback((msg: { event?: ActivityEvent } & Record<string, unknown>) => {
    if (!autoRefresh) return;
    const ev = msg.event;
    if (!ev) return;
    setLive((prev) => [ev, ...prev].slice(0, 500));
  }, [autoRefresh]);
  useWsMessage('activity:new', onEvent);

  const merged = useMemo<ExtendedEvent[]>(() => {
    return [...live, ...(events.data?.items || [])];
  }, [live, events.data]);

  const filtered = useMemo<ExtendedEvent[]>(() => {
    let list = source === 'all' ? merged : merged.filter((e) => inferSource(e) === source);
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      list = list.filter((e) => {
        const hay = [
          e.title || '',
          e.description || '',
          e.kind || '',
          e.agent || '',
          e.actor || '',
        ].join(' ').toLowerCase();
        return hay.includes(needle);
      });
    }
    return list;
  }, [merged, source, search]);

  // Time-windowed set (older events clipped).
  const cutoff = Date.now() - maxDays * 86_400_000;
  const windowed = useMemo<ExtendedEvent[]>(
    () => filtered.filter((e) => (e.ts || 0) >= cutoff || e.ts === undefined),
    [filtered, cutoff],
  );

  const counts = useMemo(() => {
    const acc: Record<Source, number> = { all: 0, task: 0, agent: 0, goal: 0, settings: 0, system: 0, git: 0 };
    for (const e of merged) {
      const s = inferSource(e);
      acc.all += 1;
      acc[s] += 1;
    }
    return acc;
  }, [merged]);

  const sparklineData = useMemo<number[]>(() => {
    // Group by hour bucket for sparkline.
    const buckets = new Map<string, number>();
    for (const e of windowed) {
      if (!e.ts) continue;
      const d = new Date(e.ts);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}`;
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
    return [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v).slice(-24);
  }, [windowed]);

  // Group events into lanes (one per actor).
  const lanes = useMemo<{ key: string; label: string; events: ActivityLaneEvent[]; icon: LucideIcon; tone: ActivityLaneEvent['tone'] }[]>(() => {
    const map = new Map<string, ActivityLaneEvent[]>();
    const order: string[] = [];
    for (const e of windowed) {
      const v = eventVisual(e);
      const ts = e.ts || Date.now();
      const k = laneKey(e);
      const id = e.id || `${k}-${ts}-${Math.random().toString(36).slice(2, 6)}`;
      if (!map.has(k)) { map.set(k, []); order.push(k); }
      const target = activityTarget(e.kind, e.slug);
      map.get(k)!.push({
        id,
        title: e.title || e.description || e.kind || 'event',
        description: e.description && e.description !== e.title ? e.description : undefined,
        ts,
        tone: v.tone,
        icon: v.icon,
        href: target ? undefined : undefined,
        kind: e.kind,
        agent: e.agent,
        actor: e.actor,
        slug: e.slug,
        raw: e,
      });
    }
    // Sort each lane newest-first; ensure consistent order.
    for (const arr of map.values()) arr.sort((a, b) => b.ts - a.ts);
    return order.map((k) => {
      const events = map.get(k)!;
      // Lane icon picks the most recent event's icon (visual hint).
      const Icon = (events[0]?.icon as LucideIcon) || Cpu;
      // Lane tone picks the worst recent tone (danger > warning > success > info > neutral).
      const severity: Record<NonNullable<ActivityLaneEvent['tone']>, number> = { danger: 4, warning: 3, success: 2, info: 1, neutral: 0 };
      const worst = events.reduce<ActivityLaneEvent['tone']>((acc, e) => {
        const cur = severity[e.tone ?? 'neutral'];
        const best = severity[acc ?? 'neutral'];
        return cur > best ? (e.tone ?? 'neutral') : acc;
      }, 'neutral');
      return { key: k, label: laneLabel(k), events, icon: Icon, tone: worst };
    }).sort((a, b) => b.events.length - a.events.length);
  }, [windowed]);

  const onLaneClick = useCallback((ev: ActivityLaneEvent) => {
    const target = activityTarget(ev.kind, ev.slug);
    if (target) {
      navigate(target);
      return;
    }
    // Fallback: navigate to activity's own view (no-op) but focus the row.
  }, [navigate]);

  const exportNdjson = async (): Promise<void> => {
    setExportError(null);
    try {
      const res = await fetchJson<{ items?: ActivityEvent[] }>('/api/activity?limit=10000');
      const text = (res.items || []).map((e) => JSON.stringify(e)).join('\n');
      const blob = new Blob([text], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bizar-activity-${new Date().toISOString().slice(0, 10)}.ndjson`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  return (
    <Stack gap={5} data-testid="activity-view">
      <ViewHeader
        title="Activity"
        description="Live event lanes grouped by agent, system, and goal."
        actions={
          <Inline align="center" gap={2}>
            <input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search activity"
              style={{
                height: 28,
                padding: '0 var(--space-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-0)',
                color: 'var(--fg)',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-12)',
                width: 200,
                outline: 'none',
              }}
            />
            <Inline align="center" gap={1}>
              <Circle
                size={8}
                aria-hidden
                style={{ color: autoRefresh ? 'var(--success)' : 'var(--fg-muted)' }}
                fill="currentColor"
              />
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                {autoRefresh ? 'Live' : 'Paused'}
              </span>
              <Button variant="ghost" onClick={() => setAutoRefresh((v) => !v)} aria-label={autoRefresh ? 'Pause stream' : 'Resume stream'}>
                {autoRefresh ? 'Pause' : 'Resume'}
              </Button>
            </Inline>
            <Button variant="secondary" onClick={() => { void exportNdjson(); }}>
              <Filter size={12} aria-hidden /> Export NDJSON
            </Button>
          </Inline>
        }
      />
      <ListHeader
        title="Lanes"
        count={windowed.length}
        sparkline={sparklineData.length >= 2 ? <Sparkline data={sparklineData} width={120} height={28} /> : undefined}
        description={`${lanes.length} lane${lanes.length === 1 ? '' : 's'} · ${counts.task} task · ${counts.agent} agent · ${counts.goal} goal`}
        testid="activity-list-header"
      />

      {exportError !== null && (
        <div role="alert" style={{ padding: 'var(--space-3)', background: 'color-mix(in oklch, var(--danger) 12%, var(--surface-0))', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-12)' }}>
          {exportError}
        </div>
      )}

      {/* Source filter chips */}
      <Inline align="center" gap={2} wrap>
        <FilterChip label={`All (${counts.all})`} active={source === 'all'} onClick={() => setSource('all')} icon={<ActivityIcon size={12} aria-hidden />} />
        {(Object.keys(SOURCE_META) as Array<Exclude<Source, 'all'>>).map((s) => {
          const meta = SOURCE_META[s];
          const Icon = meta.icon;
          return (
            <FilterChip
              key={s}
              label={`${meta.label} (${counts[s]})`}
              active={source === s}
              onClick={() => setSource(s)}
              icon={<Icon size={12} aria-hidden />}
            />
          );
        })}
      </Inline>

      {/* Display prefs */}
      <Card>
        <CardBody>
          <Inline align="center" gap={6} wrap>
            <Stack gap={1}>
              <label htmlFor="cl-auto" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Live tail</label>
              <Inline align="center" gap={2}>
                <Switch id="cl-auto" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
                <span style={{ fontSize: 'var(--fs-12)', color: autoRefresh ? 'var(--success)' : 'var(--fg-muted)' }}>
                  {autoRefresh ? 'on' : 'paused'}
                </span>
              </Inline>
            </Stack>
            <Stack gap={1}>
              <label htmlFor="cl-compact" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Compact rows</label>
              <Inline align="center" gap={2}>
                <Switch id="cl-compact" checked={compact} onCheckedChange={setCompact} />
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{compact ? 'compact' : 'comfortable'}</span>
              </Inline>
            </Stack>
            <Stack gap={1}>
              <label htmlFor="cl-days" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Look back</label>
              <Inline align="center" gap={2}>
                <Slider id="cl-days" value={[maxDays]} onValueChange={(v) => setMaxDays(v[0] ?? 14)} min={1} max={90} step={1} />
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>{maxDays}d</code>
              </Inline>
            </Stack>
            <Inline align="center" gap={1}>
              <Clock size={12} aria-hidden style={{ color: 'var(--fg-muted)' }} />
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                click any event row to jump to its source
              </span>
            </Inline>
          </Inline>
        </CardBody>
      </Card>

      {/* Empty state */}
      {!events.loading && windowed.length === 0 && (
        <Card>
          <CardBody>
            <Stack gap={1}>
              <strong>No activity matching filters.</strong>
              <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>
                Clear the source filter or extend the look-back window.
              </span>
            </Stack>
          </CardBody>
        </Card>
      )}

      {events.loading && windowed.length === 0 ? (
        <Skeleton style={{ height: 480 }} />
      ) : events.error && windowed.length === 0 ? (
        <ErrorState
          block
          title="Couldn't load activity"
          description="The activity feed failed to fetch. Retry to refetch."
          error={events.error}
          onRetry={() => void events.refetch()}
          testid="activity-error"
        />
      ) : lanes.length === 0 ? (
        <Card>
          <CardBody>
            <span style={{ color: 'var(--fg-muted)' }}>No lanes yet — events will appear here as agents run.</span>
          </CardBody>
        </Card>
      ) : (
        <ActivityLanes minHeight={compact ? 320 : 480}>
          {lanes.map((lane) => (
            <ActivityLane
              key={lane.key}
              laneId={lane.key}
              label={lane.label}
              icon={lane.icon}
              events={lane.events}
              loading={events.loading && lane.events.length === 0}
              onEventClick={onLaneClick}
              trailing={
                <Badge tone={
                  lane.tone === 'danger' ? 'danger'
                  : lane.tone === 'warning' ? 'warning'
                  : lane.tone === 'success' ? 'success'
                  : lane.tone === 'info' ? 'info'
                  : 'neutral'
                }>
                  {lane.tone}
                </Badge>
              }
            />
          ))}
        </ActivityLanes>
      )}
    </Stack>
  );
}

function FilterChip({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon?: React.ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 'var(--radius-pill)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'color-mix(in oklch, var(--accent) 14%, var(--surface-1))' : 'var(--surface-1)',
        color: active ? 'var(--accent)' : 'var(--fg)',
        fontSize: 'var(--fs-12)',
        cursor: 'pointer',
        fontWeight: active ? 600 : 500,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
