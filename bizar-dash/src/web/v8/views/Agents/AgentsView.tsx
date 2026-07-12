import { Stack } from '../../ui/primitives/Stack.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { AgentCard, type AgentCardProps } from '../../ui/agents/AgentCard.js';
import { AgentActivity, type AgentActivityItem } from '../../ui/agents/AgentActivity.js';
import { Card, CardBody, CardHeader } from '../../ui/data/Card.js';
import { Wrench, Bot, GitMerge, MessageSquare } from 'lucide-react';

/**
 * AgentsView — orchestrator agents (PLAN.md "Agents page").
 *
 * Each card shows status + current task + token sparkline. Click a card
 * to see per-agent activity (sample feed below).
 */

const AGENTS: AgentCardProps[] = [
  {
    id: 'a1',
    name: 'Atlas',
    role: 'Lead researcher',
    status: 'busy',
    currentTask: 'Wire TanStack Router in v8 App',
    lastActivity: '2m ago',
    tasksToday: 7,
    tpmHistory: [120, 200, 340, 280, 410, 480, 360, 290, 220, 180, 160, 140, 200, 260, 320, 380],
  },
  {
    id: 'a2',
    name: 'Borealis',
    role: 'Frontend specialist',
    status: 'busy',
    currentTask: 'Polish Settings nav rail',
    lastActivity: '8m ago',
    tasksToday: 4,
    tpmHistory: [60, 90, 120, 150, 180, 200, 220, 240, 260, 230, 210, 190, 170, 150],
  },
  {
    id: 'a3',
    name: 'Cassini',
    role: 'QA + review',
    status: 'idle',
    currentTask: undefined,
    lastActivity: '32m ago',
    tasksToday: 12,
    tpmHistory: [10, 5, 8, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'a4',
    name: 'Drift',
    role: 'Migration sweeper',
    status: 'error',
    currentTask: 'Bulk-rename `var(--token)` to literals',
    lastActivity: '1h ago',
    tasksToday: 2,
    tpmHistory: [200, 220, 240, 260, 0, 0, 0, 0],
  },
  {
    id: 'a5',
    name: 'Ember',
    role: 'Memory curator',
    status: 'paused',
    lastActivity: '2h ago',
    tasksToday: 1,
    tpmHistory: [40, 60, 80, 100, 80, 60, 40, 20],
  },
  {
    id: 'a6',
    name: 'Ferro',
    role: 'Build + test',
    status: 'idle',
    lastActivity: '15m ago',
    tasksToday: 9,
    tpmHistory: [30, 40, 50, 60, 50, 40, 30, 20, 10],
  },
];

const FEATURED_AGENT_ID = 'a1';

const ACTIVITY: AgentActivityItem[] = [
  { id: 'ev1', icon: <Bot size={14} aria-hidden="true" />, title: 'Run started', description: 'Picked up "Wire TanStack Router in v8 App"', meta: '12:04', tone: 'info' },
  { id: 'ev2', icon: <Wrench size={14} aria-hidden="true" />, title: 'Tool call', description: 'Read src/web/v8/App.tsx', meta: '12:05' },
  { id: 'ev3', icon: <MessageSquare size={14} aria-hidden="true" />, title: 'Message received', description: '"Use the state-based router"', meta: '12:06', tone: 'info' },
  { id: 'ev4', icon: <GitMerge size={14} aria-hidden="true" />, title: 'Committed', description: 'feat(v8-dash): wire app-level router', meta: '12:08', tone: 'success' },
];

export function AgentsView(): JSX.Element {
  return (
    <Stack gap={5}>
      <ViewHeader
        title="Agents"
        description="The orchestrator's running entities. Click a card to drill into one."
      />
      <Grid cols={3}>
        {AGENTS.map((agent) => (
          <AgentCard key={agent.id} {...agent} />
        ))}
      </Grid>
      <Card>
        <CardHeader
          title={`Activity — ${AGENTS.find((a) => a.id === FEATURED_AGENT_ID)?.name ?? ''}`}
        />
        <CardBody>
          <AgentActivity items={ACTIVITY} />
        </CardBody>
      </Card>
    </Stack>
  );
}