/**
 * src/server/goals-store.mjs
 *
 * v6.6.0 — F-041 (Per-Project Goals & Tasks Board).
 *
 * Persistent Goal entity store. Each project gets its own goals
 * file at `~/.config/cline/projects/<id>/goals.json` (same per-
 * project isolation convention as tasks-store.mjs).
 *
 * Goal shape:
 *   {
 *     id, title, description, status, priority, owner, targetDate,
 *     createdAt, updatedAt, completedAt, parentGoalId, tags,
 *     metadata: { aiSuggestions?: Plan }
 *   }
 *
 * The Goal↔Task linkage is stored on the task (`task.goalId`) — the
 * goals-store mutates that field via tasks-store.linkTaskToGoal so
 * the two stores stay symmetric without duplicating state. Live
 * progress counts read the task set on every call (cheap; one file
 * read per goal).
 *
 * Atomic writes: same tmp+rename pattern as tasks-store.mjs.
 * Concurrency: a single module-level acquire/release lock serialises
 * every CRUD call so two concurrent linkTask calls can't tear the
 * file.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { projectsStore } from './projects-store.mjs';
import { tasksStore } from './tasks-store.mjs';
import { timelineStore } from './timeline-store.mjs';

// v6.6.0 — Canonical status / priority enums. Status mirrors the
// task store's `status` shape (`archived` included so the soft-archive
// path is symmetric with tasks).
export const ALLOWED_GOAL_STATUSES = ['active', 'completed', 'archived'];
export const ALLOWED_GOAL_PRIORITIES = ['low', 'normal', 'high'];

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

function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
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
  return 'goal_' + randomBytes(6).toString('hex').slice(0, 10);
}

function resolveStorageFile(projectId) {
  if (!projectId) {
    throw new Error('projectId is required');
  }
  const dir = projectsStore.ensureProjectDir(projectId);
  return join(dir, 'goals.json');
}

function loadStore(file) {
  const raw = safeReadJSON(file, null);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.goals)) {
    return { version: 1, goals: [] };
  }
  // Defensive: each goal must have an id and status, otherwise the
  // store would crash on list(). Fill in sensible defaults rather
  // than dropping the entry silently.
  for (const g of raw.goals) {
    if (!g.id) g.id = genId();
    if (!g.status) g.status = 'active';
  }
  return raw;
}

function saveStore(file, store) {
  mkdirSync(dirname(file), { recursive: true });
  atomicWriteJson(file, store);
}

/**
 * Walk the parentGoalId chain from `goalId` upward. If we encounter
 * `newParentGoalId` before exhausting the chain, we'd create a cycle.
 * Caller should pass the current parent so a self-link (parent === id)
 * also gets flagged.
 */
function chainHasCycle(store, goalId, newParentGoalId, visited) {
  if (!newParentGoalId) return false;
  if (newParentGoalId === goalId) return true;
  if (visited.has(newParentGoalId)) return true;
  visited.add(newParentGoalId);
  const next = store.goals.find((g) => g.id === newParentGoalId);
  if (!next) return false;
  return chainHasCycle(store, goalId, next.parentGoalId, visited);
}

/**
 * Format a Date for an ISO timestamp. Null/undefined → null.
 */
function iso(d) {
  if (!d) return null;
  try {
    return new Date(d).toISOString();
  } catch {
    return null;
  }
}

/**
 * v6.6.0 — F-042 timeline aggregator. Best-effort append a goal
 * change into the timeline ring. Swallow-safe; a timeline-store
 * failure must never block a goal mutation.
 */
function pushGoalEvent(projectId, goal, action, extra) {
  try {
    const ev = timelineStore._testFromGoalChange(
      { ...goal, projectId: projectId || null },
      action,
      extra || {},
    );
    if (ev) timelineStore.appendEvent(ev);
  } catch {
    /* swallow */
  }
}

/**
 * Lookup helper used by linkTask / unlinkTask to fetch the live goal
 * (so the timeline event carries fresh metadata). Returns null when
 * the goal is gone — callers should silently skip the timeline event
 * in that case.
 */
function storeOrNull(projectId, goalId) {
  try {
    const file = resolveStorageFile(projectId);
    const store = loadStore(file);
    const g = (store.goals || []).find((x) => x && x.id === goalId);
    return g ? { ...g } : null;
  } catch {
    return null;
  }
}

