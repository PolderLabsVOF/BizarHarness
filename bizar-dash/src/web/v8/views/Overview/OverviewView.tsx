import { useMemo, useState, useCallback } from 'react';
import {
  GitMerge,
  GitPullRequest,
  AlertTriangle,
  CheckCircle2,
  Bot,
  Wrench,
  Activity as ActivityIcon,
  type LucideIcon,
} from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { StatTile, StatGrid } from '../../ui/data/StatTile.js';
import { Card, CardBody, CardHeader } from '../../ui/data/Card.js';
import { Badge } from '../../ui/data/Badge.js';
import { ActivityFeed, type ActivityItem } from '../../ui/activity/ActivityFeed.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import type { ActivityEvent, Snapshot } from '../../data/types.js';

/**
 * OverviewView — the home/dashboard landing page.
 *
 * S10 — pulls `/api/snapshot` for the headline counts and `/api/activity`
 * for the recent feed. Live-tails via `useWsMessage('activity:new', …)`
 * so a new event lands in the feed without a re-fetch.
 */

const ICON_MAP: Record<string, LucideIcon> = {
  'git.merge': GitMerge,
  'git.pull-request': GitPullRequest,
  'git.merge.pr': GitMerge,
  'task.completed': CheckCircle2,
  'task.failed': AlertTriangle,
  'agent.run': Bot,
  'agent.tool': Wrench,
  'agent.message': ActivityIcon,
};

function iconFor(key: string | undefined): JSX.Element {
  const Icon = ICON_MAP[key || ''] || ActivityIcon;
  return <Icon size={14} aria-hidden="true" />;
}

function eventToItem(e: ActivityEvent, idx: number): ActivityItem {
  const ts = typeof e.ts === 'number' ? e.ts : Date.now();
  const meta = e.meta || (ts ? new Date(ts).toLocaleString() : '');
  return {
    id: e.id || `${ts}-${idx}`,
    icon: iconFor(e.iconKey || e.kind),
    title: e.title || e.description || e.kind || 'event',
    description: e.description,
    meta,
    tone: e.tone,
  };
}

export function OverviewView(): JSX.Element {
  const snapshot = useFetch<Snapshot>('/api/snapshot');
  const activity = useFetch<{ events?: ActivityEvent[] }>('/api/activity?limit=10');

  // Live-tail new events. Keep them in a small in-memory ring buffer.
  const [liveEvents, setLiveEvents] = useState<ActivityEvent[]>([]);
  const onEvent = useCallback((msg: { event?: ActivityEvent } & Record<string, unknown>) => {
    const ev = msg.event;
    if (!ev) return;
    setLiveEvents((prev) => [...prev.slice(-19), ev]);
  }, []);
  useWsMessage('activity:new', onEvent);

  const items = useMemo<ActivityItem[]>(() => {
    const list = [
      ...liveEvents.slice(-10).reverse(),
      ...((activity.data?.events || []).slice(0, 10)),
    ];
    return list.map(eventToItem);
  }, [activity.data, liveEvents]);

  const ov = snapshot.data?.overview || {};
  const tasks = ov.tasks || {};
  const goals = ov.goals || {};
  const agents = ov.agents || {};
  const tokens = ov.tokens || {};

  return (
    <Stack gap={5}>
      <ViewHeader
        title="Overview"
        description="What's moving in the harness right now."
        actions={
          <Badge tone={snapshot.error ? 'danger' : 'success'} dot>
            {snapshot.loading ? 'Loading' : snapshot.error ? 'Offline' : 'Live'}
          </Badge>
        }
      />

      <StatGrid cols={4}>
        <StatTile
          label="Active tasks"
          value={String((tasks.queued || 0) + (tasks.active || 0))}
          trend={(tasks.active || 0) > (tasks.queued || 0) ? 'up' : 'flat'}
          delta={`${tasks.done || 0} done · ${tasks.blocked || 0} blocked`}
        />
        <StatTile
          label="Goals at risk"
          value={`${goals.atRisk || 0} / ${goals.total || 0}`}
          trend={(goals.atRisk || 0) > 0 ? 'down' : 'flat'}
          delta={`${goals.done || 0} done`}
        />
        <StatTile
          label="Agents running"
          value={`${agents.running || 0} / ${agents.total || 0}`}
          trend={(agents.running || 0) > 0 ? 'up' : 'flat'}
          delta={`${agents.idle || 0} idle · ${agents.error || 0} error`}
        />
        <StatTile
          label="Tokens (24h)"
          value={tokens.last24h ? `${(tokens.last24h / 1_000_000).toFixed(1)}M` : '—'}
          trend={tokens.trend || 'flat'}
          delta="last 24h"
        />
      </StatGrid>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <Card>
          <CardHeader title="Recent activity" />
          <CardBody>
            <ActivityFeed items={items.length ? items : []} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Needs attention" />
          <CardBody>
            <Stack gap={2}>
              {(ov.needsAttention || []).length === 0 ? (
                <div
                  role="status"
                  style={{
                    padding: 'var(--space-3)',
                    border: '1px solid color-mix(in oklch, var(--success) 40%, var(--border))',
                    borderRadius: 'var(--radius-md)',
                    background: 'color-mix(in oklch, var(--success) 8%, var(--surface-0))',
                    color: 'var(--success)',
                    fontSize: 'var(--fs-13)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  <CheckCircle2 size={14} aria-hidden />
                  All clear — nothing needs attention.
                </div>
              ) : (
                (ov.needsAttention || []).map((n, i) => {
                  const tone =
                    String(n.label || '').toLowerCase().includes('fail') ? 'danger' :
                    String(n.label || '').toLowerCase().includes('block') ? 'warning' :
                    String(n.label || '').toLowerCase().includes('risk') ? 'warning' :
                    'info';
                  const Icon =
                    tone === 'danger' ? AlertTriangle :
                    tone === 'warning' ? AlertTriangle :
                    ActivityIcon;
                  return (
                    <div
                      key={i}
                      role="alert"
                      style={{
                        padding: 'var(--space-3)',
                        border: `1px solid color-mix(in oklch, var(--${tone}) 40%, var(--border))`,
                        borderRadius: 'var(--radius-md)',
                        background: `color-mix(in oklch, var(--${tone}) 8%, var(--surface-0))`,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--space-2)',
                      }}
                    >
                      <Icon size={16} aria-hidden style={{ color: `var(--${tone})`, marginTop: 2, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--fg)' }}>{n.label}</div>
                        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 2 }}>{n.value}</div>
                        {typeof n.hint === 'string' && n.hint.length > 0 && (
                          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 2 }}>{n.hint}</div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </Stack>
          </CardBody>
        </Card>
      </div>

      {Array.isArray(snapshot.data?.projects) && snapshot.data.projects.length > 0 && (
        <Card>
          <CardHeader title="Active projects" />
          <CardBody>
            <Stack gap={1}>
              {snapshot.data.projects.map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: 'var(--space-2) var(--space-3)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--surface-0)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-2)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>{p.name || p.id}</div>
                    <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{p.cwd}</code>
                  </div>
                  {snapshot.data?.activeProject?.id === p.id && (
                    <Badge tone="success" dot>active</Badge>
                  )}
                </div>
              ))}
            </Stack>
          </CardBody>
        </Card>
      )}
    </Stack>
  );
}