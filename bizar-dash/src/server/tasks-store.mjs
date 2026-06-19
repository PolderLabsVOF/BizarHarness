/**
 * src/server/tasks-store.mjs
 *
 * v3.0.0 — Per-project tasks with extended fields:
 *   assignee, parent, dependencies, timeSpent, recurring, attachments,
 *   comments, activity
 *
 * Storage: per-project `~/.config/opencode/projects/<id>/tasks.json`
 *
 * Backward compat: if no active project is set, fall back to the legacy
 * global location (`~/.config/bizar/tasks.json`).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { projectsStore } from './projects-store.mjs';

const HOME = homedir();
const LEGACY_FILE = join(HOME, '.config', 'bizar', 'tasks.json');

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
  writeFileSync(file, JSON.stringify(store, null, 2) + '\n', 'utf8');
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
        status: ['queued', 'doing', 'done', 'blocked', 'archived'].includes(input.status) ? input.status : 'queued',
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
      if (['queued', 'doing', 'done', 'blocked', 'archived'].includes(patch.status)) {
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
};
