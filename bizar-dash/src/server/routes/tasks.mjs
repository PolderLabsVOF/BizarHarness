/**
 * src/server/routes/tasks.mjs
 *
 * /api/tasks                              — list
 * /api/tasks (POST)                       — create
 * /api/tasks/submit (POST)                — Odin-style multi-task dispatch
 * /api/tasks/bulk (POST)                  — bulk action across ids
 * /api/tasks/:id (PUT)                    — update
 * /api/tasks/:id (DELETE)                 — delete
 * /api/tasks/:id/start (POST)             — trigger dispatch of a queued task
 * /api/tasks/:id/status (PATCH)           — move status (queued|doing|done|blocked|archived)
 * /api/tasks/:id/comments (POST)          — append comment
 * /api/tasks/:id/chat (GET)               — claude messages for the task's bg instance
 * /api/tasks/:id/artifacts (GET)          — list artifacts for this task
 * /api/tasks/:id/artifacts (POST)         — attach artifact + link to task
 * /api/tasks/:id/timer (POST)             — toggle timer
 * /api/tasks/:id/timer/start (POST)       — start timer
 * /api/tasks/:id/timer/stop (POST)        — stop timer
 * /api/tasks/:id/archive (POST)           — archive
 * /api/tasks/:id/unarchive (POST)         — unarchive
 * /api/tasks/:id/work (POST)              — agent claims progress
 * /api/tasks/:id/progress (POST)          — progress + current step update
 *
 * IMPORTANT — ordering matters for Express. /tasks/bulk and
 * /tasks/submit MUST be declared before /tasks/:id so that the
 * literal "bulk" / "submit" segments don't get captured by the
 * :id parameter. Same for /tasks/:id/start vs /tasks/:id (less of a
 * conflict since :id is followed by something either way).
 */
import { Router } from 'express';
import { tasksStore } from '../tasks-store.mjs';
import { agentsStore } from '../agents-store.mjs';
import { notificationsStore } from '../notifications-store.mjs';
import { projectsStore } from '../projects-store.mjs';
import { artifactsStore } from '../artifacts-store.mjs';
import {
  listClaudeMessages,
  normalizeClaudeMessage,
} from '../claude-info.mjs';
import { readActiveProjectId, wrap } from './_shared.mjs';
import { ALLOWED_TASK_STATUSES } from '../tasks-store.mjs';

/**
 * @param {object} deps
 * @param {object} deps.state
 * @param {Function} deps.broadcast
 * @param {string} deps.projectRoot
 * @returns {import('express').Router}
 */
