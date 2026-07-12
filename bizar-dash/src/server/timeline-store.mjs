/**
 * src/server/timeline-store.mjs
 *
 * v6.6.0 — F-042 (Visual Timeline + Agent Memory). Single source of
 * truth for "what changed, where, when" — aggregates events from:
 *   - git commits (via timeline-sources/git.js)
 *   - hook logs (via timeline-sources/hooks.js + watcher on the dir)
 *   - agent activity (claude-session-watcher.mjs + agents-store.mjs)
 *   - task changes (tasks-store.mjs → appendActivity)
 *   - goal changes (goals-store.mjs → setTasks / create / update)
 *   - file changes (watcher.mjs → chokidar events)
 *
 * Storage:
 *   - Append-only NDJSON at ~/.config/bizar/timeline.jsonl (rotated
 *     at 50MB → timeline.jsonl.1, .2, …).
 *   - In-memory ring buffer of the last 10 000 events for fast reads.
 *   - Dedupe by `{ source, sourceId }` so a hook re-emit is a no-op.
 *
 * Append side-effect contract:
 *   - `appendEvent` MUST NEVER throw. It's called from every CRUD
 *     path in tasks/goals/agents/claude-session-watcher; a throw here
 *     would crash the very operations it is meant to observe.
 *   - On failure we log via `console.error` (the only place the
 *     timeline is allowed to be chatty) and return null so the
 *     caller can ignore.
 *
 * Test seams:
 *   - `_testValidate(event)`              shape check
 *   - `_testFromHookLog(line)`            normalize a hook JSONL line
 *   - `_testFromTaskActivity(task, type, data)`  normalize a task activity row
 *   - `_testFromGoalChange(goal, action)`         normalize a goal diff
 *   - `_testFromAgentStatus(name, status, source)` normalize a status flip
 *   - `_testFromCommit(sha, projectPath)`         normalize a commit
 *   - `_testFromFileChange(filePath, projectPath)` normalize a chokidar event
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  statSync,
  renameSync,
  readdirSync,
  watch,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const HOME = homedir();
const TIMELINE_DIR = join(HOME, '.config', 'bizar');
const TIMELINE_FILE = join(TIMELINE_DIR, 'timeline.jsonl');
const HOOK_LOG_DIR = join(TIMELINE_DIR, 'hook-logs');

const RING_BUFFER_SIZE = 10_000;
const ROTATION_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_ROTATIONS = 5; // keep timeline.jsonl.1 … timeline.jsonl.5

const ALLOWED_TYPES = new Set(['commit', 'hook', 'agent', 'task', 'goal', 'file']);
const ALLOWED_SUBTYPES = new Set([
  // task
  'task-created', 'task-status', 'task-progress', 'task-completed',
  'task-comment', 'task-timer-start', 'task-timer-stop', 'task-goal-link',
  // goal
  'goal-created', 'goal-updated', 'goal-archived', 'goal-completed',
  'goal-tasks-linked',
  // agent
  'agent-spawned', 'agent-tool-use', 'agent-status', 'agent-session-ended',
  'agent-approval', 'agent-steered', 'agent-killed',
  // hook
  'session-start', 'session-end', 'agent-tool-detected',
  // file
  'file-add', 'file-change', 'file-unlink',
  // commit
  'commit',
]);

let _ring = []; // newest last; trimmed to RING_BUFFER_SIZE
let _byKey = new Map(); // dedupe key (source|sourceId) → event id
let _active = false;
let _fileWatcher = null;
let _pollTimer = null;
let _broadcast = () => {};
let _initialized = false;

function nowIso() {
  return new Date().toISOString();
}

function genEventId() {
  return 'evt_' + randomBytes(5).toString('hex').slice(0, 10);
}

function dedupeKey(event) {
  if (!event || !event.source || !event.sourceId) return null;
  return `${event.source}|${event.sourceId}`;
}

/**
 * Validate / normalize an event into the canonical shape. Returns
 * `null` when the input is malformed; the caller decides whether to
 * silently drop or surface the error.
 */
