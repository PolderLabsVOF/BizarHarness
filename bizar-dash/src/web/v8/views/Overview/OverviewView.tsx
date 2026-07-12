import { GitMerge, GitPullRequest, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { StatTile, StatGrid } from '../../ui/data/StatTile.js';
import { Card, CardBody, CardHeader } from '../../ui/data/Card.js';
import { Badge } from '../../ui/data/Badge.js';
import { ActivityFeed, type ActivityItem } from '../../ui/activity/ActivityFeed.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';

/**
 * OverviewView — the home/dashboard landing page.
 */

const RECENT: ActivityItem[] = [
  {
    id: 'o1',
    icon: <GitMerge size={14} aria-hidden="true" />,
    title: 'Merged PR #42 — OKLch token system',
    meta: '2m ago',
    tone: 'success',
  },
  {
    id: 'o2',
    icon: <GitPullRequest size={14} aria-hidden="true" />,
    title: 'Opened PR #43 — Kanban centerpiece',
    meta: '12m ago',
    tone: 'info',
  },
  {
    id: 'o3',
    icon: <CheckCircle2 size={14} aria-hidden="true" />,
    title: 'Goal "Ship v8 dashboard" advanced to 42%',
    meta: '34m ago',
    tone: 'success',
  },
  {
    id: 'o4',
    icon: <AlertTriangle size={14} aria-hidden="true" />,
    title: '3 tests failing in tests/a11y/forms.test.tsx',
    meta: '1h ago',
    tone: 'warning',
  },
];

export function OverviewView(): JSX.Element {
  return (
    <Stack gap={5}>
      <ViewHeader
        title="Overview"
        description="What's moving in the harness right now."
        actions={<Badge tone="success" dot>Live</Badge>}
      />

      <StatGrid cols={4}>
        <StatTile label="Active tasks" value="47" trend="up" delta="+6 today" />
        <StatTile label="Goals on track" value="2 / 3" trend="flat" delta="no change" />
        <StatTile label="Agents running" value="8 / 16" trend="up" delta="+2 since yesterday" />
        <StatTile label="Tokens (24h)" value="1.4M" trend="down" delta="−12% vs avg" />
      </StatGrid>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <Card>
          <CardHeader title="Recent activity" />
          <CardBody>
            <ActivityFeed items={RECENT} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Needs attention" />
          <CardBody>
            <Stack gap={3}>
              <StatTile
                label="At-risk goal"
                value="Cut S9 polish in half"
                hint="Owner: sam · Due Aug 1"
              />
              <StatTile
                label="Failing tests"
                value="3 in tests/a11y/forms.test.tsx"
                hint="Pre-existing — does not block v8 work."
              />
              <StatTile
                label="Token budget"
                value="73% of daily limit"
                hint="Resets at midnight UTC."
              />
            </Stack>
          </CardBody>
        </Card>
      </div>
    </Stack>
  );
}