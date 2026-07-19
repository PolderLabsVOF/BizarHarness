/**
 * src/server/task-splitter.mjs
 *
 * v10.6.0 — G-autoloop Phase 3. Task ordering + auto-splitting.
 *
 * The "best order" problem the user cares about has three pieces:
 *
 *   1. Order.    Which ready task should the loop pick next? Already
 *                solved in `loop-runtime.mjs:pickReadyTasks` (priority
 *                then age, dependencies gated on `done` status).
 *
 *   2. Size.     How big is each task? Operators want to know
 *                "`tsk_abc` is L-sized" before they let the loop loose
 *                on it. Size is a heuristic over title/description
 *                length, presence of linked goal/KR, and historical
 *                completion times.
 *
 *   3. Split.    Tasks tagged `size ∈ { L, XL }` get routed to the
 *                `task-decomposer` agent, which returns 2-N smaller
 *                tasks. The new tasks link back via `parentTaskId`
 *                so progress aggregates up. The parent stays open
 *                until all children are `done`.
 *
 * This module implements pure functions for (2) and (3). Splitting
 * itself delegates to a caller-supplied `decompose` function so we
 * don't bake an LLM call into the harness — that's the agent's job
 * (per our architecture boundary: skills/MCP define agent behaviour,
 * not the dash server).
 */

const SIZE_ORDER = ['S', 'M', 'L', 'XL'];

/**
 * Estimate a task's size bucket from its title, description, linked
 * goals, and history. Heuristic, no LLM. Buckets: S, M, L, XL.
 *
 * Signals:
 *   - title word count        : +0.2 per word over 6
 *   - description char count  : +0.001 per char over 200
 *   - linked goal/KR          : +1 size point each
 *   - avg historical duration : +1 if > 2h, +2 if > 6h
 *
 * @param {Object} task
 * @param {string} task.title
 * @param {string} [task.description]
 * @param {Object} [task.metadata]      may carry goalId/krId
 * @param {Array}  [history]            prior tasks from this assignee;
 *                                      we use title-length buckets and
 *                                      avg `timeSpent` minutes as a
 *                                      proxy for difficulty.
 * @returns {'S'|'M'|'L'|'XL'}
 */
export function estimateSize(task, history = []) {
  if (!task || typeof task !== 'object') return 'M';
  const title = String(task.title || '');
  const desc = String(task.description || '');
  const meta = task.metadata || {};

  let score = 0;
  // Title length signal — every word over 6 adds 0.2 to the score.
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length > 6) score += (words.length - 6) * 0.2;

  // Description length signal — chars over 200 add 0.001 each.
  if (desc.length > 200) score += (desc.length - 200) * 0.001;

  // Linked goal / KR — both count.
  if (meta.goalId) score += 1;
  if (meta.krId) score += 1;

  // Historical signal — if prior similar-sized tasks took > 2h, push up.
  const historicalMinutes = avgHistoricalMinutes(task, history);
  if (historicalMinutes > 360) score += 2;      // > 6h
  else if (historicalMinutes > 120) score += 1; // > 2h

  return scoreToBucket(score);
}

function scoreToBucket(score) {
  if (score < 0.5) return 'S';
  if (score < 1.5) return 'M';
  if (score < 3.0) return 'L';
  return 'XL';
}

/**
 * Average minutes spent on historical tasks that share at least 2
 * title-words with the candidate. We treat very short histories
 * (< 2 items) as unreliable and return 0.
 *
 * @param {Object} task
 * @param {Array}  history
 * @returns {number}
 */