export function _testValidate(input) {
  if (!input || typeof input !== 'object') return null;
  const e = { ...input };
  if (!ALLOWED_TYPES.has(e.type)) return null;
  e.subType = typeof e.subType === 'string' ? e.subType : 'unknown';
  e.id = typeof e.id === 'string' && e.id ? e.id : genEventId();
  e.ts = typeof e.ts === 'string' && e.ts ? e.ts : nowIso();
  e.projectId = e.projectId == null ? null : String(e.projectId);
  e.projectPath = e.projectPath == null ? null : String(e.projectPath);
  e.actor = (e.actor && typeof e.actor === 'object')
    ? {
        kind: ['user', 'agent', 'system'].includes(e.actor.kind) ? e.actor.kind : 'system',
        name: e.actor.name || null,
        sessionId: e.actor.sessionId || null,
      }
    : { kind: 'system', name: null, sessionId: null };
  e.summary = typeof e.summary === 'string' ? e.summary.slice(0, 500) : '';
  e.detail = typeof e.detail === 'string' ? e.detail.slice(0, 4000) : null;
  e.refs = (e.refs && typeof e.refs === 'object') ? { ...e.refs } : {};
  e.metadata = (e.metadata && typeof e.metadata === 'object') ? { ...e.metadata } : {};
  e.source = typeof e.source === 'string' ? e.source : 'unknown';
  e.sourceId = typeof e.sourceId === 'string' ? e.sourceId : null;
  return e;
}

/**
 * Hook-log lines already exist in `~/.config/bizar/hook-logs/*.jsonl`
 * (the F-040 hooks write them). Normalize one line into a TimelineEvent.
 * The line shape is hook-specific, so we do best-effort inference.
 */
export function _testFromHookLog(line) {
  if (!line || typeof line !== 'object') return null;
  const ts = line.ts || nowIso();
  const sessionId = line.sessionId || null;
  // session-start
  if (line.source === 'startup' || (typeof line.initial === 'string' && line.initial.startsWith('bizar:sessionstart'))) {
    return _testValidate({
      type: 'hook',
      subType: 'session-start',
      ts,
      actor: { kind: 'user', sessionId },
      summary: `Session started (${line.source || 'startup'})`,
      detail: line.initial || null,
      source: 'hook-log',
      sourceId: `hook-start:${sessionId}:${ts}`,
      refs: { sessionId },
      metadata: { source: line.source || 'startup' },
    });
  }
  // session-end
  if (line.reason && typeof line.reason === 'string') {
    return _testValidate({
      type: 'hook',
      subType: 'session-end',
      ts,
      actor: { kind: 'user', sessionId },
      summary: `Session ended (${line.reason})`,
      detail: line.cwd || null,
      source: 'hook-log',
      sourceId: `hook-end:${sessionId}:${ts}`,
      refs: { sessionId },
      metadata: { reason: line.reason, cwd: line.cwd || null },
    });
  }
  // agent-tool-detected
  if (line.agentName) {
    return _testValidate({
      type: 'hook',
      subType: 'agent-tool-detected',
      ts,
      actor: { kind: 'agent', name: line.agentName, sessionId },
      summary: `Agent tool detected: ${line.agentName}`,
      detail: line.promptPreview || null,
      source: 'hook-log',
      sourceId: `hook-agenttool:${sessionId || 'nosession'}:${ts}:${line.agentName}`,
      refs: { sessionId, agentName: line.agentName },
      metadata: { promptPreview: line.promptPreview || null },
    });
  }
  return null;
}

/**
 * Convert a (task, type, data) appendActivity triple into a
 * TimelineEvent. Mirrors the activity types emitted by tasks-store.mjs:
 *   - created / status / progress / completed / comment /
 *     timer-start / timer-stop / goal-link
 */
