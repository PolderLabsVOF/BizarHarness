import { GitMerge, GitPullRequest, AlertTriangle, CheckCircle2, Bot, Wrench } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { ActivityFeed, type ActivityItem } from '../../ui/activity/ActivityFeed.js';

/**
 * ActivityView — full history of events.
 *
 * Same shape as the Overview feed, but unbounded — the full stream.
 */

const ITEMS: ActivityItem[] = [
  { id: 'a1', icon: <GitMerge size={14} aria-hidden="true" />, title: 'Merged PR #42 — OKLch token system', meta: '2m ago', tone: 'success' },
  { id: 'a2', icon: <GitPullRequest size={14} aria-hidden="true" />, title: 'Opened PR #43 — Kanban centerpiece', meta: '12m ago', tone: 'info' },
  { id: 'a3', icon: <Bot size={14} aria-hidden="true" />, title: 'Atlas — "Wire TanStack Router"', meta: '34m ago', tone: 'info' },
  { id: 'a4', icon: <CheckCircle2 size={14} aria-hidden="true" />, title: 'Goal "Ship v8 dashboard" advanced to 62%', meta: '52m ago', tone: 'success' },
  { id: 'a5', icon: <Wrench size={14} aria-hidden="true" />, title: 'Borealis — Edited src/web/v8/ui/index.ts', meta: '1h ago' },
  { id: 'a6', icon: <AlertTriangle size={14} aria-hidden="true" />, title: 'CI failed on tests/a11y/forms.test.tsx', meta: '1h ago', tone: 'warning' },
  { id: 'a7', icon: <GitMerge size={14} aria-hidden="true" />, title: 'Merged PR #41 — Sprint S4 (Navigation)', meta: '2h ago', tone: 'success' },
  { id: 'a8', icon: <GitPullRequest size={14} aria-hidden="true" />, title: 'Opened PR #40 — Sprint S3 (Data display)', meta: '3h ago', tone: 'info' },
];

export function ActivityView(): JSX.Element {
  return (
    <Stack gap={5}>
      <ViewHeader
        title="Activity"
        description="Full event history across the harness."
      />
      <ActivityFeed items={ITEMS} />
    </Stack>
  );
}