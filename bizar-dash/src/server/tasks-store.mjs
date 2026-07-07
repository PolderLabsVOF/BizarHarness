/**
 * src/server/tasks-store.mjs
 *
 * v3.0.0 — Per-project tasks with extended fields:
 *   assignee, parent, dependencies, timeSpent, recurring, attachments,
 *   comments, activity
 *
 * Storage: per-project `~/.config/cline/projects/<id>/tasks.json`
 *
 * Backward compat: if no active project is set, fall back to the legacy
 * global location (`~/.config/bizar/tasks.json`).
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { projectsStore } from './projects-store.mjs';

// v3.22 — Canonical status list. All status checks flow through this
// constant so a new status needs a change in only this one place.
export const ALLOWED_TASK_STATUSES = ['backlog', 'queued', 'doing', 'done', 'blocked', 'archived'];

const HOME = homedir();
const LEGACY_FILE = join(HOME, '.config', 'bizar', 'tasks.json');

// Atomic JSON write: serialize to a sibling temp file, then rename into
// place. `rename` is atomic on POSIX (same filesystem), so a crash
// between write and rename never leaves a half-written / corrupt file.
function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

let _busy = false;
const _waiters = [];

function acquire() {
  return new Promise((resolve) => {
    if (!_busy) {
      _busy = true;
      resolve();
    } else {
      _waiters.push({ resolve });
    }
  });
}

function release() {
  if (_waiters.length > 0) {
    _waiters.shift().resolve();
  } else {
    _busy = false;
  }
}

function safeReadJSON(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function genId() {
  return 'tsk_' + randomBytes(6).toString('hex').slice(0, 10);
}

function genShortId() {
  return randomBytes(4).toString('hex').slice(0, 8);
}

function resolveStorageFile(projectId) {
  if (projectId) {
    const dir = projectsStore.ensureProjectDir(projectId);
    return join(dir, 'tasks.json');
  }
  // legacy fallback
  return LEGACY_FILE;
}

function loadStore(file) {
  const raw = safeReadJSON(file, null);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) {
    return { version: 2, tasks: [] };
  }
  return raw;
}

function saveStore(file, store) {
  mkdirSync(dirname(file), { recursive: true });
  atomicWriteJson(file, store);
}

function appendActivity(task, type, data) {
  task.activity = task.activity || [];
  task.activity.push({
    id: 'act_' + genShortId(),
    type,
    ts: new Date().toISOString(),
    data: data || null,
  });
  if (task.activity.length > 100) task.activity = task.activity.slice(-100);
}

export const tasksStore = {
  /** Load tasks for a project (or legacy). */
  loadTasks(projectId, opts = {}) {
    const file = resolveStorageFile(projectId);
    const store = loadStore(file);
    const includeArchived = !!opts.includeArchived;
    const onlyArchived = !!opts.onlyArchived;
    let tasks = store.tasks.slice();
    if (onlyArchived) {
      tasks = tasks.filter((t) => t.archived);
    } else if (!includeArchived) {
      tasks = tasks.filter((t) => !t.archived);
    }
    return tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  /** Save all tasks. */
  saveTasks(projectId, tasks) {
    const file = resolveStorageFile(projectId);
    saveStore(file, { version: 2, tasks });
  },

  /**
   * v3.5.4 — Look up a single task by id. Returns null if the id does
   * not exist. Loads the full project file once; callers that need
   * many ids should batch via `loadTasks` + filter instead.
   */
  async getById(projectId, id) {
    if (!id) return null;
    const file = resolveStorageFile(projectId);
    const store = loadStore(file);
    const t = (store.tasks || []).find((x) => x && x.id === id);
    return t ? { ...t } : null;
  },

  /** Create a task. */
  async create(projectId, input) {
    if (!input || typeof input !== 'object') {
      throw new Error('task input required');
    }
    if (!input.title || typeof input.title !== 'string' || input.title.length > 200) {
      throw new Error('title required (1-200 chars)');
    }
    await acquire();
    try {
      const file = resolveStorageFile(projectId);
      const store = loadStore(file);
      const now = new Date().toISOString();
      const task = {
        id: genId(),
        title: input.title,
        description: input.description || '',
        status: ALLOWED_TASK_STATUSES.includes(input.status) ? input.status : 'queued',
        tags: Array.isArray(input.tags) ? input.tags : [],
        priority: ['low', 'normal', 'high'].includes(input.priority) ? input.priority : 'normal',
        assignee: input.assignee || null,
        parent: input.parent || null,
        dependencies: Array.isArray(input.dependencies) ? input.dependencies : [],
        timeSpent: 0,
        recurring: input.recurring || null,
        attachments: Array.isArray(input.attachments) ? input.attachments : [],
        comments: [],
        activity: [],
        archived: false,
        workedBy: null,
        dueDate: typeof input.dueDate === 'string' ? input.dueDate : null,
        // v3.2.0 — fields for the task delegator.
        subtasks: Array.isArray(input.subtasks) ? input.subtasks : undefined,
        metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : undefined,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      appendActivity(task, 'created', { priority: task.priority });
      store.tasks.push(task);
      saveStore(file, store);
      return task;
    } finally {
      release();
    }
  },

  /** Update a task. */
  async update(projectId, id, patch) {
    await acquire();
    try {
      const file = resolveStorageFile(projectId);
      const store = loadStore(file);
      const idx = store.tasks.findIndex((t) => t.id === id);
      if (idx === -1) return null;
      const task = { ...store.tasks[idx] };

      if (typeof patch.title === 'string') task.title = patch.title.slice(0, 200);
      if (typeof patch.description === 'string') task.description = patch.description;
      if (ALLOWED_TASK_STATUSES.includes(patch.status)) {
        if (patch.status !== task.status) {
          appendActivity(task, 'status', { from: task.status, to: patch.status });
        }
        task.status = patch.status;
      }
      if (Array.isArray(patch.tags)) task.tags = patch.tags;
      if (['low', 'normal', 'high'].includes(patch.priority)) {
        task.priority = patch.priority;
      }
      if (typeof patch.assignee === 'string' || patch.assignee === null) {
        task.assignee = patch.assignee;
      }
      if (typeof patch.parent === 'string' || patch.parent === null) {
        task.parent = patch.parent;
      }
      if (Array.isArray(patch.dependencies)) task.dependencies = patch.dependencies;
      if (typeof patch.timeSpent === 'number' && Number.isFinite(patch.timeSpent)) {
        task.timeSpent = Math.max(0, patch.timeSpent);
      }
      if (patch.recurring === null || typeof patch.recurring === 'object') {
        task.recurring = patch.recurring;
      }
      if (Array.isArray(patch.attachments)) task.attachments = patch.attachments;
      if (patch.archived === true) task.archived = true;
      if (patch.archived === false) task.archived = false;
      if (typeof patch.workedBy === 'string' || patch.workedBy === null) {
        task.workedBy = patch.workedBy;
      }
      if (typeof patch.dueDate === 'string' || patch.dueDate === null) {
        task.dueDate = patch.dueDate || null;
      }
      // v3.2.0 — generic metadata bag (used by task-delegator to
      // record bg instance IDs, dispatch timestamps, etc.).
      if (patch.metadata && typeof patch.metadata === 'object') {
        task.metadata = { ...(task.metadata || {}), ...patch.metadata };
      }
      // v3.2.0 — main tasks track their subtask ids.
      if (Array.isArray(patch.subtasks)) {
        task.subtasks = patch.subtasks.map(String);
      }

      task.updatedAt = new Date().toISOString();
      if (task.status === 'done' && !task.completedAt) {
        task.completedAt = task.updatedAt;
        appendActivity(task, 'completed', null);
      } else if (task.status !== 'done') {
        task.completedAt = null;
      }

      store.tasks[idx] = task;
      saveStore(file, store);
      return task;
    } finally {
      release();
    }
  },

  async delete(projectId, id) {
    await acquire();
    try {
      const file = resolveStorageFile(projectId);
      const store = loadStore(file);
      const before = store.tasks.length;
      store.tasks = store.tasks.filter((t) => t.id !== id);
      if (store.tasks.length === before) return false;
      saveStore(file, store);
      return true;
    } finally {
      release();
    }
  },

  async move(projectId, id, newStatus) {
    return this.update(projectId, id, { status: newStatus });
  },

  /**
   * v3.3.0 — Update progress for a task. Used by agents to push
   * real-time status. Patches metadata.progress (0-100) and
   * metadata.currentStep (string). Also appends a row to
   * metadata.progressHistory for the timeline view.
   */
  async updateProgress(projectId, id, { progress, step, agent } = {}) {
    await acquire();
    try {
      const file = resolveStorageFile(projectId);
      const store = loadStore(file);
      const idx = store.tasks.findIndex((t) => t.id === id);
      if (idx === -1) return null;
      const task = { ...store.tasks[idx] };
      const meta = { ...(task.metadata || {}) };
      const clamped = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
      meta.progress = clamped;
      if (typeof step === 'string') meta.currentStep = step;
      if (typeof agent === 'string') meta.progressAgent = agent;
      if (!Array.isArray(meta.progressHistory)) meta.progressHistory = [];
      meta.progressHistory.push({ ts: new Date().toISOString(), progress: clamped, step: step || null, agent: agent || null });
      // Hard-cap the history length to avoid unbounded growth.
      if (meta.progressHistory.length > 100) {
        meta.progressHistory = meta.progressHistory.slice(-100);
      }
      meta.startedAt = meta.startedAt || new Date().toISOString();
      task.metadata = meta;
      task.updatedAt = new Date().toISOString();
      appendActivity(task, 'progress', { progress: clamped, step: step || null, agent: agent || null });
      store.tasks[idx] = task;
      saveStore(file, store);
      return task;
    } finally {
      release();
    }
  },

  /** Add a comment to a task. */
  async addComment(projectId, id, text) {
    if (!text || typeof text !== 'string') throw new Error('comment text required');
    await acquire();
    try {
      const file = resolveStorageFile(projectId);
      const store = loadStore(file);
      const task = store.tasks.find((t) => t.id === id);
      if (!task) return null;
      task.comments = task.comments || [];
      const comment = {
        id: 'cmt_' + genShortId(),
        text: text.slice(0, 4000),
        createdAt: new Date().toISOString(),
      };
      task.comments.push(comment);
      appendActivity(task, 'comment', { commentId: comment.id });
      task.updatedAt = new Date().toISOString();
      saveStore(file, store);
      return task;
    } finally {
      release();
    }
  },

  /** Toggle the time-tracking timer. Returns the task. */
  async toggleTimer(projectId, id) {
    await acquire();
    try {
      const file = resolveStorageFile(projectId);
      const store = loadStore(file);
      const task = store.tasks.find((t) => t.id === id);
      if (!task) return null;
      const now = Date.now();
      if (task._timerStart) {
        const elapsed = Math.floor((now - task._timerStart) / 1000);
        task.timeSpent = (task.timeSpent || 0) + elapsed;
        appendActivity(task, 'timer-stop', { elapsed });
        delete task._timerStart;
      } else {
        task._timerStart = now;
        appendActivity(task, 'timer-start', null);
      }
      task.updatedAt = new Date().toISOString();
      saveStore(file, store);
      return task;
    } finally {
      release();
    }
  },

  // v3.1.0 ─────────────────────────────────────────────────────────
  /** Start the timer for a task (idempotent). */
  async startTimer(projectId, id) {
    await acquire();
    try {
      const file = resolveStorageFile(projectId);
      const store = loadStore(file);
      const task = store.tasks.find((t) => t.id === id);
      if (!task) return null;
      if (!task._timerStart) {
        task._timerStart = Date.now();
        appendActivity(task, 'timer-start', null);
        task.updatedAt = new Date().toISOString();
        saveStore(file, store);
      }
      return task;
    } finally {
      release();
    }
  },

  /** Stop the timer for a task. */
  async stopTimer(projectId, id) {
    await acquire();
    try {
      const file = resolveStorageFile(projectId);
      const store = loadStore(file);
      const task = store.tasks.find((t) => t.id === id);
      if (!task) return null;
      if (task._timerStart) {
        const elapsed = Math.floor((Date.now() - task._timerStart) / 1000);
        task.timeSpent = (task.timeSpent || 0) + elapsed;
        appendActivity(task, 'timer-stop', { elapsed });
        delete task._timerStart;
        task.updatedAt = new Date().toISOString();
        saveStore(file, store);
      }
      return task;
    } finally {
      release();
    }
  },

  /** Archive a task (keeps it in the store; the UI hides it by default). */
  async archive(projectId, id) {
    return this.update(projectId, id, { archived: true, status: 'archived' });
  },

  /** Unarchive — restore to the prior status (queued) by default. */
  async unarchive(projectId, id) {
    return this.update(projectId, id, { archived: false, status: 'queued' });
  },

  /**
   * Bulk action over a set of task ids. Actions: 'archive' | 'unarchive' |
   * 'delete' | 'move' | 'tag' | 'assign' | 'priority'.
   * Returns { affected: [{ id, ok, error? }, ...] }.
   */
  async bulk(projectId, ids, action, params = {}) {
    const out = [];
    if (!Array.isArray(ids) || ids.length === 0) {
      return { affected: out, action, params };
    }
    for (const id of ids) {
      try {
        let result = null;
        if (action === 'archive') result = await this.archive(projectId, id);
        else if (action === 'unarchive') result = await this.unarchive(projectId, id);
        else if (action === 'delete') {
          const ok = await this.delete(projectId, id);
          result = ok ? { id, deleted: true } : null;
        } else if (action === 'move') {
          result = await this.move(projectId, id, params.status);
        } else if (action === 'priority') {
          result = await this.update(projectId, id, { priority: params.priority });
        } else if (action === 'assign') {
          result = await this.update(projectId, id, { assignee: params.assignee });
        } else if (action === 'tag') {
          const t = await this.update(projectId, id, { tags: Array.isArray(params.tags) ? params.tags : [] });
          result = t;
        } else {
          out.push({ id, ok: false, error: `unknown action: ${action}` });
          continue;
        }
        out.push({ id, ok: !!result });
      } catch (err) {
        out.push({ id, ok: false, error: err.message });
      }
    }
    return { affected: out, action, params };
  },

  /**
   * Mark a task as "worked on" by an agent. The dashboard listens for
   * this on the WS and updates the agent's status accordingly. If the
   * task is recurring, completing it spawns the next occurrence when
   * `complete=true`.
   */
  async setWorkedBy(projectId, id, agentName, opts = {}) {
    const updated = await this.update(projectId, id, { workedBy: agentName });
    if (!updated) return null;
    if (opts.status) {
      const moved = await this.move(projectId, id, opts.status);
      if (moved?.recurring && opts.status === 'done' && opts.complete) {
        await this.spawnNextRecurrence(projectId, moved);
      }
      return moved;
    }
    return updated;
  },

  /** Create the next occurrence of a recurring task. */
  async spawnNextRecurrence(projectId, task) {
    if (!task.recurring) return null;
    const now = new Date().toISOString();
    const next = {
      title: task.title,
      description: task.description || '',
      status: 'queued',
      priority: task.priority || 'normal',
      assignee: task.assignee || null,
      tags: task.tags || [],
      recurring: task.recurring,
      parent: task.id,
    };
    const created = await this.create(projectId, next);
    if (created && task.recurring) {
      // Persist lastGenerated on the original task.
      task.recurring = { ...task.recurring, lastGenerated: now };
      await acquire();
      try {
        const file = resolveStorageFile(projectId);
        const store = loadStore(file);
        const idx = store.tasks.findIndex((t) => t.id === task.id);
        if (idx >= 0) {
          store.tasks[idx] = task;
          saveStore(file, store);
        }
      } finally {
        release();
      }
    }
    return created;
  },

  // v3.22 — Backlog helpers. Tasks in `backlog` are parked; Odin
  // promotes them to `queued` via tickBacklog when slots are free.

  /**
   * List all backlog tasks for a project.
   * @returns {Task[]}
   */
  listBacklog(projectId) {
    return this.loadTasks(projectId).filter((t) => t.status === 'backlog' && !t.archived);
  },

  /**
   * Promote a single backlog task to queued.
   * @returns {Task | null}
   */
  async promote(projectId, id) {
    return this.update(projectId, id, { status: 'queued' });
  },

  /**
   * Demote a queued task back to backlog.
   * @returns {Task | null}
   */
  async demote(projectId, id) {
    return this.update(projectId, id, { status: 'backlog' });
  },

  /**
   * Bulk-promote multiple backlog tasks to queued.
   * @returns {{ affected: object[] }}
   */
  async promoteBatch(projectId, ids) {
    const affected = [];
    for (const id of ids) {
      try {
        const t = await this.update(projectId, id, { status: 'queued' });
        affected.push({ id, ok: !!t });
      } catch (err) {
        affected.push({ id, ok: false, error: err.message });
      }
    }
    return { affected };
  },
};