export function _testFromTaskActivity(task, type, data) {
  if (!task) return null;
  const subTypeMap = {
    created: 'task-created',
    status: 'task-status',
    progress: 'task-progress',
    completed: 'task-completed',
    comment: 'task-comment',
    'timer-start': 'task-timer-start',
    'timer-stop': 'task-timer-stop',
    'goal-link': 'task-goal-link',
  };
  const subType = subTypeMap[type] || `task-${type}`;
  const ts = task.activity?.[task.activity.length - 1]?.ts || nowIso();
  let summary = `Task ${type}: ${task.title || task.id}`;
  if (type === 'status' && data?.from && data?.to) {
    summary = `Task "${task.title}" ${data.from} → ${data.to}`;
  } else if (type === 'completed') {
    summary = `Task "${task.title}" completed`;
  } else if (type === 'comment') {
    summary = `Comment added to "${task.title}"`;
  } else if (type === 'goal-link') {
    summary = `Task "${task.title}" linked to goal ${data?.to || '(unlinked)'}`;
  } else if (type === 'progress' && typeof data?.progress === 'number') {
    summary = `Task "${task.title}" progress ${data.progress}%`;
  } else if (type === 'created') {
    summary = `Created task "${task.title}"`;
  } else if (type === 'timer-start') {
    summary = `Started timer on "${task.title}"`;
  } else if (type === 'timer-stop') {
    summary = `Stopped timer on "${task.title}" (${data?.elapsed || 0}s)`;
  }
  return _testValidate({
    type: 'task',
    subType,
    ts,
    projectId: task.projectId || null,
    actor: { kind: task.workedBy ? 'agent' : 'user', name: task.workedBy || null },
    summary,
    detail: data ? JSON.stringify(data).slice(0, 2000) : null,
    source: 'tasks-store',
    sourceId: `task-activity:${task.id}:${type}:${ts}:${Math.random().toString(36).slice(2, 8)}`,
    refs: {
      taskId: task.id,
      goalId: task.goalId || null,
      agentName: task.workedBy || null,
    },
    metadata: { type, data: data || null, priority: task.priority || null },
  });
}

/**
 * Convert a goal change into a TimelineEvent. `action` ∈
 * 'create' | 'update' | 'archive' | 'link-task' | 'unlink-task'.
 */
export function _testFromGoalChange(goal, action, extra = {}) {
  if (!goal) return null;
  const subTypeMap = {
    create: 'goal-created',
    update: 'goal-updated',
    archive: 'goal-archived',
    complete: 'goal-completed',
    'link-task': 'goal-tasks-linked',
    'unlink-task': 'goal-tasks-linked',
  };
  const subType = subTypeMap[action] || 'goal-updated';
  const ts = goal.updatedAt || goal.createdAt || nowIso();
  let summary = `Goal ${action}: ${goal.title}`;
  if (action === 'create') summary = `Created goal "${goal.title}"`;
  else if (action === 'archive') summary = `Archived goal "${goal.title}"`;
  else if (action === 'complete') summary = `Completed goal "${goal.title}"`;
  else if (action === 'link-task') summary = `Linked task to goal "${goal.title}"`;
  else if (action === 'unlink-task') summary = `Unlinked task from goal "${goal.title}"`;
  return _testValidate({
    type: 'goal',
    subType,
    ts,
    projectId: goal.projectId || null,
    actor: { kind: 'user', name: goal.owner || null },
    summary,
    detail: extra.detail || null,
    source: 'goals-store',
    sourceId: `goal-${action}:${goal.id}:${ts}:${Math.random().toString(36).slice(2, 8)}`,
    refs: { goalId: goal.id },
    metadata: { action, status: goal.status || null, priority: goal.priority || null },
  });
}

/**
 * Convert an agent-status change into a TimelineEvent. `source` is the
 * caller (e.g. 'claude-session-watcher', 'hook', 'tasks-store').
 */
export function _testFromAgentStatus(agentName, status, source = 'system') {
  if (!agentName) return null;
  const ts = nowIso();
  let subType = 'agent-status';
  if (status === 'working') subType = 'agent-spawned';
  if (status === 'idle' || status === 'completed' || status === 'failed') subType = 'agent-session-ended';
  return _testValidate({
    type: 'agent',
    subType,
    ts,
    actor: { kind: 'agent', name: agentName },
    summary: `Agent ${agentName} → ${status}`,
    source: String(source || 'system'),
    sourceId: `agent-status:${agentName}:${ts}:${Math.random().toString(36).slice(2, 8)}`,
    refs: { agentName },
    metadata: { status, source },
  });
}

