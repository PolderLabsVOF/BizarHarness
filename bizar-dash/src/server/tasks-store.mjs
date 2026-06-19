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
  loadTasks(projectId) {
    const file = resolveStorageFile(projectId);
    const store = loadStore(file);
    return store.tasks
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
        status: ['queued', 'doing', 'done'].includes(input.status) ? input.status : 'queued',
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
      if (['queued', 'doing', 'done'].includes(patch.status)) {
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
};
