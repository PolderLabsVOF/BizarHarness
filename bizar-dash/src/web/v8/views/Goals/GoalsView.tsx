import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { GoalCard, type GoalCardProps, type GoalStatus } from '../../ui/goals/GoalCard.js';
import { GoalDetail } from '../../ui/goals/GoalDetail.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { Button } from '../../ui/controls/Button.js';
import { useFetch } from '../../data/useFetch.js';
import { useWsMessage } from '../../data/useWebSocket.js';
import { fetchJson } from '../../data/fetcher.js';
import type { Goal, WsMessage } from '../../data/types.js';

/**
 * GoalsView — Sprint S10/S12. Pulls `/api/goals` (parsed PROGRESS.md).
 * Card click → `GoalDetail` Drawer (editable title / status / due /
 * owner / KR add/toggle/remove). "+ New goal" button creates a fresh
 * goal via `POST /api/goals`. Live updates via `goals:change`.
 */

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

export function GoalsView(): JSX.Element {
  const goals = useFetch<{ goals?: Goal[]; count?: number }>('/api/goals');
  const [local, setLocal] = useState<Goal[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [openGoalId, setOpenGoalId] = useState<string | null>(null);
  const [creating, setCreating] = useState<boolean>(false);
  const [decomposing, setDecomposing] = useState<string | null>(null);
  const [decomposeError, setDecomposeError] = useState<string | null>(null);

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

  const createGoal = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetchJson<{ goal?: Goal; id?: string }>('/api/goals', {
        method: 'POST',
        body: { title: 'New goal' },
      });
      if (res.goal) setLocal((prev) => [...prev, res.goal as Goal]);
      if (res.id) setOpenGoalId(res.id);
    } catch {
      // server will broadcast the canonical state via WS on the next reload
    } finally {
      setCreating(false);
    }
  }, []);

  const openGoal = openGoalId ? local.find((g) => g.id === openGoalId) ?? null : null;

  const decompose = useCallback(async (goalId: string) => {
    setDecomposing(goalId);
    setDecomposeError(null);
    try {
      const res = await fetchJson<{ goalId: string; created: { kr: string; task: string }[] }>(
        `/api/goals/${encodeURIComponent(goalId)}/decompose`,
        { method: 'POST' },
      );
      // Patch local state with the new taskIds so the button reflects
      // "Decomposed" without waiting for the WS roundtrip.
      if (Array.isArray(res.created) && res.created.length > 0) {
        setLocal((prev) => prev.map((g) => {
          if (g.id !== goalId) return g;
          const krs = (g.keyResults ?? []).map((kr) => {
            const link = res.created.find((c) => c.kr === kr.id);
            return link ? { ...kr, taskId: link.task } : kr;
          });
          return { ...g, keyResults: krs };
        }));
      }
    } catch (err) {
      setDecomposeError(err instanceof Error ? err.message : String(err));
    } finally {
      setDecomposing(null);
    }
  }, []);

  return (
    <Stack gap={5}>
      <ViewHeader
        title="Goals"
        description="Long-horizon commitments parsed from .bizar/PROGRESS.md."
        actions={
          <Button variant="primary" onClick={() => { void createGoal(); }} disabled={creating}>
            <Plus size={14} aria-hidden /> New goal
          </Button>
        }
      />
      {decomposeError !== null && (
        <div role="alert" style={{ padding: 'var(--space-3)', background: 'color-mix(in oklch, var(--danger) 12%, var(--surface-0))', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-12)' }}>
          Decompose failed: {decomposeError}
        </div>
      )}
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
          {local.map((g) => {
            const krCount = g.keyResults?.length ?? 0;
            const decomposed = (g.keyResults ?? []).every((kr) => Boolean(kr.taskId));
            return (
              <div
                key={g.id}
                role="button"
                tabIndex={0}
                onClick={() => setOpenGoalId(g.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenGoalId(g.id); } }}
                style={{ cursor: 'pointer', outline: 'none' }}
                data-testid={`goal-card-${g.id}`}
              >
                <Stack gap={2}>
                  <GoalCard {...goalToCard(g)} />
                  {krCount > 0 && (
                    <Inline align="center" justify="end" gap={2}>
                      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                        {decomposed ? 'Decomposed' : `${krCount} key result${krCount === 1 ? '' : 's'} · not yet linked`}
                      </span>
                      <Button
                        variant="secondary"
                        onClick={(e) => { e.stopPropagation(); void decompose(g.id); }}
                        disabled={decomposing === g.id}
                        title={decomposed ? 'Re-create missing task links' : 'Create one task per key result'}
                      >
                        <Plus size={12} aria-hidden /> {decomposed ? 'Re-link tasks' : 'Decompose → Tasks'}
                      </Button>
                    </Inline>
                  )}
                </Stack>
              </div>
            );
          })}
        </Grid>
      )}

      {openGoal && (
        <GoalDetail
          goal={openGoal}
          open={openGoalId !== null}
          onOpenChange={(o) => { if (!o) setOpenGoalId(null); }}
        />
      )}
    </Stack>
  );
}