/**
 * Convert a git commit into a TimelineEvent.
 */
export function _testFromCommit(sha, projectPath, commit = {}) {
  if (!sha) return null;
  return _testValidate({
    type: 'commit',
    subType: 'commit',
    ts: commit.ts || nowIso(),
    projectPath: projectPath || null,
    actor: { kind: 'user', name: commit.author || null },
    summary: commit.subject || `commit ${sha.slice(0, 7)}`,
    detail: commit.body || null,
    source: 'git',
    sourceId: `commit:${sha}`,
    refs: { commitSha: sha, file: projectPath || null },
    metadata: { author: commit.author || null },
  });
}

/**
 * Convert a chokidar file event into a TimelineEvent.
 */
export function _testFromFileChange(filePath, projectPath) {
  if (!filePath) return null;
  const ts = nowIso();
  // chokidar hands us the event + the path. We don't know which kind
  // here, so the router normalizes that. We provide a default.
  return _testValidate({
    type: 'file',
    subType: 'file-change',
    ts,
    projectPath: projectPath || null,
    actor: { kind: 'system' },
    summary: `File changed: ${filePath}`,
    source: 'watcher',
    sourceId: `file:${filePath}:${ts}`,
    refs: { file: filePath },
    metadata: { event: 'change' },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Persistence + ring buffer
// ─────────────────────────────────────────────────────────────────────────

function ensureDir() {
  try { mkdirSync(TIMELINE_DIR, { recursive: true }); } catch { /* ignore */ }
}

function rotateIfNeeded() {
  let st;
  try { st = statSync(TIMELINE_FILE); }
  catch { return; }
  if (st.size < ROTATION_BYTES) return;
  try {
    // Shift .4 → .5, .3 → .4, … .1 → .2; current → .1.
    for (let i = MAX_ROTATIONS; i >= 1; i--) {
      const src = i === 1 ? TIMELINE_FILE : `${TIMELINE_FILE}.${i - 1}`;
      const dst = `${TIMELINE_FILE}.${i}`;
      if (!existsSync(src)) continue;
      if (i === MAX_ROTATIONS) {
        try { renameSync(src, dst); } catch { /* ignore */ }
      } else {
        try { renameSync(src, dst); } catch { /* ignore */ }
      }
    }
  } catch { /* best effort */ }
}

function persistEvent(event) {
  try {
    ensureDir();
    rotateIfNeeded();
    appendFileSync(TIMELINE_FILE, JSON.stringify(event) + '\n', 'utf8');
  } catch (err) {
    try { console.error('[timeline-store] persist failed:', err?.message || String(err)); }
    catch { /* ignore */ }
  }
}

function pushToRing(event) {
  _ring.push(event);
  if (_ring.length > RING_BUFFER_SIZE) {
    _ring.splice(0, _ring.length - RING_BUFFER_SIZE);
    // Trim the dedupe map too — we only ever need to dedupe against
    // what's still in the ring.
    if (_byKey.size > RING_BUFFER_SIZE) {
      _byKey = new Map();
      for (const ev of _ring) {
        const k = dedupeKey(ev);
        if (k) _byKey.set(k, ev.id);
      }
    }
  }
}

/**
 * Append a single event. Validates, dedupes, persists, broadcasts.
 * Returns the validated event on success, null otherwise. Never throws.
 */
function appendInternal(event) {
  try {
    const validated = _testValidate(event);
    if (!validated) return null;
    const k = dedupeKey(validated);
    if (k && _byKey.has(k)) {
      const existingId = _byKey.get(k);
      const existing = _ring.find((ev) => ev.id === existingId);
      return existing || null;
    }
    pushToRing(validated);
    if (k) _byKey.set(k, validated.id);
    persistEvent(validated);
    try { _broadcast({ type: 'timeline:event', event: validated }); }
    catch { /* best effort */ }
    return validated;
  } catch (err) {
    try { console.error('[timeline-store] appendEvent threw:', err?.message || String(err)); }
    catch { /* ignore */ }
    return null;
  }
}

/**
 * Backfill the ring buffer from disk. Walks each rotation file newest
 * → oldest and dedupes by (source, sourceId). Drops malformed lines.
 */
function backfillFromDisk() {
  const files = [TIMELINE_FILE];
  for (let i = 1; i <= MAX_ROTATIONS; i++) files.push(`${TIMELINE_FILE}.${i}`);
  const all = [];
  for (const fp of files) {
    if (!existsSync(fp)) continue;
    let text;
    try { text = readFileSync(fp, 'utf8'); } catch { continue; }
    if (!text) continue;
    for (const line of text.split('\n')) {
      if (!line) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      const validated = _testValidate(parsed);
      if (!validated) continue;
      const k = dedupeKey(validated);
      if (k && _byKey.has(k)) continue;
      all.push(validated);
      if (k) _byKey.set(k, validated.id);
    }
  }
  all.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  _ring = all.slice(-RING_BUFFER_SIZE);
}

// ─────────────────────────────────────────────────────────────────────────
// Query helpers
// ─────────────────────────────────────────────────────────────────────────

function filterEvents(events, opts = {}) {
  const {
    projectId,
    type,
    since,
    until,
    file,
    agentName,
    taskId,
    goalId,
    sessionId,
    commitSha,
    text,
  } = opts;
  let out = events;
  if (projectId != null) {
    out = out.filter((e) => e.projectId === projectId);
  }
  if (type) {
    const want = String(type).split(',').map((s) => s.trim()).filter(Boolean);
    out = out.filter((e) => want.includes(e.type));
  }
  if (since) {
    const sinceTs = String(since);
    out = out.filter((e) => (e.ts || '') >= sinceTs);
  }
  if (until) {
    const untilTs = String(until);
    out = out.filter((e) => (e.ts || '') <= untilTs);
  }
  if (file) {
    const f = String(file);
    out = out.filter((e) => (e.refs?.file || '').includes(f));
  }
  if (agentName) {
    const a = String(agentName);
    out = out.filter((e) => e.refs?.agentName === a || e.actor?.name === a);
  }
  if (taskId) out = out.filter((e) => e.refs?.taskId === taskId);
  if (goalId) out = out.filter((e) => e.refs?.goalId === goalId);
  if (sessionId) out = out.filter((e) => e.refs?.sessionId === sessionId);
  if (commitSha) out = out.filter((e) => e.refs?.commitSha === commitSha);
  if (text) {
    const t = String(text).toLowerCase();
    out = out.filter((e) =>
      (e.summary || '').toLowerCase().includes(t)
      || (e.detail || '').toLowerCase().includes(t)
    );
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────────

/**
 * Append one event. Validates, dedupes, persists, broadcasts. Never
 * throws — returns the validated event on success, null otherwise.
 */
function appendEvent(event) {
  return appendInternal(event);
}

function query(opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 1000);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  let filtered = filterEvents(_ring, opts);
  filtered = filtered.slice().sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);
  return { items, total, limit, offset };
}

function summary(opts = {}) {
  const since = opts.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const filtered = filterEvents(_ring, { since });
  const counts = { commit: 0, hook: 0, agent: 0, task: 0, goal: 0, file: 0, total: filtered.length };
  for (const e of filtered) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }
  return { counts, since, until: opts.until || null };
}

/**
 * Short prose summary for the SessionStart prime hook. ≤200 words by
 * construction (we cap to the top 20 most-recent events).
 */
function agentContext(opts = {}) {
  const since = opts.since
    || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const filtered = filterEvents(_ring, { since });
  const recent = filtered.slice().sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, 20);
  if (recent.length === 0) {
    return 'No timeline activity in the last 24h. This is a fresh session.';
  }
  const byType = {};
  for (const e of recent) byType[e.type] = (byType[e.type] || 0) + 1;
  const lines = [];
  lines.push(`Recent activity (${recent.length} events, last 24h):`);
  for (const [t, n] of Object.entries(byType)) lines.push(`- ${t}: ${n}`);
  lines.push('');
  lines.push('Most recent:');
  for (const e of recent.slice(0, 5)) {
    lines.push(`- [${e.ts}] (${e.type}/${e.subType}) ${e.summary}`);
  }
  return lines.join('\n').split(/\s+/).slice(0, 220).join(' ');
}

function recent(opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 1000);
  return _ring.slice().sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, limit);
}

