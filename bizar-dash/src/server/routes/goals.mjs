/**
 * src/server/routes/goals.mjs
 *
 * v6.6.0 — F-041 (Per-Project Goals & Tasks Board).
 *
 * REST surface mounted under /api. Path layout (literal-first
 * ordering — Express matches by registration order):
 *
 *   GET    /goals                              — list (?projectId required)
 *   POST   /goals                              — create
 *   POST   /goals/from-plan                    — create from a Plan + optional {persist}
 *   GET    /goals/:id                          — get single (+ progress rollup)
 *   POST   /goals/:id/refine                   — runs inlinePlan; returns plan + suggested tasks; does NOT persist
 *   POST   /goals/:id/tasks                    — bulk link {taskIds: string[]} or single link {taskId}
 *   DELETE /goals/:id/tasks/:taskId            — unlink one task
 *   GET    /goals/:id/progress                 — derived progress (total/done/blocked/inProgress/archived/percent)
 *   PATCH  /goals/:id                          — update (partial)
 *   DELETE /goals/:id                          — soft-archive
 *
 * Every mutation broadcasts a WS event so the dashboard updates
 * without polling:
 *   - goal:change        { goal }                  — create / update / archive
 *   - goal:tasks-linked  { goalId, taskIds, count } — linkTask / setTasks
 *   - goal:progress      { goalId, progress }       — after a task's status changes (server-side helper)
 *
 * Express ordering note: /goals/from-plan, /goals/:id/refine,
 * /goals/:id/tasks, /goals/:id/tasks/:taskId and /goals/:id/progress
 * MUST be registered before /goals/:id (the catch-all), else Express
 * captures the literal segments as the :id param.
 */
import { Router } from 'express';
import { goalsStore } from '../goals-store.mjs';
import { tasksStore } from '../tasks-store.mjs';
import { inlinePlan } from './goal-planner.mjs';
import { wrap } from './_shared.mjs';

/**
 * Resolve the projectId from query/body, throwing a 400 when absent.
 * The goals store REQUIRES per-project isolation; there is no global
 * fallback (unlike the legacy tasks file).
 */
function readProjectId(req) {
  const fromQuery = req.query && req.query.projectId;
  const fromBody = req.body && req.body.projectId;
  const id = (fromQuery || fromBody || '').toString().trim();
  if (!id) {
    const err = new Error('projectId is required');
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }
  return id;
}

/**
 * Convert a structured error (status/code/message) into a JSON
 * response. Used for the cycle-detected path so the client gets a
 * 400 with a meaningful message instead of a 500.
 */
function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'bad_request';
  return err;
}

/**
 * Run the goal-planner over `goalText` and return both the raw plan
 * AND a list of "suggested tasks" — one per step, with a friendly
 * title derived from the step subject. Used by both /refine (no
 * persist) and /from-plan (persist when `persist: true`).
 */
function planToSuggestedTasks(plan) {
  return (plan?.steps || []).map((step) => ({
    title: step.title || step.action || step.id,
    description: step.description || '',
    priority: step.estimatedCost >= 3 ? 'high' : (step.estimatedCost >= 2 ? 'normal' : 'low'),
    action: step.action,
    agent: step.agent,
    effects: step.effects || [],
    deps: step.deps || [],
    estimatedDurationMs: step.estimatedDurationMs,
  }));
}