export function createTasksRouter({ state, broadcast, projectRoot }) {
  const router = Router();

  // /tasks/submit must come BEFORE /tasks/:id so the literal segment
  // isn't captured by the :id param. The Odin task delegator splits
  // the input into subtasks and dispatches them to bg infrastructure.
  router.post('/tasks/submit', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const { taskDelegator } = await import('../task-delegator.mjs');
    try {
      const result = await taskDelegator.submit(req.body || {}, {
        projectRoot,
        projectId,
        state,
        broadcast,
      });
      // 207 Multi-Status when some dispatches failed — caller can decide
      // whether to retry. Pure success keeps 201.
      const partial = (result?.dispatch?.errors || []).length > 0;
      res.status(partial ? 207 : 201).json(result);
    } catch (err) {
      const status = err?.message?.includes('required') ? 400 : 500;
      res.status(status).json({
        error: status === 400 ? 'bad_request' : 'submission_failed',
        message: err?.message || String(err),
      });
    }
  }));

  router.get('/tasks', wrap(async (req, res) => {
    const projectId = req.query.projectId || readActiveProjectId();
    const includeArchived = req.query.archived === 'true' || req.query.archived === '1';
    const onlyArchived = req.query.archived === 'only' || req.query.archived === 'archived';
    res.json(tasksStore.loadTasks(projectId, { includeArchived, onlyArchived }));
  }));

  router.post('/tasks', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.create(projectId, req.body || {});
    broadcast({ type: 'tasks:change', task });
    res.status(201).json(task);
  }));

  router.put('/tasks/:id', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.update(projectId, req.params.id, req.body || {});
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  // v3.5.4 — Trigger execution of a queued task. Used by external
  // operators, tests, and the UI's "Retry dispatch" button. Reuses the
  // same dispatch logic as `/tasks/submit` so dispatch errors surface
  // in the same shape. Returns 400 when the task is not in `queued`
  // status, 404 when missing.
  router.post('/tasks/:id/start', wrap(async (req, res) => {
    const projectId = req.body?.projectId || req.query?.projectId || readActiveProjectId();
    const taskId = req.params.id;
    const task = await tasksStore.getById(projectId, taskId);
    if (!task) {
      res.status(404).json({ error: 'not_found', message: `task ${taskId} not found` });
      return;
    }
    if (task.status !== 'queued') {
      res.status(400).json({
        error: 'invalid_status',
        message: `task is '${task.status}', must be 'queued' to start`,
        task,
      });
      return;
    }
    const { taskDelegator } = await import('../task-delegator.mjs');
    const result = await taskDelegator.dispatchSingleTask(taskId, {
      projectRoot,
      projectId,
      state,
      broadcast,
    });
    if (!result.ok) {
      // Surface dispatch errors with 502 so callers know the task did
      // not actually start. `result.task` carries the refreshed state.
      const code = (result.errors || []).some((e) => e.kind === 'not_found') ? 404 : 502;
      res.status(code).json({
        error: 'dispatch_failed',
        message: (result.errors || []).map((e) => e.message).join('; ') || 'dispatch failed',
        task: result.task,
        errors: result.errors || [],
        warnings: result.warnings || [],
      });
      return;
    }
    res.status(202).json({
      ok: true,
      task: result.task,
      dispatched: result.dispatched,
      warnings: result.warnings || [],
    });
  }));

  router.patch('/tasks/:id/status', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const { status } = req.body || {};
    if (!ALLOWED_TASK_STATUSES.includes(status)) {
      res.status(400).json({ error: 'bad_request', message: 'invalid status' });
      return;
    }
    const task = await tasksStore.move(projectId, req.params.id, status);
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:change', task });
    if (status === 'done' && task.recurring) {
      const next = await tasksStore.spawnNextRecurrence(projectId, task);
      if (next) broadcast({ type: 'tasks:change', task: next });
    }
    // v3.3.0 — Fire a notification on completion. The Tasks view
    // already paints the badge in real time via tasks:change; the
    // notification is the cross-tab history bit.
    if (status === 'done') {
      try {
        notificationsStore.add({
          severity: 'success',
          source: 'tasks',
          title: 'Task completed',
          message: task.title || task.id,
          meta: { taskId: task.id },
        }, { broadcast });
      } catch { /* best-effort */ }
    } else if (status === 'blocked') {
      try {
        notificationsStore.add({
          severity: 'warning',
          source: 'tasks',
          title: 'Task blocked',
          message: task.title || task.id,
          meta: { taskId: task.id },
        }, { broadcast });
      } catch { /* best-effort */ }
    }
    res.json(task);
  }));

  router.post('/tasks/:id/comments', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.addComment(projectId, req.params.id, req.body?.text || '');
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  // v3.5.5 — Chat-task linkage. Given a task id, return the
  // Claude Code session's messages so the chat UI can open a
  // thread for an in-progress or completed task. The task must
  // have a `bgInstanceId` (or `sessionId`) in its metadata — the
  // delegator writes that when the Claude Code session is created.
  //
  // v6.3.0 — Reads from `~/.claude/sessions/<id>/messages.jsonl`
  // via `claude-info.listClaudeMessages()` instead of the old
  // cline serve HTTP endpoint. The 503 "plugin offline" path is
  // gone — Claude Code is just a CLI on PATH.
  //
  // Response shape:
  //   { taskId, bgInstanceId, sessionId, agent, messages: [{id,role,content,ts}, ...] }
  //
  // Status codes:
  //   200 — messages returned (may be empty)
  //   404 — task not found, or no bg instance / session id
  //   502 — claude listMessages call failed
  router.get('/tasks/:id/chat', wrap(async (req, res) => {
    const projectId = req.query.projectId || readActiveProjectId();
    const task = await tasksStore.getById(projectId, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'not_found', message: `task ${req.params.id} not found` });
      return;
    }
    const meta = task.metadata || {};
    let bgInstanceId = meta.bgInstanceId || meta.instanceId || null;
    let sessionId = meta.sessionId || null;
    let agent = meta.agent || task.assignee || null;

    // If we have a bgInstanceId but not a sessionId, look it up.
    if (bgInstanceId && !sessionId) {
      try {
        const { backgroundStore } = await import('../background-store.mjs');
        const bg = backgroundStore.get(bgInstanceId);
        if (bg) {
          sessionId = bg.sessionId || null;
          agent = agent || bg.agent || null;
        }
      } catch { /* best effort */ }
    }
    if (!bgInstanceId && !sessionId) {
      return res.status(404).json({
        error: 'no_bg_instance',
        message: 'task has no bg instance or claude session id',
        taskId: task.id,
      });
    }
    if (!sessionId) {
      return res.status(404).json({
        error: 'no_session',
        message: 'bg instance has no claude session id',
        taskId: task.id,
        bgInstanceId,
      });
    }

    const result = listClaudeMessages(sessionId);
    if (!result.ok) {
      return res.status(502).json({
        error: 'claude_error',
        message: result.error || 'listClaudeMessages failed',
        taskId: task.id,
        sessionId,
      });
    }
    const messages = Array.isArray(result.messages)
      ? result.messages.map(normalizeClaudeMessage)
      : [];
    res.json({
      taskId: task.id,
      bgInstanceId,
      sessionId,
      agent,
      messages,
    });
  }));

  // v3.5.5 — Per-task artifact endpoints. These live in tasks.mjs
  // (not artifacts.mjs) because the path parameter is the task id.
  // The standalone /api/artifacts/:id routes are in artifacts.mjs.
  router.get('/tasks/:id/artifacts', wrap(async (req, res) => {
    const items = artifactsStore.list({ taskId: req.params.id });
    res.json({ artifacts: items, taskId: req.params.id });
  }));

  router.post('/tasks/:id/artifacts', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const active = projectsStore.active();
    const { name, contentType, content } = req.body || {};
    if (typeof content !== 'string' || !content.length) {
      res.status(400).json({ error: 'content_required', message: 'content (string) is required' });
      return;
    }
    const meta = artifactsStore.save({
      taskId: req.params.id,
      projectId: projectId || (active ? active.id : null),
      name: name || `Artifact for ${req.params.id}`,
      contentType: contentType || 'text/html',
      content,
    });
    // Link the artifact back to the task. We do NOT overwrite
    // existing artifactId/artifactIds metadata; the new id is
    // appended to the array and the legacy `artifactId` field is
    // bumped to the latest.
    let updated = null;
    if (projectId) {
      const task = await tasksStore.getById(projectId, req.params.id);
      const prevMeta = (task && task.metadata) || {};
      const prevIds = Array.isArray(prevMeta.artifactIds) ? prevMeta.artifactIds : [];
      const newIds = prevIds.includes(meta.id) ? prevIds : [...prevIds, meta.id];
      updated = await tasksStore.update(projectId, req.params.id, {
        metadata: {
          artifactId: meta.id,
          artifactIds: newIds,
          artifactName: meta.name,
        },
      });
      if (updated) {
        broadcast({ type: 'tasks:change', task: updated });
      }
    }
    broadcast({ type: 'artifact:new', artifact: meta });
    res.status(201).json(meta);
  }));

  router.post('/tasks/:id/timer', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.toggleTimer(projectId, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  router.post('/tasks/:id/timer/start', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.startTimer(projectId, req.params.id);
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  router.post('/tasks/:id/timer/stop', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.stopTimer(projectId, req.params.id);
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  // v3.1.0 — Archive / unarchive / bulk.
  router.post('/tasks/:id/archive', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.archive(projectId, req.params.id);
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  router.post('/tasks/:id/unarchive', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.unarchive(projectId, req.params.id);
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  // /tasks/bulk MUST come before /tasks/:id so the literal segment
  // doesn't get captured as an id.
  router.post('/tasks/bulk', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const { ids, action, params } = req.body || {};
    if (!Array.isArray(ids)) {
      res.status(400).json({ error: 'bad_request', message: 'ids[] required' });
      return;
    }
    const out = await tasksStore.bulk(projectId, ids, action, params || {});
    for (const r of out.affected) {
      if (!r.ok) continue;
      if (action === 'delete') {
        broadcast({ type: 'tasks:delete', id: r.id });
      } else {
        const all = await tasksStore.loadTasks(projectId, { includeArchived: true });
        const t = all.find((x) => x.id === r.id);
        if (t) broadcast({ type: 'tasks:change', task: t });
      }
    }
    res.json(out);
  }));

  // v3.1.0 — Mark a task as worked-on by an agent. Bumps both sides.
  router.post('/tasks/:id/work', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const { agent, status, complete } = req.body || {};
    if (!agent) {
      res.status(400).json({ error: 'bad_request', message: 'agent is required' });
      return;
    }
    const task = await tasksStore.setWorkedBy(projectId, req.params.id, agent, { status, complete: !!complete });
    if (!task) { res.status(404).json({ error: 'not_found' }); return; }
    let agentSnapshot = null;
    if (status === 'doing') {
      agentSnapshot = agentsStore.updateStatus(agent, 'working', task.id);
    } else if (status === 'done' || complete) {
      agentSnapshot = agentsStore.recordTaskResult(agent, task.id, complete !== false);
    } else {
      agentSnapshot = agentsStore.updateStatus(agent, 'idle', null);
    }
    if (agentSnapshot) broadcast({ type: 'agent:status', agent: agentSnapshot });
    broadcast({ type: 'tasks:change', task });
    if (task.recurring && status === 'done') {
      const next = await tasksStore.spawnNextRecurrence(projectId, task);
      if (next) broadcast({ type: 'tasks:change', task: next });
    }
    res.json(task);
  }));

  router.delete('/tasks/:id', wrap(async (req, res) => {
    const projectId = req.query.projectId || readActiveProjectId();
    const ok = await tasksStore.delete(projectId, req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'tasks:delete', id: req.params.id });
    res.status(204).end();
  }));

  // v3.3.0 — Task progress updates from agents. Updates the in-store
  // metadata.progress + metadata.currentStep and broadcasts a WS
  // event so the Tasks view can paint the progress bar in real
  // time.
  router.post('/tasks/:id/progress', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const { progress, step, agent } = req.body || {};
    const task = await tasksStore.updateProgress(projectId, req.params.id, {
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
      step: typeof step === 'string' ? step.slice(0, 200) : null,
      agent: typeof agent === 'string' ? agent.slice(0, 60) : null,
    });
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    broadcast({ type: 'task:progress', taskId: task.id, progress: task.metadata?.progress, step: task.metadata?.currentStep, agent: task.metadata?.progressAgent });
    broadcast({ type: 'tasks:change', task });
    res.json(task);
  }));

  // v3.22 — Backlog routes. GET /tasks/backlog is declared before
  // /tasks/:id so the literal "backlog" segment is not captured as :id.
  router.get('/tasks/backlog', wrap(async (req, res) => {
    const projectId = req.query.projectId || readActiveProjectId();
    const tasks = tasksStore.listBacklog(projectId);
    res.json({ tasks });
  }));

  router.post('/tasks/:id/promote', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.getById(projectId, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (task.status !== 'backlog') {
      res.status(409).json({ error: 'not_backlog', message: `task is '${task.status}', must be 'backlog' to promote` });
      return;
    }
    const updated = await tasksStore.promote(projectId, req.params.id);
    broadcast({ type: 'tasks:change', task: updated });
    res.json({ ok: true, task: updated });
  }));

  router.post('/tasks/:id/demote', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const task = await tasksStore.getById(projectId, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (task.status !== 'queued') {
      res.status(409).json({ error: 'not_queued', message: `task is '${task.status}', must be 'queued' to demote` });
      return;
    }
    const updated = await tasksStore.demote(projectId, req.params.id);
    broadcast({ type: 'tasks:change', task: updated });
    res.json({ ok: true, task: updated });
  }));

  router.post('/tasks/promote-batch', wrap(async (req, res) => {
    const projectId = req.body?.projectId || readActiveProjectId();
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'bad_request', message: 'ids[] required' });
      return;
    }
    const result = await tasksStore.promoteBatch(projectId, ids);
    for (const r of result.affected) {
      if (!r.ok) continue;
      const all = await tasksStore.loadTasks(projectId, { includeArchived: false });
      const t = all.find((x) => x.id === r.id);
      if (t) broadcast({ type: 'tasks:change', task: t });
    }
    res.json(result);
  }));

  return router;
}