function size() {
  return _ring.length;
}

/**
 * Boot the in-memory ring + start the hook-log directory watcher so
 * every new line in `~/.config/bizar/hook-logs/*.jsonl` is appended.
 * Idempotent.
 */
function start(opts = {}) {
  if (_active) return false;
  if (typeof opts.broadcast === 'function') _broadcast = opts.broadcast;
  ensureDir();
  if (!_initialized) {
    backfillFromDisk();
    _initialized = true;
  }
  try {
    if (existsSync(HOOK_LOG_DIR)) {
      _fileWatcher = watch(HOOK_LOG_DIR, { persistent: false }, () => {
        scanHookLogsDir({ broadcastOnly: true });
      });
    }
  } catch { /* ignore */ }
  _pollTimer = setInterval(() => scanHookLogsDir({ broadcastOnly: true }), 5_000);
  if (_pollTimer.unref) _pollTimer.unref();
  _active = true;
  return true;
}

function stop() {
  if (!_active) return false;
  _active = false;
  try { _fileWatcher?.close?.(); } catch { /* ignore */ }
  _fileWatcher = null;
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = null;
  return true;
}

function isActive() {
  return _active;
}

/**
 * Walk every `*.jsonl` in the hook-log dir and append new lines to
 * the ring. Tracks a per-file lastSize to avoid duplicate appends.
 */
