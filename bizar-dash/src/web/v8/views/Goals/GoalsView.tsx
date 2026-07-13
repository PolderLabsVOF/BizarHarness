import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Chip } from '../../ui/data/Chip.js';
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
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredGoals = statusFilter === 'all' ? local : local.filter((g) => g.status === statusFilter);

  const STATUS_FILTERS = ['all', 'active', 'on-track', 'at-risk', 'off-track', 'blocked', 'done'] as const;

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
    // Tombstone broadcast from the server after a DELETE — drop the card.
    if ('removed' in g && (g as { removed?: boolean }).removed) {
      setLocal((prev) => prev.filter((x) => x.id !== g.id));
      if (openGoalId === g.id) setOpenGoalId(null);
      return;
    }
    setLocal((prev) => {
      const idx = prev.findIndex((x) => x.id === g.id);
      if (idx === -1) return [...prev, g];
      const copy = prev.slice();
      copy[idx] = g;
      return copy;
    });
  }, [openGoalId]);
  useWsMessage('goals:change', onChange);
  useWsMessage('goals:removed', (msg) => {
    const id = (msg as Extract<WsMessage, { type: 'goals:removed' }>).id;
    setLocal((prev) => prev.filter((x) => x.id !== id));
    if (openGoalId === id) setOpenGoalId(null);
  });

  const createGoal = useCallback(async () => {
    // Inline dialog flow: prompt for title + optional description before
    // POSTing. Empty submission is rejected client-side.
    const title = (typeof window !== 'undefined' && typeof window.prompt === 'function'
      ? window.prompt('Goal title?')
      : 'New goal');
    if (title === null) return; // user cancelled
    const trimmed = title.trim();
    if (!trimmed) return;
    const description = typeof window !== 'undefined' && typeof window.prompt === 'function'
      ? (window.prompt('Optional description?') ?? '')
      : '';
    setCreating(true);
    try {
      const res = await fetchJson<{ goal?: Goal; id?: string }>('/api/goals', {
        method: 'POST',
        body: { title: trimmed, description: description.trim() || undefined, status: 'active' },
      });
      if (res.goal) setLocal((prev) => [...prev, res.goal as Goal]);
      if (res.id) setOpenGoalId(res.id);
    } catch (err) {
      setDecomposeError(err instanceof Error ? err.message : String(err));
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

  const deleteGoal = useCallback(async (goalId: string) => {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm('Delete this goal? This removes it from PROGRESS.md.')
      : true;
    if (!ok) return;
    try {
      await fetchJson(`/api/goals/${encodeURIComponent(goalId)}`, { method: 'DELETE' });
      // Server broadcasts goals:removed + goals:change tombstone; the
      // WS handler drops the card. Close the drawer if it was open.
      setLocal((prev) => prev.filter((x) => x.id !== goalId));
      if (openGoalId === goalId) setOpenGoalId(null);
    } catch (err) {
      setDecomposeError(err instanceof Error ? err.message : String(err));
    }
  }, [openGoalId]);

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
      <Inline gap={1} wrap>
        {STATUS_FILTERS.map((s) => (
          <Chip key={s} selected={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {s === 'all' ? 'All' : s.replace(/-/g, ' ')}
            {s !== 'all' && ` · ${local.filter((g) => g.status === s).length}`}
          </Chip>
        ))}
      </Inline>
      {goals.loading && local.length === 0 ? (
        <Stack gap={3}>
          <Skeleton style={{ height: 160 }} />
          <Skeleton style={{ height: 160 }} />
        </Stack>
      ) : filteredGoals.length === 0 ? (
        <Card>
          <CardBody>
            <Stack gap={2}>
              <strong>No goals {statusFilter === 'all' ? 'yet' : `with status “${statusFilter}”`}.</strong>
              <span style={{ color: 'var(--fg-muted)' }}>
                Create one with the dashboard or via CC's <code>/goal &lt;text&gt;</code>.
              </span>
            </Stack>
          </CardBody>
        </Card>
      ) : (
        <Grid cols={2}>
          {filteredGoals.map((g) => {
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
                  <Inline align="center" justify="end" gap={1}>
                    <Button
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); void deleteGoal(g.id); }}
                      title="Delete goal"
                      aria-label={`Delete goal ${g.title}`}
                    >
                      <Trash2 size={12} aria-hidden /> Delete
                    </Button>
                  </Inline>
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