export const goalsStore = {
  ALLOWED_STATUSES: ALLOWED_GOAL_STATUSES,
  ALLOWED_PRIORITIES: ALLOWED_GOAL_PRIORITIES,

  /** Load all goals for a project. */
  loadGoals(projectId, opts = {}) {
    const file = resolveStorageFile(projectId);
    const store = loadStore(file);
    const includeArchived = !!opts.includeArchived;
    let goals = store.goals.slice();
    if (!includeArchived) {
      goals = goals.filter((g) => g.status !== 'archived');
    }
    return goals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  /** List with status / owner / parentGoalId filters. */
  list(projectId, opts = {}) {
    // When the caller is applying any filter we default to including
    // archived rows so the filter is the only thing constraining the
    // result. Without this, listing `parentGoalId: null` would miss
    // archived sub-goals whose parent was unset.
    const hasFilter = opts.status !== undefined
      || opts.owner !== undefined
      || opts.parentGoalId !== undefined;
    const includeArchived = opts.includeArchived || hasFilter;
    let goals = this.loadGoals(projectId, { includeArchived });
    if (opts.status) {
      goals = goals.filter((g) => g.status === opts.status);
    }
    if (opts.owner !== undefined) {
      const owner = opts.owner;
      goals = goals.filter((g) => (g.owner || null) === (owner || null));
    }
    if (opts.parentGoalId !== undefined) {
      const pid = opts.parentGoalId;
      goals = goals.filter((g) => (g.parentGoalId || null) === (pid || null));
    }
    return goals;
  },

  /** Get a single goal by id. Returns null if missing. */
  get(projectId, id) {
    if (!id) return null;
    const all = this.loadGoals(projectId, { includeArchived: true });
    return all.find((g) => g.id === id) || null;
  },

  /** Create a goal. */
  async create(projectId, input) {
    if (!projectId) throw new Error('projectId is required');
    if (!input || typeof input !== 'object') {
      throw new Error('goal input required');
    }
    if (!input.title || typeof input.title !== 'string' || input.title.length > 200) {
      throw new Error('title required (1-200 chars)');
    }
    await acquire();
    try {
      const file = resolveStorageFile(projectId);
      const store = loadStore(file);
      const now = new Date().toISOString();
      const status = ALLOWED_GOAL_STATUSES.includes(input.status) ? input.status : 'active';
      const priority = ALLOWED_GOAL_PRIORITIES.includes(input.priority) ? input.priority : 'normal';
      const goal = {
        id: genId(),
        title: input.title.slice(0, 200),
        description: typeof input.description === 'string' ? input.description : '',
        status,
        priority,
        owner: typeof input.owner === 'string' ? input.owner : null,
        targetDate: iso(input.targetDate),
        parentGoalId: typeof input.parentGoalId === 'string' ? input.parentGoalId : null,
        tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
        metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : null,
        createdAt: now,
        updatedAt: now,
        completedAt: status === 'completed' ? now : null,
      };
      if (goal.parentGoalId) {
        // Parent must exist; if it doesn't we drop the reference
        // (rather than erroring on create) so a UI bug can't wedge the
        // store.
        if (!store.goals.find((g) => g.id === goal.parentGoalId)) {
          goal.parentGoalId = null;
        }
      }
      store.goals.push(goal);
      saveStore(file, store);
      pushGoalEvent(projectId, goal, 'create');
      return goal;
    } finally {
      release();
    }
  },

  /**
   * Patch a goal. Validates parentGoalId against cycle rules; throws
   * Error('cycle_detected') when the new parent chain reaches back to
   * the goal itself. Returns the updated goal or null when missing.
   */
  async update(projectId, id, patch) {
    if (!projectId) throw new Error('projectId is required');
    await acquire();
    try {
      const file = resolveStorageFile(projectId);
      const store = loadStore(file);
      const idx = store.goals.findIndex((g) => g.id === id);
      if (idx === -1) return null;
      const goal = { ...store.goals[idx] };
      const prevStatus = goal.status;

      if (typeof patch.title === 'string') {
        const t = patch.title.trim();
        if (!t) throw new Error('title cannot be empty');
        goal.title = t.slice(0, 200);
      }
      if (typeof patch.description === 'string') {
        goal.description = patch.description;
      }
      if (ALLOWED_GOAL_STATUSES.includes(patch.status)) {
        if (patch.status !== goal.status) {
          if (patch.status === 'completed') goal.completedAt = new Date().toISOString();
          if (patch.status === 'active') goal.completedAt = null;
        }
        goal.status = patch.status;
      }
      if (ALLOWED_GOAL_PRIORITIES.includes(patch.priority)) {
        goal.priority = patch.priority;
      }
      if (typeof patch.owner === 'string' || patch.owner === null) {
        goal.owner = patch.owner;
      }
      if (patch.targetDate !== undefined) {
        goal.targetDate = iso(patch.targetDate);
      }
      if (patch.parentGoalId !== undefined) {
        const newParent = patch.parentGoalId || null;
        if (newParent && !store.goals.find((g) => g.id === newParent)) {
          throw new Error('parent_goal_not_found');
        }
        if (newParent && chainHasCycle(store, id, newParent, new Set([id]))) {
          throw new Error('cycle_detected');
        }
        goal.parentGoalId = newParent;
      }
      if (Array.isArray(patch.tags)) {
        goal.tags = patch.tags.map(String);
      }
      if (patch.metadata && typeof patch.metadata === 'object') {
        goal.metadata = { ...(goal.metadata || {}), ...patch.metadata };
      }

      goal.updatedAt = new Date().toISOString();
      store.goals[idx] = goal;
      saveStore(file, store);
      // Pick the most specific action for the timeline.
      if (prevStatus !== 'archived' && goal.status === 'archived') {
        pushGoalEvent(projectId, goal, 'archive');
      } else if (prevStatus !== 'completed' && goal.status === 'completed') {
        pushGoalEvent(projectId, goal, 'complete');
      } else {
        pushGoalEvent(projectId, goal, 'update');
      }
      return goal;
    } finally {
      release();
    }
  },

  /** Soft-archive: sets status=archived. The row stays in the file. */
  async archive(projectId, id) {
    return this.update(projectId, id, { status: 'archived' });
  },

  /**
   * Link a single task to this goal. Delegates to
   * tasksStore.linkTaskToGoal which appends a `goal-link` activity
   * row when the link actually changes.
   */
  async linkTask(projectId, goalId, taskId) {
    const updated = await tasksStore.linkTaskToGoal(projectId, taskId, goalId);
    if (updated) {
      const goal = storeOrNull(projectId, goalId);
      if (goal) pushGoalEvent(projectId, goal, 'link-task', { detail: `task=${taskId}` });
    }
    return updated;
  },

  /**
   * Unlink a single task from this goal. No-op (returns null) when
   * the task id doesn't exist.
   */
  async unlinkTask(projectId, goalId, taskId) {
    // We don't require goalId equality here — the caller passes the
    // goal they intend to unlink from, but the task's own goalId is
    // the source of truth.
    const updated = await tasksStore.unlinkTaskFromGoal(projectId, taskId);
    if (updated) {
      const goal = storeOrNull(projectId, goalId);
      if (goal) pushGoalEvent(projectId, goal, 'unlink-task', { detail: `task=${taskId}` });
    }
    return updated;
  },

  /**
   * Set the goal's task set to EXACTLY `taskIds`. Tasks that were
   * previously linked but aren't in the new set get unlinked;
   * tasks that aren't currently linked get linked. Returns
   * `{ linked: number, unlinked: number }`.
   */
  async setTasks(projectId, goalId, taskIds) {
    if (!Array.isArray(taskIds)) {
      throw new Error('taskIds must be an array');
    }
    const all = tasksStore.loadTasks(projectId, { includeArchived: true });
    const target = new Set(taskIds);
    let linked = 0;
    let unlinked = 0;
    for (const t of all) {
      const currentlyLinked = t.goalId === goalId;
      const shouldBeLinked = target.has(t.id);
      if (currentlyLinked && !shouldBeLinked) {
        await tasksStore.unlinkTaskFromGoal(projectId, t.id);
        unlinked += 1;
      } else if (!currentlyLinked && shouldBeLinked) {
        await tasksStore.linkTaskToGoal(projectId, t.id, goalId);
        linked += 1;
      }
    }
    return { linked, unlinked };
  },

  /**
   * Compute live progress for a goal by reading its linked tasks
   * from the tasks store. The `total` field excludes archived tasks
   * so a 100%-done goal doesn't suddenly read 0% when the user
   * archives the last done task.
   *
   * @returns {{
   *   total: number,
   *   done: number,
   *   blocked: number,
   *   inProgress: number,
   *   archived: number,
   *   percent: number,
   * }}
   */
  progress(projectId, goalId) {
    const tasks = tasksStore.getByGoalId(projectId, goalId);
    let total = 0;
    let done = 0;
    let blocked = 0;
    let inProgress = 0;
    let archived = 0;
    for (const t of tasks) {
      const status = t.status || 'queued';
      if (status === 'archived') {
        archived += 1;
        continue;
      }
      total += 1;
      if (status === 'done') done += 1;
      else if (status === 'blocked') blocked += 1;
      else if (status === 'doing') inProgress += 1;
    }
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, blocked, inProgress, archived, percent };
  },

  /**
   * @internal — exposed for testing. Returns silently when no cycle
   * would be introduced; throws Error('cycle_detected') when the new
   * parent chain reaches back to `goalId`.
   */
  _assertNoCycle(projectId, goalId, newParentGoalId) {
    if (!newParentGoalId) return;
    const file = resolveStorageFile(projectId);
    const store = loadStore(file);
    if (!store.goals.find((g) => g.id === goalId)) {
      throw new Error('goal_not_found');
    }
    if (!store.goals.find((g) => g.id === newParentGoalId)) {
      throw new Error('parent_goal_not_found');
    }
    if (chainHasCycle(store, goalId, newParentGoalId, new Set([goalId]))) {
      throw new Error('cycle_detected');
    }
  },
};