const _hookLastSize = new Map();
function scanHookLogsDir(opts = {}) {
  try {
    if (!existsSync(HOOK_LOG_DIR)) return 0;
    const files = readdirSync(HOOK_LOG_DIR).filter((f) => f.endsWith('.jsonl'));
    let appended = 0;
    for (const f of files) {
      const fp = join(HOOK_LOG_DIR, f);
      let st;
      try { st = statSync(fp); } catch { continue; }
      const lastSize = _hookLastSize.get(fp) || 0;
      if (st.size === lastSize) continue;
      const truncated = st.size < lastSize;
      if (truncated) _hookLastSize.set(fp, 0);
      let text;
      try { text = readFileSync(fp, 'utf8'); } catch { continue; }
      const startAt = truncated ? 0 : lastSize;
      const slice = text.slice(startAt, st.size);
      const lines = slice.split('\n');
      let newSize = st.size;
      if (lines.length && lines[lines.length - 1] !== '') {
        const tail = lines[lines.length - 1];
        newSize = st.size - Buffer.byteLength(tail, 'utf8');
        lines.pop();
      }
      for (const ln of lines) {
        if (!ln) continue;
        let parsed;
        try { parsed = JSON.parse(ln); } catch { continue; }
        const ev = _testFromHookLog(parsed);
        if (!ev) continue;
        if (opts.broadcastOnly) {
          // Already in the ring buffer (we wrote it ourselves when the
          // hook ran); skip here. But if the file was rotated under us
          // we DO need to re-append. Simpler: just attempt append,
          // dedupe-by-key will no-op for repeats.
          const got = appendInternal(ev);
          if (got) appended += 1;
        } else {
          const got = appendInternal(ev);
          if (got) appended += 1;
        }
      }
      _hookLastSize.set(fp, newSize);
    }
    return appended;
  } catch {
    return 0;
  }
}

export const timelineStore = {
  start,
  stop,
  isActive,
  size,
  appendEvent,
  query,
  summary,
  agentContext,
  recent,
  scanHookLogsDir,
  // Test seams
  _testValidate,
  _testFromHookLog,
  _testFromTaskActivity,
  _testFromGoalChange,
  _testFromAgentStatus,
  _testFromCommit,
  _testFromFileChange,
  // Constants
  TIMELINE_FILE,
  TIMELINE_DIR,
  HOOK_LOG_DIR,
};
