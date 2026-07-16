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
import { ErrorState } from '../../ui/feedback/ErrorState.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Textarea } from '../../ui/controls/Textarea.js';
import { Sheet, SheetContent } from '../../ui/feedback/Sheet.js';
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
  // v9.1.1 — replace window.prompt/window.confirm with an inline Sheet
  // form for create + a per-card confirm row for delete. Same data
  // contract; better UX, accessible, no popup blockers.
  const [createDraft, setCreateDraft] = useState<{ title: string; description: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
    // v9.1.1 — open the Sheet form. POST happens when the user clicks
    // Create inside the Sheet (see saveCreate below).
    setCreateDraft({ title: '', description: '' });
  }, []);

  const saveCreate = useCallback(async () => {
    if (!createDraft || !createDraft.title.trim()) return;
    setCreating(true);
    setDecomposeError(null);
    try {
      const res = await fetchJson<{ goal?: Goal; id?: string }>('/api/goals', {
        method: 'POST',
        body: {
          title: createDraft.title.trim(),
          description: createDraft.description.trim() || undefined,
          status: 'active',
        },
      });
      if (res.goal) setLocal((prev) => [...prev, res.goal as Goal]);
      if (res.id) setOpenGoalId(res.id);
      setCreateDraft(null);
    } catch (err) {
      setDecomposeError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [createDraft]);

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
    try {
      await fetchJson(`/api/goals/${encodeURIComponent(goalId)}`, { method: 'DELETE' });
      // Server broadcasts goals:removed + goals:change tombstone; the
      // WS handler drops the card. Close the drawer if it was open.
      setLocal((prev) => prev.filter((x) => x.id !== goalId));
      if (openGoalId === goalId) setOpenGoalId(null);
      setConfirmDeleteId(null);
    } catch (err) {
      setDecomposeError(err instanceof Error ? err.message : String(err));
    }
  }, [openGoalId]);

  return (
    <Stack gap={5} data-testid="goals-view">
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
      ) : goals.error && local.length === 0 ? (
        <ErrorState
          block
          title="Couldn't load goals"
          description="The goals endpoint failed. Retry to refetch."
          error={goals.error}
          onRetry={() => void goals.refetch()}
          testid="goals-error"
        />
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
                  {confirmDeleteId === g.id ? (
                    <Inline align="center" justify="end" gap={2}>
                      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                        Delete this goal and remove it from PROGRESS.md?
                      </span>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); void deleteGoal(g.id); }}
                        data-testid={`goal-confirm-delete-${g.id}`}
                      >
                        Delete
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                      >
                        Cancel
                      </Button>
                    </Inline>
                  ) : (
                    <Inline align="center" justify="end" gap={1}>
                      <Button
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(g.id); }}
                        title="Delete goal"
                        aria-label={`Delete goal ${g.title}`}
                        data-testid={`goal-delete-${g.id}`}
                      >
                        <Trash2 size={12} aria-hidden /> Delete
                      </Button>
                    </Inline>
                  )}
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

      {/* v9.1.1 — create-goal Sheet form. Replaces window.prompt which
          blocked the user's "professional and data-driven" ask. */}
      <Sheet open={createDraft !== null} onOpenChange={(o) => { if (!o) setCreateDraft(null); }}>
        <SheetContent side="right" title="New goal">
          {createDraft !== null && (
            <Stack gap={4} style={{ padding: 'var(--space-4)' }}>
              <Stack gap={2}>
                <label htmlFor="goal-create-title" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Title</label>
                <Input
                  id="goal-create-title"
                  value={createDraft.title}
                  onChange={(e) => setCreateDraft({ ...createDraft, title: e.target.value })}
                  placeholder="Ship the orchestration center"
                  disabled={creating}
                  data-testid="goal-create-title"
                />
              </Stack>
              <Stack gap={2}>
                <label htmlFor="goal-create-desc" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Description (optional)</label>
                <Textarea
                  id="goal-create-desc"
                  value={createDraft.description}
                  onChange={(e) => setCreateDraft({ ...createDraft, description: e.target.value })}
                  rows={4}
                  placeholder="Why this goal exists and what 'done' looks like."
                  disabled={creating}
                  data-testid="goal-create-desc"
                />
              </Stack>
              <Inline gap={2}>
                <Button
                  variant="primary"
                  onClick={() => { void saveCreate(); }}
                  disabled={creating || !createDraft.title.trim()}
                  data-testid="goal-create-submit"
                >
                  Create goal
                </Button>
                <Button variant="ghost" onClick={() => setCreateDraft(null)} disabled={creating}>
                  Cancel
                </Button>
              </Inline>
            </Stack>
          )}
        </SheetContent>
      </Sheet>
    </Stack>
  );
}