export function avgHistoricalMinutes(task, history) {
  if (!task || !Array.isArray(history) || history.length < 2) return 0;
  const titleWords = new Set(
    String(task.title || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3),
  );
  if (titleWords.size === 0) return 0;
  const similar = history.filter((h) => {
    if (!h || !h.title) return false;
    const hw = new Set(String(h.title).toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    let overlap = 0;
    for (const w of titleWords) if (hw.has(w)) overlap++;
    return overlap >= 2;
  });
  if (similar.length === 0) return 0;
  let total = 0;
  let count = 0;
  for (const h of similar) {
    const mins = Number(h.timeSpent) || 0;
    if (mins > 0) {
      total += mins;
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

/**
 * Decide whether a task should be split. Threshold: `size ∈ { L, XL }`
 * OR explicit `metadata.autoSplit === true`.
 *
 * @param {Object} task
 * @param {Array}  [history]
 * @returns {boolean}
 */
export function shouldSplit(task, history = []) {
  if (!task) return false;
  if (task.metadata && task.metadata.autoSplit === true) return true;
  if (task.metadata && task.metadata.autoSplit === false) return false;
  const size = estimateSize(task, history);
  return size === 'L' || size === 'XL';
}

/**
 * Plan a split. Returns the **call shape** the caller dispatches to a
 * `task-decomposer` agent (LLM-step), plus the metadata that should
 * be patched back onto the parent. The agent must return:
 *
 *   [{ title, description?, size?, priority? }, ...]      // 2..N tasks
 *
 * @param {Object} parent
 * @returns {Object} plan
 *   - kind: 'task-decompose'
 *   - parentTaskId
 *   - prompt: natural-language instruction for the agent
 *   - constraints: { min: 2, max: 5 } — the agent may not exceed this
 */
export function planSplit(parent) {
  if (!parent || !parent.id) throw new TypeError('planSplit: task id required');
  const p = parent;
  return {
    kind: 'task-decompose',
    parentTaskId: p.id,
    prompt: [
      `Break the following task into 2-5 smaller, independently-completable subtasks.`,
      `Each subtask should be completable in under 30 minutes by a single subagent.`,
      ``,
      `Title: ${p.title || '(no title)'}`,
      `Description: ${p.description || '(no description)'}`,
      p.assignee ? `Original assignee: ${p.assignee}` : null,
      p.metadata && p.metadata.goalId ? `Linked goal: ${p.metadata.goalId}` : null,
    ].filter(Boolean).join('\n'),
    constraints: { min: 2, max: 5 },
  };
}

/**
 * Validate a `task-decompose` response. Returns an array of task
 * seeds (without ids — those are minted by the task store on create).
 *
 * @param {Array}  candidates
 * @param {Object} [opts]
 * @param {number} [opts.min=2]
 * @param {number} [opts.max=5]
 * @returns {Array} cleaned seeds, ready to be passed to `tasksStore.create`
 */
export function acceptSplit(candidates, { min = 2, max = 5 } = {}) {
  if (!Array.isArray(candidates)) return [];
  const out = [];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    if (!c.title || typeof c.title !== 'string') continue;
    out.push({
      title: String(c.title).slice(0, 200),
      description: c.description ? String(c.description).slice(0, 4000) : '',
      priority: Number.isFinite(c.priority) ? c.priority : 5,
      tags: Array.isArray(c.tags) ? c.tags.filter((t) => typeof t === 'string') : ['autosplit'],
    });
    if (out.length >= max) break;
  }
  if (out.length < min) return [];
  return out;
}

/**
 * Roll up child task progress into the parent's `metadata.progress`
 * (0..1) and auto-complete the parent when all children are `done`.
 *
 * Pure function — the caller is responsible for writing back to the
 * task store. Returns `{ ratio, allDone }`. If `parent` has no
 * children array, returns `{ ratio: 0, allDone: false }`.
 *
 * @param {Object} parent
 * @returns {Object}
 */
export function rollupProgress(parent) {
  if (!parent) return { ratio: 0, allDone: false };
  const children = Array.isArray(parent.subtasks) ? parent.subtasks : [];
  if (children.length === 0) return { ratio: 0, allDone: false };
  let done = 0;
  for (const c of children) {
    if (c && c.status === 'done') done++;
  }
  const ratio = done / children.length;
  return { ratio, allDone: done === children.length };
}

/**
 * Suggest a goal-aware priority bump. If a task links to a goal whose
 * status is `at-risk` or `blocked`, bump its priority by 1; if `done`,
 * drop the task to backlog. Pure helper; caller decides what to do
 * with the result.
 *
 * @param {Object} task
 * @param {Object} [goal]   parsed goal object (from progress-parser)
 * @returns {{ priority: number, action: 'bump'|'drop'|'none' }}
 */
export function goalAwarePriority(task, goal) {
  if (!task || !goal) return { priority: Number.isFinite(task && task.priority) ? task.priority : 5, action: 'none' };
  const base = Number.isFinite(task.priority) ? task.priority : 5;
  if (goal.status === 'at-risk') return { priority: Math.max(1, base - 1), action: 'bump' };
  if (goal.status === 'blocked') return { priority: base, action: 'none' };
  if (goal.status === 'done') return { priority: 9, action: 'drop' };
  return { priority: base, action: 'none' };
}

/** Exported for tests + UI. */
export const __sizeBuckets = SIZE_ORDER;
