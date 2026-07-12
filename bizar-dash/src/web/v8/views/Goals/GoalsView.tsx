import { Stack } from '../../ui/primitives/Stack.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { GoalCard, type GoalCardProps } from '../../ui/goals/GoalCard.js';
import { KeyResult, type KeyResultProps } from '../../ui/goals/KeyResult.js';
import { Card, CardBody, CardHeader } from '../../ui/data/Card.js';

/**
 * GoalsView — long-horizon commitments (PLAN.md "Goals page").
 *
 * Goals are intentional commitments tracked over weeks/months. They are
 * NOT kanban cards. Each goal surfaces key results inline so the user
 * can see "what does done look like" at a glance.
 */

const GOALS: GoalCardProps[] = [
  {
    id: 'g1',
    title: 'Ship v8 dashboard',
    description: 'Replace the v7 dashboard with a fully-token-driven component library.',
    status: 'on-track',
    progress: 0.62,
    due: 'Q3 2026',
    ownerName: 'alex',
    keyResultsDone: 5,
    keyResultsTotal: 8,
  },
  {
    id: 'g2',
    title: 'Cut S9 polish in half',
    description: 'Reduce polish + views-wiring sprint from 10 days to 5.',
    status: 'at-risk',
    progress: 0.3,
    due: 'Aug 1',
    ownerName: 'sam',
    keyResultsDone: 1,
    keyResultsTotal: 4,
  },
  {
    id: 'g3',
    title: 'Make every page keyboard-navigable',
    description: 'A11y pass across Tasks, Goals, Agents, Memory, Settings.',
    status: 'done',
    progress: 1,
    due: 'Q2 2026',
    ownerName: 'jordan',
    keyResultsDone: 6,
    keyResultsTotal: 6,
  },
];

const KEY_RESULTS: KeyResultProps[] = [
  { id: 'k1', title: 'Publish Plan.md with 17 sections', status: 'done', progress: 1, metric: '17 / 17' },
  { id: 'k2', title: 'Ship Sprint S1 (Foundation)', status: 'done', progress: 1, metric: 'sprint S1' },
  { id: 'k3', title: 'Ship Sprint S5 (Kanban centerpiece)', status: 'done', progress: 1, metric: 'sprint S5' },
  { id: 'k4', title: 'Wire app-level CommandPalette', status: 'in-progress', progress: 0.5, metric: '1 / 2 hooks', assignee: 'alex' },
  { id: 'k5', title: 'Ship Sprint S9 (Polish + views)', status: 'not-started', progress: 0, assignee: 'sam' },
];

export function GoalsView(): JSX.Element {
  return (
    <Stack gap={5}>
      <ViewHeader
        title="Goals"
        description="Long-horizon commitments. Each goal lists the measurable key results that signal done."
      />
      <Grid cols={2}>
        {GOALS.map((goal) => (
          <GoalCard key={goal.id} {...goal} />
        ))}
      </Grid>
      <Card>
        <CardHeader title="Key results — current focus" />
        <CardBody>
          <Stack gap={2}>
            {KEY_RESULTS.map((kr) => (
              <KeyResult key={kr.id} {...kr} />
            ))}
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}