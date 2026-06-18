/**
 * cli/dashboard/tasks-store.mjs
 *
 * Per-user task storage at ~/.config/bizar/tasks.json.
 * In-process mutex (single-lock) to handle concurrent reads/writes.
 *
 * File format:
 * {
 *   "version": 1,
 *   "tasks": [ ...task objects... ]
 * }
 *
 * Task object:
 * {
 *   "id": "tsk_<8 base36 chars>",
 *   "title": "string",
 *   "description": "markdown string",
 *   "status": "queued" | "doing" | "done",
 *   "tags": ["string"],
 *   "priority": "low" | "normal" | "high",
 *   "createdAt": "ISO timestamp",
 *   "updatedAt": "ISO timestamp",
 *   "completedAt": "ISO timestamp | null
 * }
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const HOME = homedir();
const TASKS_FILE = `${HOME}/.config/bizar/tasks.json`;
const TASKS_DIR = `${HOME}/.config/bizar`;

// ── mutex ───────────────────────────────────────────────────────────────────

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
    const next = _waiters.shift();
    next.resolve();
  } else {
    _busy = false;
  }
}

// ── file helpers ─────────────────────────────────────────────────────────────

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

function loadStore() {
  const raw = safeReadJSON(TASKS_FILE, null);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks)) {
    return { version: 1, tasks: [] };
  }
  return raw;
}

function saveStore(store) {
  mkdirSync(TASKS_DIR, { recursive: true });
  writeFileSync(TASKS_FILE, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

// ── ID generation ────────────────────────────────────────────────────────────

function genId() {
  // Use hex encoding (universally supported) and take first 8 chars
  return 'tsk_' + randomBytes(8).toString('hex').slice(0, 8);
}

// ── public API ───────────────────────────────────────────────────────────────

/** Returns all tasks, newest first. */
export function loadTasks() {
  const store = loadStore();
  return store.tasks.slice().sort((a, b) => {
    // newest first
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

/** Persists the full tasks array. Call after any mutation. */
export function saveTasks(tasks) {
  saveStore({ version: 1, tasks });
}

/**
 * Create a new task.
 * @param {{ title, description?, status?, tags?, priority? }} opts
 * @returns the created task object
 */
export async function createTask({ title, description = '', status = 'queued', tags = [], priority = 'normal' }) {
  await acquire();
  try {
    const store = loadStore();
    const now = new Date().toISOString();
    const task = {
      id: genId(),
      title,
      description,
      status,
      tags: Array.isArray(tags) ? tags : [],
      priority: ['low', 'normal', 'high'].includes(priority) ? priority : 'normal',
      createdAt: now,
      updatedAt: now,
      completedAt: status === 'done' ? now : null,
    };
    store.tasks.push(task);
    saveStore(store);
    return task;
  } finally {
    release();
  }
}

/**
 * Partially update a task by id.
 * @param {string} id
 * @param {object} patch - partial task fields
 * @returns the updated task or null if not found
 */
export async function updateTask(id, patch = {}) {
  await acquire();
  try {
    const store = loadStore();
    const idx = store.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const task = { ...store.tasks[idx] };

    // Apply allowed fields
    if (typeof patch.title === 'string') task.title = patch.title.slice(0, 200);
    if (typeof patch.description === 'string') task.description = patch.description;
    if (typeof patch.status === 'string' && ['queued', 'doing', 'done'].includes(patch.status)) {
      task.status = patch.status;
    }
    if (Array.isArray(patch.tags)) task.tags = patch.tags;
    if (['low', 'normal', 'high'].includes(patch.priority)) task.priority = patch.priority;

    task.updatedAt = new Date().toISOString();
    if (task.status === 'done' && !task.completedAt) {
      task.completedAt = task.updatedAt;
    } else if (task.status !== 'done') {
      task.completedAt = null;
    }

    store.tasks[idx] = task;
    saveStore(store);
    return task;
  } finally {
    release();
  }
}

/**
 * Delete a task by id.
 * @param {string} id
 * @returns true if deleted, false if not found
 */
export async function deleteTask(id) {
  await acquire();
  try {
    const store = loadStore();
    const idx = store.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    store.tasks.splice(idx, 1);
    saveStore(store);
    return true;
  } finally {
    release();
  }
}

/**
 * Move a task to a new status column.
 * @param {string} id
 * @param {'queued'|'doing'|'done'} newStatus
 * @returns the updated task or null if not found
 */
export async function moveTask(id, newStatus) {
  return updateTask(id, { status: newStatus });
}
