import { useCallback, useMemo, useState } from 'react';
import { GitMerge, GitPullRequest, AlertTriangle, CheckCircle2, Bot, Wrench, Activity as ActivityIcon, type LucideIcon } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { ActivityFeed, type ActivityItem } from '../../ui/activity/ActivityFeed.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import type { ActivityEvent } from '../../data/types.js';

/**
 * ActivityView — Sprint S10. Full activity stream from `/api/activity`.
 * Live-tail via `activity:new` WS messages.
 */

const ICON_MAP: Record<string, LucideIcon> = {
  'git.merge': GitMerge,
  'git.pull-request': GitPullRequest,
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

function toItem(e: ActivityEvent, idx: number): ActivityItem {
  return {
    id: e.id || `${e.ts || idx}-${idx}`,
    icon: iconFor(e.iconKey || e.kind),
    title: e.title || e.description || e.kind || 'event',
    description: e.description,
    meta: e.meta || (e.ts ? new Date(e.ts).toLocaleString() : ''),
    tone: e.tone,
  };
}

export function ActivityView(): JSX.Element {
  const events = useFetch<{ events?: ActivityEvent[] }>('/api/activity?limit=200');
  const [live, setLive] = useState<ActivityEvent[]>([]);

  const onEvent = useCallback((msg: { event?: ActivityEvent } & Record<string, unknown>) => {
    const ev = msg.event;
    if (!ev) return;
    setLive((prev) => [ev, ...prev].slice(0, 200));
  }, []);
  useWsMessage('activity:new', onEvent);

  const items = useMemo<ActivityItem[]>(() => {
    const merged = [...live, ...(events.data?.events || [])];
    return merged.map(toItem);
  }, [live, events.data]);

  return (
    <Stack gap={5}>
      <ViewHeader
        title="Activity"
        description="Full event history across the harness."
      />
      {events.loading && items.length === 0 ? (
        <Skeleton style={{ height: 320 }} />
      ) : (
        <ActivityFeed items={items} />
      )}
    </Stack>
  );
}