/**
 * @param {object} deps
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createGoalsRouter({ broadcast = () => {} } = {}) {
  const router = Router();

  // ── /goals (literal) ────────────────────────────────────────────────────

  router.get('/goals', wrap(async (req, res) => {
    const projectId = readProjectId(req);
    const opts = {
      status: req.query.status || undefined,
      owner: req.query.owner !== undefined ? req.query.owner : undefined,
      parentGoalId: req.query.parentGoalId !== undefined ? req.query.parentGoalId : undefined,
      includeArchived: req.query.includeArchived === 'true' || req.query.includeArchived === '1',
    };
    const goals = goalsStore.list(projectId, opts);
    res.json({ projectId, goals });
  }));

  router.post('/goals', wrap(async (req, res) => {
    const projectId = readProjectId(req);
    const body = req.body || {};
    if (!body.title || !String(body.title).trim()) {
      throw badRequest('title is required');
    }
    const goal = await goalsStore.create(projectId, {
      title: body.title,
      description: body.description,
      status: body.status,
      priority: body.priority,
      owner: body.owner,
      targetDate: body.targetDate,
      parentGoalId: body.parentGoalId,
      tags: body.tags,
      metadata: body.metadata,
    });
    broadcast({ type: 'goal:change', goal });
    res.status(201).json(goal);
  }));

  // /goals/from-plan must come BEFORE /goals/:id.
  router.post('/goals/from-plan', wrap(async (req, res) => {
    const projectId = readProjectId(req);
    const body = req.body || {};
    const plan = body.plan;
    if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) {
      throw badRequest('plan with steps[] is required');
    }
    const persist = body.persist !== false; // default true

    const suggested = planToSuggestedTasks(plan);

    if (!persist) {
      // Ephemeral preview — return suggested tasks without creating
      // anything on disk. Matches the GoalPlanner.tsx preview path.
      res.json({ plan, suggestedTasks: suggested });
      return;
    }

    // Persist: create the Goal + one Task per step, then link them.
    const goal = await goalsStore.create(projectId, {
      title: body.title || (typeof plan.goal === 'string'
        ? plan.goal.slice(0, 200)
        : 'Plan'),
      description: body.description || (typeof plan.goal === 'string'
        ? `Auto-generated from a GOAP plan:\n\n${plan.goal}`
        : 'Auto-generated from a GOAP plan.'),
      priority: 'normal',
      tags: Array.isArray(body.tags) ? body.tags : ['plan-generated'],
      metadata: { aiSuggestions: plan },
    });

    const linkedTaskIds = [];
    for (const s of suggested) {
      try {
        const task = await tasksStore.create(projectId, {
          title: s.title,
          description: s.description,
          priority: s.priority,
          tags: ['goal-task', `goal:${goal.id}`, ...(s.effects || [])],
          goalId: goal.id,
        });
        linkedTaskIds.push(task.id);
      } catch {
        // Task create can fail on validation; we keep going so a
        // single bad step doesn't block the whole plan.
      }
    }

    broadcast({ type: 'goal:change', goal });
    broadcast({ type: 'goal:tasks-linked', goalId: goal.id, taskIds: linkedTaskIds, count: linkedTaskIds.length });
    broadcast({ type: 'goal:progress', goalId: goal.id, progress: goalsStore.progress(projectId, goal.id) });

    res.status(201).json({ goalId: goal.id, goal, linkedTaskIds, suggestedTasks: suggested });
  }));

  // ── /goals/:id/refine (must come before /goals/:id) ─────────────────────

  router.post('/goals/:id/refine', wrap(async (req, res) => {
    const projectId = readProjectId(req);
    const id = req.params.id;
    const goal = goalsStore.get(projectId, id);
    if (!goal) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const seed = (req.body && typeof req.body.text === 'string' && req.body.text.trim())
      ? req.body.text
      : `${goal.title}${goal.description ? ': ' + goal.description : ''}`;
    const plan = inlinePlan(seed);
    const suggested = planToSuggestedTasks(plan);
    // Attach the plan to the goal's metadata so the next /refine call
    // can diff; doesn't replace the user-supplied description.
    try {
      await goalsStore.update(projectId, id, {
        metadata: { aiSuggestions: plan },
      });
    } catch {
      // Metadata writes are advisory — don't fail the refine call.
    }
    broadcast({ type: 'goal:change', goal: goalsStore.get(projectId, id) });
    res.json({ plan, suggestedTasks: suggested });
  }));

  // ── /goals/:id/tasks (must come before /goals/:id) ──────────────────────

  router.post('/goals/:id/tasks', wrap(async (req, res) => {
    const projectId = readProjectId(req);
    const goalId = req.params.id;
    const goal = goalsStore.get(projectId, goalId);
    if (!goal) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const body = req.body || {};
    const taskIds = Array.isArray(body.taskIds)
      ? body.taskIds.map(String)
      : (body.taskId ? [String(body.taskId)] : []);
    if (taskIds.length === 0) {
      throw badRequest('taskIds (array) or taskId (string) is required');
    }

    // Validate every task exists in this project before mutating.
    const missing = [];
    for (const tid of taskIds) {
      const t = await tasksStore.getById(projectId, tid);
      if (!t) missing.push(tid);
    }
    if (missing.length > 0) {
      throw badRequest(`task(s) not found: ${missing.join(', ')}`);
    }

    if (Array.isArray(body.taskIds)) {
      const result = await goalsStore.setTasks(projectId, goalId, taskIds);
      // setTasks may have linked some, unlinked others. Re-link any
      // that the caller explicitly listed (in case they were already
      // on a different goal).
      for (const tid of taskIds) {
        await tasksStore.linkTaskToGoal(projectId, tid, goalId);
      }
      const all = tasksStore.getByGoalId(projectId, goalId);
      const finalIds = all.map((t) => t.id);
      broadcast({ type: 'goal:tasks-linked', goalId, taskIds: finalIds, count: finalIds.length });
      broadcast({ type: 'goal:progress', goalId, progress: goalsStore.progress(projectId, goalId) });
      res.json({ goalId, count: finalIds.length, taskIds: finalIds, linked: result.linked, unlinked: result.unlinked });
      return;
    }

    // Single-link path
    const updated = await goalsStore.linkTask(projectId, goalId, taskIds[0]);
    const all = tasksStore.getByGoalId(projectId, goalId);
    const finalIds = all.map((t) => t.id);
    broadcast({ type: 'goal:tasks-linked', goalId, taskIds: finalIds, count: finalIds.length });
    broadcast({ type: 'goal:progress', goalId, progress: goalsStore.progress(projectId, goalId) });
    res.json({ goalId, count: finalIds.length, taskIds: finalIds, task: updated });
  }));

  // /goals/:id/tasks/:taskId must come BEFORE /goals/:id but AFTER
  // /goals/:id/tasks. Express matches by registration order so this
  // position is correct.
  router.delete('/goals/:id/tasks/:taskId', wrap(async (req, res) => {
    const projectId = readProjectId(req);
    const goalId = req.params.id;
    const taskId = req.params.taskId;
    const goal = goalsStore.get(projectId, goalId);
    if (!goal) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const task = await tasksStore.getById(projectId, taskId);
    if (!task) {
      res.status(404).json({ error: 'task_not_found' });
      return;
    }
    if (task.goalId !== goalId) {
      res.status(409).json({ error: 'not_linked', message: 'task is not linked to this goal' });
      return;
    }
    await tasksStore.unlinkTaskFromGoal(projectId, taskId);
    broadcast({ type: 'goal:tasks-linked', goalId, taskIds: [], count: 0 });
    broadcast({ type: 'goal:progress', goalId, progress: goalsStore.progress(projectId, goalId) });
    res.json({ goalId, taskId, unlinked: true });
  }));

  // /goals/:id/progress must come BEFORE /goals/:id.
  router.get('/goals/:id/progress', wrap(async (req, res) => {
    const projectId = readProjectId(req);
    const goalId = req.params.id;
    const goal = goalsStore.get(projectId, goalId);
    if (!goal) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const progress = goalsStore.progress(projectId, goalId);
    res.json({ goalId, progress });
  }));

  // ── /goals/:id (catch-all GET / PATCH / DELETE) ──────────────────────────

  router.get('/goals/:id', wrap(async (req, res) => {
    const projectId = readProjectId(req);
    const goal = goalsStore.get(projectId, req.params.id);
    if (!goal) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const progress = goalsStore.progress(projectId, req.params.id);
    res.json({ goal, progress });
  }));

  router.patch('/goals/:id', wrap(async (req, res) => {
    const projectId = readProjectId(req);
    const body = req.body || {};
    try {
      const goal = await goalsStore.update(projectId, req.params.id, body);
      if (!goal) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      broadcast({ type: 'goal:change', goal });
      // Status flip to/from 'completed' changes the percent surface;
      // re-broadcast progress so cards refresh without a re-fetch.
      broadcast({ type: 'goal:progress', goalId: goal.id, progress: goalsStore.progress(projectId, goal.id) });
      res.json(goal);
    } catch (err) {
      if (err && err.message === 'cycle_detected') {
        res.status(400).json({ error: 'cycle_detected', message: 'parentGoalId would create a cycle' });
        return;
      }
      if (err && err.message === 'parent_goal_not_found') {
        res.status(400).json({ error: 'parent_goal_not_found', message: 'parentGoalId does not exist' });
        return;
      }
      throw err;
    }
  }));

  router.delete('/goals/:id', wrap(async (req, res) => {
    const projectId = readProjectId(req);
    const goal = await goalsStore.archive(projectId, req.params.id);
    if (!goal) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'goal:change', goal });
    res.status(204).end();
  }));

  return router;
}