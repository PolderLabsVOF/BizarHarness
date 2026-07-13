import { useCallback, useEffect, useState } from 'react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { GoalCard, type GoalCardProps, type GoalStatus } from '../../ui/goals/GoalCard.js';
import { KeyResult, type KeyResultProps, type KeyResultStatus } from '../../ui/goals/KeyResult.js';
import { Card, CardBody, CardHeader } from '../../ui/data/Card.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { Select, SelectTrigger, SelectContent, SelectItem } from '../../ui/controls/Select.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { fetchJson } from '../../data/fetcher.js';
import type { Goal, WsMessage } from '../../data/types.js';

/**
 * GoalsView — Sprint S10. Pulls `/api/goals` (parsed PROGRESS.md).
 * Status badge click → optimistic update + PATCH /api/goals/:id/status.
 * Key results are pulled from the goal's keyResults[] list.
 */

const STATUS_OPTIONS = [
  { value: 'on-track', label: 'On track' },
  { value: 'at-risk', label: 'At risk' },
  { value: 'off-track', label: 'Off track' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'active', label: 'Active' },
];

function goalToCard(g: Goal): GoalCardProps {
  return {
    id: g.id,
    title: g.title,
    description: g.description || '',
    status: g.status as GoalStatus,
    progress: g.progress,
    due: g.due,
    ownerName: g.owner,
    keyResultsDone: g.keyResults.filter((k) => k.done).length,
    keyResultsTotal: g.keyResults.length,
  };
}

function krStatus(kr: { done: boolean }): KeyResultStatus {
  return kr.done ? 'done' : 'in-progress';
}

function goalToKRs(g: Goal): KeyResultProps[] {
  return g.keyResults.map((k) => ({
    id: k.id,
    title: k.title,
    status: krStatus(k),
    progress: k.done ? 1 : 0,
    assignee: k.assignee,
  }));
}

export function GoalsView(): JSX.Element {
  const goals = useFetch<{ goals?: Goal[]; count?: number }>('/api/goals');
  const [local, setLocal] = useState<Goal[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [focusedGoalId, setFocusedGoalId] = useState<string | null>(null);

  useEffect(() => {
    if (goals.data?.goals && !initialized) {
      setInitialized(true);
      setLocal(goals.data.goals);
    }
  }, [goals.data, initialized]);

  const onChange = useCallback((msg: WsMessage) => {
    if (msg.type !== 'goals:change') return;
    const g = (msg as Extract<WsMessage, { type: 'goals:change' }>).goal;
    if (!g) return;
    setLocal((prev) => {
      const idx = prev.findIndex((x) => x.id === g.id);
      if (idx === -1) return [...prev, g];
      const copy = prev.slice();
      copy[idx] = g;
      return copy;
    });
  }, []);
  useWsMessage('goals:change', onChange);

  const setStatus = useCallback(async (id: string, status: string) => {
    setLocal((prev) =>
      prev.map((g) => (g.id === id ? { ...g, status: status as Goal['status'] } : g)),
    );
    try {
      await fetchJson(`/api/goals/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: { status },
      });
    } catch {
      // server will re-broadcast the canonical state via WS on the next reload
    }
  }, []);

  const focused = focusedGoalId ? local.find((g) => g.id === focusedGoalId) : null;

  return (
    <Stack gap={5}>
      <ViewHeader
        title="Goals"
        description="Long-horizon commitments parsed from .bizar/PROGRESS.md."
      />
      {goals.loading && local.length === 0 ? (
        <Stack gap={3}>
          <Skeleton style={{ height: 160 }} />
          <Skeleton style={{ height: 160 }} />
        </Stack>
      ) : local.length === 0 ? (
        <Card>
          <CardBody>
            <Stack gap={2}>
              <strong>No goals yet.</strong>
              <span style={{ color: 'var(--fg-muted)' }}>
                Create one with the dashboard or via CC's <code>/goal &lt;text&gt;</code>.
              </span>
            </Stack>
          </CardBody>
        </Card>
      ) : (
        <Grid cols={2}>
          {local.map((g) => (
            <div
              key={g.id}
              role="button"
              tabIndex={0}
              onClick={() => setFocusedGoalId(g.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocusedGoalId(g.id); } }}
              style={{ cursor: 'pointer', outline: 'none' }}
              data-testid={`goal-card-${g.id}`}
            >
              <GoalCard {...goalToCard(g)} />
            </div>
          ))}
        </Grid>
      )}

      {focused && (
        <Card>
          <CardHeader
            title={`Goal · ${focused.title}`}
            action={
              <Select
                value={focused.status}
                onValueChange={(v) => setStatus(focused.id, v)}
              >
                <SelectTrigger size="sm" placeholder="Status" />
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <CardBody>
            <Stack gap={2}>
              {goalToKRs(focused).map((kr) => (
                <KeyResult key={kr.id} {...kr} />
              ))}
              {focused.keyResults.length === 0 && (
                <span style={{ color: 'var(--fg-muted)' }}>No key results yet.</span>
              )}
            </Stack>
          </CardBody>
        </Card>
      )}
    </Stack>
  );
}