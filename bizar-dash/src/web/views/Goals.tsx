// src/views/Goals.tsx — F-041 Per-Project Goals & Tasks Board.
//
// v6.6.0 — Replaces the ephemeral GoalPlanner (F-036) with a
// durable Goals board. Each project gets a list of Goal entities
// with live task progress rollups. AI Refine still runs through
// the same /api/goals/:id/refine endpoint; "Save as Goal" persists
// the resulting plan as a Goal + linked Tasks.
//
// Layout:
//   - Header: project selector + "+ New Goal" + "AI Refine"
//   - Grid of goal cards (GoalCard)
//     - Each card shows live progress (re-fetched on WS updates)
//     - Expand: inline task list filtered by goalId
//     - "+ Add task" → opens modal pre-linking the new task
//   - AI Refine modal: text input → POST /goals/:id/refine → plan
//     + "Save as Goal" → POST /goals/from-plan
//
// State is held in this component because the API surface is small
// enough that lifting it to App.tsx would just add wiring without
// any reuse benefit.

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Sparkles, Target, RefreshCw } from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Spinner } from '../components/Spinner';
import { GoalCard } from '../components/goals/GoalCard';
import { useModal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { Ws } from '../lib/ws';
import type {
  Goal,
  GoalProgress,
  ProjectRecord,
  Settings,
  Snapshot,
  Task,
  WsMessage,
} from '../lib/types';
import type { Plan } from '../lib/goapPlanner';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

const EMPTY_PROGRESS: GoalProgress = {
  total: 0,
  done: 0,
  blocked: 0,
  inProgress: 0,
  archived: 0,
  percent: 0,
};

function GoalsInner({ snapshot, setActiveTab }: Props) {
  const toast = useToast();
  const modal = useModal();

  const projects: ProjectRecord[] = snapshot.projects || [];
  const fallbackProjectId = snapshot.activeProject?.id || projects[0]?.id || '';
  const [projectId, setProjectId] = useState<string>(fallbackProjectId);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [progressByGoal, setProgressByGoal] = useState<Record<string, GoalProgress>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [tasksByGoal, setTasksByGoal] = useState<Record<string, Task[]>>({});

  const reload = useCallback(async (pid: string) => {
    if (!pid) {
      setGoals([]);
      setProgressByGoal({});
      setTasksByGoal({});
      return;
    }
    setLoading(true);
    try {
      const r = await api.get<{ goals: Goal[] }>(`/goals?projectId=${encodeURIComponent(pid)}`);
      const list: Goal[] = Array.isArray(r.goals) ? r.goals : [];
      setGoals(list);

      // Fetch live progress for each goal in parallel.
      const progressEntries = await Promise.all(
        list.map(async (g) => {
          try {
            const p = await api.get<{ progress: GoalProgress }>(
              `/goals/${encodeURIComponent(g.id)}/progress?projectId=${encodeURIComponent(pid)}`,
            );
            return [g.id, p.progress] as const;
          } catch {
            return [g.id, EMPTY_PROGRESS] as const;
          }
        }),
      );
      setProgressByGoal(Object.fromEntries(progressEntries));
    } catch (err) {
      toast.error(`Goals load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Fetch tasks linked to each goal for the inline task list.
  const reloadTasks = useCallback(async (pid: string, list: Goal[]) => {
    if (!pid || list.length === 0) {
      setTasksByGoal({});
      return;
    }
    try {
      const tasks = await api.get<Task[]>(`/tasks?projectId=${encodeURIComponent(pid)}`);
      const byGoal: Record<string, Task[]> = {};
      for (const t of tasks) {
        if (t.goalId) {
          if (!byGoal[t.goalId]) byGoal[t.goalId] = [];
          byGoal[t.goalId].push(t);
        }
      }
      setTasksByGoal(byGoal);
    } catch {
      // Non-fatal — cards still render with progress bars.
    }
  }, []);

  // Initial load + re-load on project change.
  useEffect(() => {
    if (!projectId) return;
    reload(projectId);
  }, [projectId, reload]);

  // Fetch tasks whenever the goal list changes.
  useEffect(() => {
    if (projectId && goals.length > 0) {
      reloadTasks(projectId, goals);
    }
  }, [projectId, goals, reloadTasks]);

  // Subscribe to WS events for live updates.
  useEffect(() => {
    const ws = new Ws();
    const off = ws.on((msg: WsMessage) => {
      switch (msg.type) {
        case 'goal:change': {
          const m = msg as Extract<WsMessage, { type: 'goal:change' }>;
          setGoals((cur) => {
            const idx = cur.findIndex((g) => g.id === m.goal.id);
            if (idx === -1) return [m.goal, ...cur];
            const next = cur.slice();
            next[idx] = m.goal;
            return next;
          });
          // If status flipped to/from archived, the list filter needs
          // a refetch — the WS message alone doesn't tell us what the
          // user's status filter wants.
          if (m.goal.status === 'archived' || m.goal.status === 'active') {
            reload(projectId);
          }
          break;
        }
        case 'goal:tasks-linked': {
          const m = msg as Extract<WsMessage, { type: 'goal:tasks-linked' }>;
          setProgressByGoal((cur) => ({
            ...cur,
            [m.goalId]: { ...(cur[m.goalId] || EMPTY_PROGRESS) },
          }));
          reloadTasks(projectId, goals);
          break;
        }
        case 'goal:progress': {
          const m = msg as Extract<WsMessage, { type: 'goal:progress' }>;
          setProgressByGoal((cur) => ({ ...cur, [m.goalId]: m.progress }));
          break;
        }
        case 'tasks:change': {
          // Task fields changed (status flip affects goal progress).
          const m = msg as Extract<WsMessage, { type: 'tasks:change' }>;
          if (m.task?.goalId) {
            // Re-fetch the affected goal's progress.
            api
              .get<{ progress: GoalProgress }>(
                `/goals/${encodeURIComponent(m.task.goalId)}/progress?projectId=${encodeURIComponent(projectId)}`,
              )
              .then((r) =>
                setProgressByGoal((cur) => ({ ...cur, [m.task.goalId as string]: r.progress })),
              )
              .catch(() => undefined);
            reloadTasks(projectId, goals);
          }
          break;
        }
        default:
          break;
      }
    });
    return () => {
      off();
      ws.close();
    };
    // We deliberately don't add `goals` to the deps list — we only
    // want to re-subscribe when the WS instance changes (mount /
    // unmount). Captured `goals` inside the handler is the latest via
    // the closure refresh from reloadTasks().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const onCreate = () => openCreateGoalModal(modal, toast, projectId, reload);
  const onRefineBlank = () => openRefineModal(modal, toast, projectId, null, async () => {
    await reload(projectId);
  });

  const onEditGoal = (g: Goal) => openEditGoalModal(modal, toast, projectId, g, reload);
  const onArchiveGoal = async (g: Goal) => {
    try {
      await api.del(`/goals/${encodeURIComponent(g.id)}?projectId=${encodeURIComponent(projectId)}`);
      toast.success(`Archived "${g.title}".`, 1200);
      await reload(projectId);
    } catch (err) {
      toast.error(`Archive failed: ${(err as Error).message}`);
    }
  };
  const onRefineGoal = (g: Goal) =>
    openRefineModal(modal, toast, projectId, g, async () => {
      await reload(projectId);
    });
  const onAddTask = (g: Goal) =>
    openCreateLinkedTaskModal(modal, toast, projectId, g, async () => {
      await reload(projectId);
      await reloadTasks(projectId, goals);
    });

  return (
    <div className="view view-goals" data-testid="goals-view">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Target size={18} /> Goals ({goals.length})
          </h2>
          <p className="view-subtitle">
            Each goal is a durable board of linked tasks. Refine with AI to spin up a GOAP plan and persist it as tasks.
          </p>
        </div>
        <div className="view-header-actions">
          <select
            className="select select-sm"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            aria-label="Project"
            title="Project"
          >
            {projects.length === 0 && <option value="">(no projects)</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name || p.id}</option>
            ))}
          </select>
          <Button variant="ghost" size="sm" onClick={() => reload(projectId)} title="Refresh" aria-label="Refresh goals">
            <RefreshCw size={14} />
          </Button>
          <Button variant="primary" size="sm" onClick={onCreate} disabled={!projectId}>
            <Plus size={14} /> New goal
          </Button>
          <Button variant="accent" size="sm" onClick={onRefineBlank} disabled={!projectId}>
            <Sparkles size={14} /> AI Refine
          </Button>
        </div>
      </header>

      {!projectId && (
        <Card>
          <CardTitle>No project selected</CardTitle>
          <CardMeta>Pick a project from the dropdown above to load its goals.</CardMeta>
        </Card>
      )}

      {projectId && loading && (
        <div className="view-loading"><Spinner size="lg" /></div>
      )}

      {projectId && !loading && goals.length === 0 && (
        <Card>
          <CardTitle>No goals yet</CardTitle>
          <CardMeta>
            Click <strong>New goal</strong> to add one, or <strong>AI Refine</strong> to draft a plan from a plain-English goal.
          </CardMeta>
        </Card>
      )}

      {projectId && !loading && goals.length > 0 && (
        <div className="goals-grid" data-testid="goals-grid">
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              progress={progressByGoal[g.id] || EMPTY_PROGRESS}
              onEdit={onEditGoal}
              onArchive={onArchiveGoal}
              onRefine={onRefineGoal}
              onAddTask={onAddTask}
            />
          ))}
        </div>
      )}

      {/* Inline task list per goal — rendered as a small collapsible
          panel below the grid for the first goal so the user can see
          the relationship without expanding every card. */}
      {projectId && !loading && goals.length > 0 && (
        <section className="goal-tasks-panel" data-testid="goal-tasks-panel">
          {goals.map((g) => {
            const linked = tasksByGoal[g.id] || [];
            if (linked.length === 0) return null;
            return (
              <Card key={g.id}>
                <CardTitle>
                  <Target size={12} /> {g.title} — linked tasks ({linked.length})
                </CardTitle>
                <ul className="goal-linked-tasks">
                  {linked.map((t) => (
                    <li
                      key={t.id}
                      className={`goal-linked-task status-${t.status}`}
                      data-task-id={t.id}
                    >
                      <span className={`status-dot status-${t.status}`} />
                      <span className="goal-linked-task-title">{t.title}</span>
                      <span className="muted text-xs">{t.status}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
}

// ─── Modals ────────────────────────────────────────────────────────────────

function openCreateGoalModal(
  modal: ReturnType<typeof useModal>,
  toast: ReturnType<typeof useToast>,
  projectId: string,
  reload: (pid: string) => Promise<void>,
) {
  let titleEl: HTMLInputElement | null = null;
  let descEl: HTMLTextAreaElement | null = null;
  let priorityEl: HTMLSelectElement | null = null;
  let ownerEl: HTMLInputElement | null = null;
  let targetEl: HTMLInputElement | null = null;
  let tagsEl: HTMLInputElement | null = null;

  const submit = async () => {
    const title = (titleEl?.value || '').trim();
    if (!title) {
      toast.warning('Title is required.');
      titleEl?.focus();
      return;
    }
    const tags = (tagsEl?.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await api.post('/goals', {
        projectId,
        title,
        description: descEl?.value || '',
        priority: priorityEl?.value || 'normal',
        owner: ownerEl?.value || null,
        targetDate: targetEl?.value || null,
        tags,
      });
      modal.close();
      toast.success('Goal created.', 1200);
      await reload(projectId);
    } catch (err) {
      toast.error(`Create failed: ${(err as Error).message}`);
    }
  };

  modal.open({
    title: 'New goal',
    width: 520,
    children: (
      <div className="goal-form">
        <label className="field-label" htmlFor="new-goal-title">Title *</label>
        <input
          ref={(el) => { titleEl = el; }}
          id="new-goal-title"
          className="input"
          type="text"
          maxLength={200}
          placeholder="Ship the goals board"
          autoFocus
        />
        <label className="field-label" htmlFor="new-goal-desc">Description</label>
        <textarea
          ref={(el) => { descEl = el; }}
          id="new-goal-desc"
          className="textarea"
          rows={4}
          placeholder="What does success look like?"
        />
        <div className="goal-form-row">
          <label htmlFor="new-goal-priority" className="goal-form-field">
            Priority
            <select
              ref={(el) => { priorityEl = el; }}
              id="new-goal-priority"
              className="select"
              defaultValue="normal"
            >
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
            </select>
          </label>
          <label htmlFor="new-goal-owner" className="goal-form-field" style={{ flex: 1 }}>
            Owner
            <input
              ref={(el) => { ownerEl = el; }}
              id="new-goal-owner"
              className="input"
              type="text"
              placeholder="@odin"
            />
          </label>
        </div>
        <div className="goal-form-row">
          <label htmlFor="new-goal-target" className="goal-form-field" style={{ flex: 1 }}>
            Target date
            <input
              ref={(el) => { targetEl = el; }}
              id="new-goal-target"
              className="input"
              type="date"
            />
          </label>
          <label htmlFor="new-goal-tags" className="goal-form-field" style={{ flex: 2 }}>
            Tags <span className="field-hint">(comma-separated)</span>
            <input
              ref={(el) => { tagsEl = el; }}
              id="new-goal-tags"
              className="input"
              type="text"
              placeholder="frontend, urgent"
            />
          </label>
        </div>
      </div>
    ),
    footer: (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          <Plus size={14} /> Create goal
        </Button>
      </div>
    ),
  });
}

function openEditGoalModal(
  modal: ReturnType<typeof useModal>,
  toast: ReturnType<typeof useToast>,
  projectId: string,
  goal: Goal,
  reload: (pid: string) => Promise<void>,
) {
  let titleEl: HTMLInputElement | null = null;
  let descEl: HTMLTextAreaElement | null = null;
  let priorityEl: HTMLSelectElement | null = null;
  let statusEl: HTMLSelectElement | null = null;
  let targetEl: HTMLInputElement | null = null;

  const submit = async () => {
    const title = (titleEl?.value || '').trim();
    if (!title) {
      toast.warning('Title is required.');
      titleEl?.focus();
      return;
    }
    try {
      await api.patch(`/goals/${encodeURIComponent(goal.id)}?projectId=${encodeURIComponent(projectId)}`, {
        title,
        description: descEl?.value || '',
        priority: priorityEl?.value || goal.priority,
        status: statusEl?.value || goal.status,
        targetDate: targetEl?.value || null,
      });
      modal.close();
      toast.success('Goal updated.', 1200);
      await reload(projectId);
    } catch (err) {
      toast.error(`Update failed: ${(err as Error).message}`);
    }
  };

  modal.open({
    title: `Edit goal — ${goal.title}`,
    width: 520,
    children: (
      <div className="goal-form">
        <label className="field-label" htmlFor="edit-goal-title">Title *</label>
        <input
          ref={(el) => { titleEl = el; }}
          id="edit-goal-title"
          className="input"
          type="text"
          maxLength={200}
          defaultValue={goal.title}
          autoFocus
        />
        <label className="field-label" htmlFor="edit-goal-desc">Description</label>
        <textarea
          ref={(el) => { descEl = el; }}
          id="edit-goal-desc"
          className="textarea"
          rows={4}
          defaultValue={goal.description || ''}
        />
        <div className="goal-form-row">
          <label htmlFor="edit-goal-priority" className="goal-form-field">
            Priority
            <select
              ref={(el) => { priorityEl = el; }}
              id="edit-goal-priority"
              className="select"
              defaultValue={goal.priority || 'normal'}
            >
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
            </select>
          </label>
          <label htmlFor="edit-goal-status" className="goal-form-field">
            Status
            <select
              ref={(el) => { statusEl = el; }}
              id="edit-goal-status"
              className="select"
              defaultValue={goal.status || 'active'}
            >
              <option value="active">active</option>
              <option value="completed">completed</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label htmlFor="edit-goal-target" className="goal-form-field" style={{ flex: 1 }}>
            Target date
            <input
              ref={(el) => { targetEl = el; }}
              id="edit-goal-target"
              className="input"
              type="date"
              defaultValue={(goal.targetDate || '').slice(0, 10)}
            />
          </label>
        </div>
      </div>
    ),
    footer: (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save</Button>
      </div>
    ),
  });
}

function openRefineModal(
  modal: ReturnType<typeof useModal>,
  toast: ReturnType<typeof useToast>,
  projectId: string,
  goal: Goal | null,
  onSaved: () => Promise<void>,
) {
  let textEl: HTMLTextAreaElement | null = null;
  let planPanel: HTMLDivElement | null = null;
  let saveBtn: HTMLButtonElement | null = null;
  let currentPlan: Plan | null = null;

  const runRefine = async () => {
    const text = (textEl?.value || '').trim();
    if (!text) {
      toast.warning('Describe what you want to achieve.');
      return;
    }
    try {
      let plan: Plan;
      let suggestedTasks: unknown[] = [];
      if (goal) {
        const r = await api.post<{ plan: Plan; suggestedTasks: unknown[] }>(
          `/goals/${encodeURIComponent(goal.id)}/refine?projectId=${encodeURIComponent(projectId)}`,
          { text },
        );
        plan = r.plan;
        suggestedTasks = r.suggestedTasks || [];
      } else {
        // No goal yet — generate a plan via the legacy planner
        // endpoint, but show the result inline. The user can hit
        // "Save as Goal" to persist it.
        const r = await api.post<Plan>(
          '/goal-planner/plan',
          { goal: text },
        );
        plan = r;
        suggestedTasks = (plan.steps || []).map((s) => ({
          title: s.title,
          description: s.description,
          priority: 'normal',
        }));
      }
      currentPlan = plan;
      if (planPanel) {
        planPanel.innerHTML = renderPlanHtml(plan);
      }
      if (saveBtn) {
        saveBtn.disabled = false;
      }
    } catch (err) {
      toast.error(`Refine failed: ${(err as Error).message}`);
    }
  };

  const saveAsGoal = async () => {
    if (!currentPlan) {
      toast.warning('Run Refine first.');
      return;
    }
    try {
      const r = await api.post<{ goalId: string; goal: Goal; linkedTaskIds: string[] }>(
        `/goals/from-plan?projectId=${encodeURIComponent(projectId)}`,
        { plan: currentPlan, persist: true, title: goal?.title || textEl?.value || 'New goal' },
      );
      modal.close();
      toast.success(`Created goal + ${r.linkedTaskIds.length} tasks.`, 1500);
      await onSaved();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  };

  modal.open({
    title: goal ? `Refine — ${goal.title}` : 'AI Refine — new goal',
    width: 640,
    children: (
      <div className="goal-refine-modal">
        <label className="field-label" htmlFor="goal-refine-text">
          Describe what you want to achieve in plain English.
        </label>
        <textarea
          ref={(el) => { textEl = el; }}
          id="goal-refine-text"
          className="textarea"
          rows={4}
          placeholder="Research the API, design the schema, implement the endpoint, test it, deploy"
          defaultValue={goal ? `${goal.title}${goal.description ? ' — ' + goal.description : ''}` : ''}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button variant="primary" size="sm" onClick={runRefine}>
            <Sparkles size={12} /> Refine
          </Button>
        </div>
        <div
          ref={(el) => { planPanel = el; }}
          className="goal-refine-plan"
          style={{ marginTop: 12 }}
        />
      </div>
    ),
    footer: (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
        <Button
          ref={(el) => { saveBtn = el as unknown as HTMLButtonElement; }}
          variant="accent"
          onClick={saveAsGoal}
          disabled
        >
          <Target size={12} /> Save as Goal
        </Button>
      </div>
    ),
  });
}

function renderPlanHtml(plan: Plan): string {
  const steps = plan.steps || [];
  if (steps.length === 0) return '<p class="muted">Plan is empty.</p>';
  return `<ol class="goal-plan-list">${steps
    .map(
      (s) =>
        `<li class="goal-plan-step"><strong>${escapeHtml(s.title)}</strong> <span class="muted text-xs">@${escapeHtml(
          s.agent,
        )} · ${escapeHtml(s.action)} · est ${Math.round((s.estimatedDurationMs || 0) / 1000)}s</span><div class="muted">${escapeHtml(
          s.description || '',
        )}</div></li>`,
    )
    .join('')}</ol><div class="muted text-xs">${steps.length} steps · cost ${plan.totalCost} · ${Math.round(
    (plan.totalDurationMs || 0) / 1000,
  )}s</div>`;
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openCreateLinkedTaskModal(
  modal: ReturnType<typeof useModal>,
  toast: ReturnType<typeof useToast>,
  projectId: string,
  goal: Goal,
  onSaved: () => Promise<void>,
) {
  let titleEl: HTMLInputElement | null = null;
  let descEl: HTMLTextAreaElement | null = null;
  let priorityEl: HTMLSelectElement | null = null;

  const submit = async () => {
    const title = (titleEl?.value || '').trim();
    if (!title) {
      toast.warning('Title is required.');
      titleEl?.focus();
      return;
    }
    try {
      // Create the task with goalId pre-set so the user doesn't have
      // to wire it up after creation.
      const created = await api.post<Task>('/tasks', {
        projectId,
        title,
        description: descEl?.value || '',
        priority: priorityEl?.value || 'normal',
        goalId: goal.id,
      });
      toast.success(`Task created and linked to "${goal.title}".`, 1500);
      modal.close();
      await onSaved();
      void created; // result not used here — WS event will refresh state.
    } catch (err) {
      toast.error(`Create failed: ${(err as Error).message}`);
    }
  };

  modal.open({
    title: `New task for "${goal.title}"`,
    width: 520,
    children: (
      <div className="task-form">
        <p className="muted text-sm" style={{ marginBottom: 8 }}>
          The new task will be auto-linked to <strong>{goal.title}</strong>.
        </p>
        <label className="field-label" htmlFor="goal-task-title">Title *</label>
        <input
          ref={(el) => { titleEl = el; }}
          id="goal-task-title"
          className="input"
          type="text"
          maxLength={200}
          placeholder="What needs to be done?"
          autoFocus
        />
        <label className="field-label" htmlFor="goal-task-desc">Description</label>
        <textarea
          ref={(el) => { descEl = el; }}
          id="goal-task-desc"
          className="textarea"
          rows={4}
          placeholder="Add any context (markdown ok)…"
        />
        <label htmlFor="goal-task-priority" className="field-label" style={{ marginTop: 8 }}>
          Priority
        </label>
        <select
          ref={(el) => { priorityEl = el; }}
          id="goal-task-priority"
          className="select"
          defaultValue="normal"
        >
          <option value="low">low</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
        </select>
      </div>
    ),
    footer: (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          <Plus size={14} /> Create task
        </Button>
      </div>
    ),
  });
}

export const Goals = React.memo(GoalsInner);
export default Goals;