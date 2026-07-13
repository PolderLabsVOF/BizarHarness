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
import { Grid } from '../../ui/primitives/Grid.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Badge } from '../../ui/data/Badge.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { Button } from '../../ui/controls/Button.js';
import { Switch } from '../../ui/controls/Switch.js';
import { Slider } from '../../ui/controls/Slider.js';
import { cx } from '../../ui/utils/cx.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import type { ActivityEvent } from '../../data/types.js';

/**
 * ActivityView — Sprint S15 visual changelog.
 *
 * Renders an explicit day-grouped changelog ("Today", "Yesterday", "Mar 14")
 * with source badges and per-event highlights. Diff payloads (`meta.diff`)
 * render as expanded preview blocks. Filter chips narrow by source. The
 * topbar lives above the list so screen-magnifier users see context.
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

const EVENT_TONE_MAP: Record<string, { icon: LucideIcon; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; source: Source }> = {
  'git.merge': { icon: GitMerge, tone: 'success', source: 'git' },
  'git.pull-request': { icon: GitPullRequest, tone: 'info', source: 'git' },
  'task.completed': { icon: CheckCircle2, tone: 'success', source: 'task' },
  'task.failed': { icon: AlertTriangle, tone: 'danger', source: 'task' },
  'task.created': { icon: Layers, tone: 'info', source: 'task' },
  'task.moved': { icon: Layers, tone: 'neutral', source: 'task' },
  'agent.run': { icon: Bot, tone: 'info', source: 'agent' },
  'agent.tool': { icon: Wrench, tone: 'neutral', source: 'agent' },
  'agent.killed': { icon: AlertTriangle, tone: 'warning', source: 'agent' },
  'goal.created': { icon: Target, tone: 'info', source: 'goal' },
  'goal.status': { icon: Target, tone: 'info', source: 'goal' },
  'goal.decomposed': { icon: Target, tone: 'success', source: 'goal' },
  'settings.changed': { icon: SettingsIcon, tone: 'neutral', source: 'settings' },
  'system.error': { icon: AlertTriangle, tone: 'danger', source: 'system' },
  'system.note': { icon: ActivityIcon, tone: 'neutral', source: 'system' },
  'agent.message': { icon: ActivityIcon, tone: 'info', source: 'agent' },
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

function eventVisual(e: ActivityEvent): { icon: LucideIcon; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; source: Source } {
  const m = EVENT_TONE_MAP[e.kind || e.iconKey || ''] || EVENT_TONE_MAP['system.note'];
  const inferred = inferSource(e);
  return { icon: m.icon, tone: m.tone, source: inferred };
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(ts: number): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d = new Date(ts);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((today - start) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function timeShort(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface DiffPayload { before?: string; after?: string; lines?: { kind: '+' | '-' | ' '; text: string }[] }

function renderDiff(meta: unknown): JSX.Element | null {
  if (!meta || typeof meta !== 'object') return null;
  const d = meta as DiffPayload;
  if (Array.isArray(d.lines) && d.lines.length > 0) {
    return (
      <Box style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', background: 'var(--surface-0)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 8 }}>
        {d.lines.slice(0, 40).map((l, i) => (
          <div key={i} style={{ color: l.kind === '+' ? 'var(--success)' : l.kind === '-' ? 'var(--danger)' : 'var(--fg-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <span style={{ display: 'inline-block', width: 12 }}>{l.kind === ' ' ? '' : l.kind}</span>
            {l.text}
          </div>
        ))}
      </Box>
    );
  }
  if (d.before !== undefined || d.after !== undefined) {
    return (
      <Box style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {d.before !== undefined && (
          <Box style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', background: 'color-mix(in oklch, var(--danger) 12%, var(--surface-0))', border: '1px solid color-mix(in oklch, var(--danger) 30%, var(--border))', borderRadius: 'var(--radius-sm)', padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <strong style={{ color: 'var(--danger)' }}>before</strong>
            <div>{String(d.before)}</div>
          </Box>
        )}
        {d.after !== undefined && (
          <Box style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', background: 'color-mix(in oklch, var(--success) 12%, var(--surface-0))', border: '1px solid color-mix(in oklch, var(--success) 30%, var(--border))', borderRadius: 'var(--radius-sm)', padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <strong style={{ color: 'var(--success)' }}>after</strong>
            <div>{String(d.after)}</div>
          </Box>
        )}
      </Box>
    );
  }
  return null;
}

function Box(props: { children?: React.ReactNode; style?: React.CSSProperties; className?: string }): JSX.Element {
  return <div className={cx('v8-cl-box', props.className)} style={props.style}>{props.children}</div>;
}

interface ExtendedEvent extends ActivityEvent { __source?: Source }

export function ActivityView(): JSX.Element {
  const events = useFetch<{ events?: ActivityEvent[] }>('/api/activity?limit=200');
  const [live, setLive] = useState<ActivityEvent[]>([]);
  const [source, setSource] = useState<Source>('all');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [compact, setCompact] = useState<boolean>(false);
  const [maxDays, setMaxDays] = useState<number>(14);
  const [exportError, setExportError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');

  const onEvent = useCallback((msg: { event?: ActivityEvent } & Record<string, unknown>) => {
    if (!autoRefresh) return;
    const ev = msg.event;
    if (!ev) return;
    setLive((prev) => [ev, ...prev].slice(0, 500));
  }, [autoRefresh]);
  useWsMessage('activity:new', onEvent);

  const merged = useMemo<ExtendedEvent[]>(() => {
    return [...live, ...(events.data?.events || [])];
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

  const grouped = useMemo<{ key: string; label: string; events: ExtendedEvent[] }[]>(() => {
    const map = new Map<string, ExtendedEvent[]>();
    for (const e of windowed) {
      const ts = e.ts || Date.now();
      const k = dayKey(ts);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    const out: { key: string; label: string; events: ExtendedEvent[] }[] = [];
    for (const [k, evs] of map) {
      const first = evs.find((x) => x.ts);
      const ts = first?.ts ?? Date.now();
      out.push({ key: k, label: dayLabel(ts), events: evs });
    }
    return out.sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [windowed]);

  const counts = useMemo(() => {
    const acc: Record<Source, number> = { all: 0, task: 0, agent: 0, goal: 0, settings: 0, system: 0, git: 0 };
    for (const e of merged) {
      const s = inferSource(e);
      acc.all += 1;
      acc[s] += 1;
    }
    return acc;
  }, [merged]);

  const exportNdjson = async (): Promise<void> => {
    setExportError(null);
    try {
      const res = await fetchJson<{ events?: ActivityEvent[] }>('/api/activity?limit=10000');
      const text = (res.events || []).map((e) => JSON.stringify(e)).join('\n');
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
    <Stack gap={5}>
      <ViewHeader
        title="Activity"
        description="Day-grouped changelog across tasks, agents, goals, settings, and git."
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
          <Grid cols={3} gap={4}>
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
          </Grid>
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
        <Skeleton style={{ height: 320 }} />
      ) : (
        <Stack gap={5}>
          {grouped.map((group) => (
            <Stack key={group.key} gap={3}>
              <Inline
                align="center"
                gap={2}
                style={{ position: 'sticky', top: 0, padding: 'var(--space-2) var(--space-3)', background: 'color-mix(in oklch, var(--surface-0) 88%, transparent)', backdropFilter: 'blur(8px)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', zIndex: 1 }}
              >
                <h2 style={{ margin: 0, fontSize: 'var(--fs-16)', fontWeight: 600 }}>{group.label}</h2>
                <Badge tone="neutral">{group.events.length}</Badge>
                <Clock size={12} aria-hidden style={{ color: 'var(--fg-muted)' }} />
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                  {group.events.filter((e) => e.ts === undefined).length > 0
                    ? 'live + historical'
                    : 'historical only'}
                </span>
              </Inline>

              <Stack gap={1}>
                {group.events.map((e, i) => {
                  const v = eventVisual(e);
                  const SourceIcon = SOURCE_META[v.source as Exclude<Source, 'all'>]?.icon || Cpu;
                  const ts = e.ts ?? Date.now();
                  return (
                    <Box
                      key={`${e.id ?? `${ts}-${i}`}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr auto',
                        gap: 12,
                        padding: compact ? '6px 10px' : 'var(--space-3) var(--space-4)',
                        background: 'var(--surface-1)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        alignItems: 'center',
                      }}
                    >
                      {/* Icon column */}
                      <Box
                        style={{
                          width: 32,
                          height: 32,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 'var(--radius-pill)',
                          background: `color-mix(in oklch, var(--${v.tone === 'neutral' ? 'fg-muted' : v.tone}) 18%, var(--surface-0))`,
                          color: `var(--${v.tone === 'neutral' ? 'fg-muted' : v.tone})`,
                        }}
                      >
                        <v.icon size={14} aria-hidden />
                      </Box>
                      {/* Body */}
                      <Stack gap={1}>
                        <Inline align="center" gap={2}>
                          <strong style={{ fontSize: 'var(--fs-14)' }}>{e.title ?? e.description ?? e.kind ?? 'event'}</strong>
                          <Badge tone={SOURCE_META[v.source as Exclude<Source, 'all'>]?.tone ?? 'neutral'}>
                            <Inline align="center" gap={1}><SourceIcon size={10} aria-hidden /> {SOURCE_META[v.source as Exclude<Source, 'all'>]?.label ?? v.source}</Inline>
                          </Badge>
                          {e.kind && <Badge tone="neutral">{e.kind}</Badge>}
                        </Inline>
                        {e.description && e.description !== e.title && (
                          <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>{e.description}</span>
                        )}
                        {renderDiff(e.meta)}
                      </Stack>
                      {/* Meta column */}
                      <Stack align="end" gap={1}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{timeShort(ts)}</code>
                        {typeof e.actor === 'string' && (
                          <Inline align="center" gap={1}><Circle size={8} aria-hidden style={{ color: 'var(--accent)' }} /><span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{e.actor}</span></Inline>
                        )}
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            </Stack>
          ))}
        </Stack>
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