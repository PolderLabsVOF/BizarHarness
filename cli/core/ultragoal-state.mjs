/**
 * ultragoal-state.mjs — Durable state machine for `/ultragoal`
 * (F-202 Phase 1 OMX adoption).
 *
 * Modeled on `cli/core/workflow-state.mjs` so the same operational
 * properties hold:
 *   - Atomic temp-file rename (no partial writes survive a crash).
 *   - `stateHash` compare-before-write so concurrent writers can
 *     detect divergence instead of silently clobbering.
 *   - Stale-lock expiry (LOCK_STALE_MS) so a crashed writer does not
 *     permanently block a session.
 *
 * Phase machine: `planning → executing → verifying → reviewing →
 * checkpointing → done`. `blocked` is NON-TERMINAL and transitions
 * back to `executing` on resume. `failed` and `cancelled` are
 * terminal; once set the state cannot leave them except via a
 * fresh `startUltragoal`.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

export const ULTRAGOAL_PHASES = Object.freeze([
  'planning',
  'executing',
  'verifying',
  'reviewing',
  'checkpointing',
  'done',
]);
/** Non-terminal. Blocked runs return to `executing` on resume. */
export const ULTRAGOAL_NONTERMINAL_PHASES = Object.freeze(['blocked']);
export const ULTRAGOAL_TERMINAL_STATUSES = Object.freeze(['done', 'failed', 'cancelled']);
export const ULTRAGOAL_STATUSES = Object.freeze([
  ...ULTRAGOAL_PHASES,
  ...ULTRAGOAL_NONTERMINAL_PHASES,
  ...ULTRAGOAL_TERMINAL_STATUSES,
]);

export const ULTRAGOAL_MODES = Object.freeze(['aggregate', 'per-story']);
export const ULTRAGOAL_ACTIONS = Object.freeze(['add_subgoal', 'split_subgoal']);

/** Stale-lock expiry in ms (mirrors workflow-state). */
export const LOCK_STALE_MS = 30_000;

/** Max subgoals allowed per ultragoal run (bounded fan-out). */
export const ULTRAGOAL_LIMITS = Object.freeze({
  maxSubgoals: 64,
  maxCheckpointLogEntries: 512,
});

const SCHEMA_VERSION = '1.0.0';
const MODE = 'ultragoal';

export class UltragoalStateError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'UltragoalStateError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/**
 * Adjacency map of valid phase transitions. The forward path is
 * linear; `blocked` returns to `executing`; `failed`/`cancelled`
 * are terminal (start over).
 */
const TRANSITIONS = Object.freeze({
  planning: Object.freeze(new Set(['executing', 'failed', 'cancelled'])),
  executing: Object.freeze(new Set(['verifying', 'reviewing', 'blocked', 'failed', 'cancelled'])),
  verifying: Object.freeze(new Set(['reviewing', 'executing', 'failed', 'cancelled'])),
  reviewing: Object.freeze(new Set(['checkpointing', 'executing', 'failed', 'cancelled'])),
  checkpointing: Object.freeze(new Set(['done', 'executing', 'failed', 'cancelled'])),
  done: Object.freeze(new Set()),
  failed: Object.freeze(new Set()),
  cancelled: Object.freeze(new Set()),
  blocked: Object.freeze(new Set(['executing', 'failed', 'cancelled'])),
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
  return out;
}

function stateHash(state) {
  const { stateHash: _ignored, ...hashable } = state;
  return sha256(JSON.stringify(canonicalize(hashable)));
}

function withStateHash(state) {
  return { ...state, stateHash: stateHash(state) };
}

function assert(condition, code, message, details) {
  if (!condition) throw new UltragoalStateError(code, message, details);
}

function isIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function assertSafeSessionId(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new UltragoalStateError('SESSION_REQUIRED', 'a non-empty session id is required');
  }
  const trimmed = value.trim();
  if (trimmed.length > 128 || trimmed === '.' || trimmed === '..' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
    throw new UltragoalStateError(
      'INVALID_SESSION',
      'session id must be 1-128 safe filename characters and cannot contain path separators',
    );
  }
  return trimmed;
}

function resolveProjectRoot(projectRoot = process.cwd()) {
  const absolute = resolve(projectRoot);
  if (!existsSync(absolute)) {
    throw new UltragoalStateError('INVALID_PROJECT', `project root does not exist: ${absolute}`);
  }
  return realpathSync(absolute);
}

function resolveStatePaths({ projectRoot, sessionId, id }) {
  const safeSession = assertSafeSessionId(sessionId);
  const project = resolveProjectRoot(projectRoot);
  if (typeof id !== 'string' || !id.trim()) {
    throw new UltragoalStateError('ID_REQUIRED', 'ultragoal id is required');
  }
  if (id.trim().length > 128 || id === '.' || id === '..' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id.trim())) {
    throw new UltragoalStateError('INVALID_ID', 'ultragoal id must be 1-128 safe filename characters');
  }
  const dir = join(project, '.bizar', 'ultragoal', safeSession, id.trim());
  const statePath = join(dir, 'state.json');
  const lockPath = join(dir, 'state.lock');
  return { projectRoot: project, sessionId: safeSession, id: id.trim(), dir, statePath, lockPath };
}

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function writeAtomic(path, value) {
  ensureDir(path);
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function acquireLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      writeFileSync(fd, `${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`);
      return fd;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        stale = Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS;
      } catch {
        // Lock was removed by a racing owner — retry once.
      }
      if (!stale) {
        throw new UltragoalStateError('ULTRAGOAL_BUSY', 'ultragoal state is locked');
      }
      rmSync(lockPath, { force: true });
    }
  }
  throw new UltragoalStateError('ULTRAGOAL_BUSY', 'ultragoal state is locked');
}

function withLock(paths, operation) {
  ensureDir(paths.statePath);
  const fd = acquireLock(paths.lockPath);
  try {
    return operation();
  } finally {
    closeSync(fd);
    rmSync(paths.lockPath, { force: true });
  }
}

function historyEntry({ revision, event, from, to, at, payloadHash = null }) {
  return payloadHash
    ? { revision, event, from, to, at, payloadHash }
    : { revision, event, from, to, at };
}

export function normalizeGoal(goal, { maxLength = 4096 } = {}) {
  if (typeof goal !== 'string' || !goal.trim()) {
    throw new UltragoalStateError('GOAL_REQUIRED', 'a non-empty goal is required');
  }
  const normalized = goal.trim().replace(/\s+/g, ' ');
  if (normalized.length > maxLength) {
    throw new UltragoalStateError(
      'GOAL_TOO_LONG',
      `goal must not exceed ${maxLength} characters`,
      { maxLength },
    );
  }
  return normalized;
}

export function validateUltragoalState(state, context) {
  assert(state && typeof state === 'object' && !Array.isArray(state), 'INVALID_STATE', 'state must be an object');
  assert(state.schemaVersion === SCHEMA_VERSION, 'INVALID_STATE', 'unsupported ultragoal state schema');
  assert(state.mode === MODE, 'INVALID_STATE', 'state mode must be ultragoal');
  assert(typeof state.runId === 'string' && /^[0-9a-f-]{36}$/i.test(state.runId), 'INVALID_STATE', 'run id is invalid');
  assert(state.sessionId === context.sessionId, 'FOREIGN_SESSION', 'state belongs to a different session');
  assert(state.projectRoot === context.projectRoot, 'FOREIGN_PROJECT', 'state belongs to a different project');
  assert(state.id === context.id, 'FOREIGN_ID', 'state belongs to a different ultragoal id');
  assert(ULTRAGOAL_MODES.includes(state.modeOf), 'INVALID_STATE', 'ultragoal mode is invalid');
  assert(typeof state.goal === 'string' && state.goal.length > 0, 'INVALID_STATE', 'goal is invalid');
  assert(ULTRAGOAL_STATUSES.includes(state.phase), 'INVALID_STATE', 'phase is invalid');
  assert(Number.isSafeInteger(state.revision) && state.revision >= 1, 'INVALID_STATE', 'revision is invalid');
  assert(isIsoDate(state.startedAt) && isIsoDate(state.updatedAt), 'INVALID_STATE', 'timestamps are invalid');
  assert(state.subgoals && typeof state.subgoals === 'object' && !Array.isArray(state.subgoals), 'INVALID_STATE', 'subgoals map is invalid');
  assert(
    Object.keys(state.subgoals).length <= ULTRAGOAL_LIMITS.maxSubgoals,
    'SUBGOAL_LIMIT',
    `subgoals exceed limit of ${ULTRAGOAL_LIMITS.maxSubgoals}`,
  );
  assert(state.checkpointLog && Array.isArray(state.checkpointLog), 'INVALID_STATE', 'checkpoint log is invalid');
  assert(
    state.checkpointLog.length <= ULTRAGOAL_LIMITS.maxCheckpointLogEntries,
    'CHECKPOINT_LIMIT',
    `checkpoint log exceeds limit of ${ULTRAGOAL_LIMITS.maxCheckpointLogEntries}`,
  );
  assert(state.stateHash === stateHash(state), 'INTEGRITY_ERROR', 'state hash mismatch');
  return state;
}

function readState(paths) {
  if (!existsSync(paths.statePath)) {
    throw new UltragoalStateError('NOT_FOUND', 'no ultragoal run exists for this id');
  }
  try {
    const parsed = JSON.parse(readFileSync(paths.statePath, 'utf8'));
    return validateUltragoalState(parsed, paths);
  } catch (error) {
    if (error instanceof UltragoalStateError) throw error;
    throw new UltragoalStateError('INVALID_STATE', `cannot read ultragoal state: ${error.message}`);
  }
}

function readStateLenient(paths) {
  if (!existsSync(paths.statePath)) return null;
  try {
    return JSON.parse(readFileSync(paths.statePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Start a new ultragoal run. Throws `ALREADY_ACTIVE` if an existing
 * run for the same `(sessionId, id)` is still in a non-terminal
 * phase. The state file is written atomically after a `stateHash`
 * is stamped.
 */
export function startUltragoal({
  projectRoot = process.cwd(),
  sessionId,
  id,
  modeOf = 'aggregate',
  goal,
  now = new Date(),
}) {
  const paths = resolveStatePaths({ projectRoot, sessionId, id });
  if (!ULTRAGOAL_MODES.includes(modeOf)) {
    throw new UltragoalStateError('INVALID_MODE', `modeOf must be one of ${ULTRAGOAL_MODES.join(', ')}`);
  }
  const normalizedGoal = normalizeGoal(goal);
  return withLock(paths, () => {
    const existing = readStateLenient(paths);
    if (existing && !ULTRAGOAL_TERMINAL_STATUSES.includes(existing.phase)) {
      throw new UltragoalStateError(
        'ALREADY_ACTIVE',
        'an ultragoal run is already active for this id',
        { runId: existing.runId, phase: existing.phase },
      );
    }
    const timestamp = now.toISOString();
    const state = withStateHash({
      schemaVersion: SCHEMA_VERSION,
      mode: MODE,
      runId: randomUUID(),
      sessionId: paths.sessionId,
      projectRoot: paths.projectRoot,
      id: paths.id,
      modeOf,
      goal: normalizedGoal,
      phase: 'planning',
      revision: 1,
      startedAt: timestamp,
      updatedAt: timestamp,
      terminalAt: null,
      subgoals: {},
      checkpointLog: [],
      history: [historyEntry({ revision: 1, event: 'start', from: null, to: 'planning', at: timestamp })],
    });
    writeAtomic(paths.statePath, state);
    return state;
  });
}

export function getUltragoalState({ projectRoot = process.cwd(), sessionId, id }) {
  const paths = resolveStatePaths({ projectRoot, sessionId, id });
  return withLock(paths, () => readState(paths));
}

function transitionUltragoal(options, mutator) {
  const { projectRoot = process.cwd(), sessionId, id } = options;
  const paths = resolveStatePaths({ projectRoot, sessionId, id });
  return withLock(paths, () => {
    const state = readState(paths);
    // `readState` already validated `state.stateHash === stateHash(state)`
    // so we trust the read result. The lock file prevents concurrent
    // writers from interleaving, so no additional compare-before-write
    // is required inside the locked region — it would only catch the
    // (now impossible) case of an out-of-band writer corrupting the
    // file mid-transition, which we surface as INTEGRITY_ERROR on the
    // next read instead.
    const draft = mutator({ ...state, history: [...state.history] });
    draft.revision = state.revision + 1;
    draft.updatedAt = new Date().toISOString();
    if (ULTRAGOAL_TERMINAL_STATUSES.includes(draft.phase)) {
      draft.terminalAt = draft.updatedAt;
    }
    const stamped = withStateHash(draft);
    writeAtomic(paths.statePath, stamped);
    return stamped;
  });
}

export function advanceUltragoal({ projectRoot = process.cwd(), sessionId, id, to }) {
  if (!ULTRAGOAL_STATUSES.includes(to)) {
    throw new UltragoalStateError('UNKNOWN_PHASE', `unknown phase "${String(to)}"`);
  }
  return transitionUltragoal({ projectRoot, sessionId, id }, (state) => {
    const allowed = TRANSITIONS[state.phase];
    if (!allowed.has(to)) {
      throw new UltragoalStateError(
        'INVALID_TRANSITION',
        `cannot transition from "${state.phase}" to "${to}"`,
        { from: state.phase, to },
      );
    }
    const from = state.phase;
    state.phase = to;
    state.history.push(historyEntry({ revision: state.revision, event: 'advance', from, to, at: state.updatedAt }));
    return state;
  });
}

/**
 * Resume a `blocked` run by returning to `executing`. This is the
 * non-terminal escape hatch; any other path goes through
 * `advanceUltragoal`.
 */
export function resumeUltragoal({ projectRoot = process.cwd(), sessionId, id, note }) {
  return transitionUltragoal({ projectRoot, sessionId, id }, (state) => {
    assert(state.phase === 'blocked', 'NOT_BLOCKED', `ultragoal is not blocked (phase=${state.phase})`);
    const from = state.phase;
    state.phase = 'executing';
    const reason = typeof note === 'string' && note.trim() ? note.trim().slice(0, 256) : 'resumed by operator';
    state.history.push(historyEntry({
      revision: state.revision,
      event: 'resume',
      from,
      to: 'executing',
      at: state.updatedAt,
      payloadHash: sha256(reason),
    }));
    return state;
  });
}

export function steerUltragoal({ projectRoot = process.cwd(), sessionId, id, action, payload }) {
  if (!ULTRAGOAL_ACTIONS.includes(action)) {
    throw new UltragoalStateError('UNKNOWN_ACTION', `unknown steer action "${String(action)}"`);
  }
  return transitionUltragoal({ projectRoot, sessionId, id }, (state) => {
    if (ULTRAGOAL_TERMINAL_STATUSES.includes(state.phase)) {
      throw new UltragoalStateError('TERMINAL', `cannot steer a ${state.phase} ultragoal`);
    }
    if (!payload || typeof payload !== 'object') {
      throw new UltragoalStateError('PAYLOAD_REQUIRED', 'a payload object is required');
    }
    const at = state.updatedAt;
    if (action === 'add_subgoal') {
      const subgoalId = String(payload.id ?? '').trim();
      assert(subgoalId.length > 0 && subgoalId.length <= 128, 'INVALID_SUBGOAL', 'subgoal id is invalid');
      assert(!state.subgoals[subgoalId], 'SUBGOAL_EXISTS', `subgoal "${subgoalId}" already exists`);
      assert(
        Object.keys(state.subgoals).length + 1 <= ULTRAGOAL_LIMITS.maxSubgoals,
        'SUBGOAL_LIMIT',
        `adding subgoal would exceed limit of ${ULTRAGOAL_LIMITS.maxSubgoals}`,
      );
      state.subgoals[subgoalId] = Object.freeze({
        id: subgoalId,
        title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim().slice(0, 256) : subgoalId,
        status: 'pending',
        createdAt: at,
      });
      state.history.push(historyEntry({
        revision: state.revision,
        event: 'steer:add_subgoal',
        from: state.phase,
        to: state.phase,
        at,
        payloadHash: sha256(`${subgoalId}`),
      }));
    } else if (action === 'split_subgoal') {
      const sourceId = String(payload.id ?? '').trim();
      assert(sourceId.length > 0, 'INVALID_SUBGOAL', 'subgoal id is required');
      const source = state.subgoals[sourceId];
      assert(source, 'SUBGOAL_MISSING', `subgoal "${sourceId}" does not exist`);
      const replacement = Array.isArray(payload.replacement) ? payload.replacement : [];
      assert(replacement.length >= 1 && replacement.length <= 8, 'INVALID_SPLIT', 'replacement must contain 1-8 subgoal ids');
      for (const newId of replacement) {
        const idStr = String(newId).trim();
        assert(idStr.length > 0 && idStr.length <= 128, 'INVALID_SUBGOAL', 'replacement id is invalid');
        assert(!state.subgoals[idStr], 'SUBGOAL_EXISTS', `replacement subgoal "${idStr}" already exists`);
      }
      assert(
        Object.keys(state.subgoals).length - 1 + replacement.length <= ULTRAGOAL_LIMITS.maxSubgoals,
        'SUBGOAL_LIMIT',
        `splitting would exceed limit of ${ULTRAGOAL_LIMITS.maxSubgoals}`,
      );
      delete state.subgoals[sourceId];
      for (const newId of replacement) {
        const idStr = String(newId).trim();
        state.subgoals[idStr] = Object.freeze({
          id: idStr,
          title: idStr,
          status: 'pending',
          createdAt: at,
        });
      }
      state.history.push(historyEntry({
        revision: state.revision,
        event: 'steer:split_subgoal',
        from: state.phase,
        to: state.phase,
        at,
        payloadHash: sha256(`${sourceId}|${replacement.join(',')}`),
      }));
    }
    return state;
  });
}

export function checkpointUltragoal({ projectRoot = process.cwd(), sessionId, id, note }) {
  return transitionUltragoal({ projectRoot, sessionId, id }, (state) => {
    const at = state.updatedAt;
    const reason = typeof note === 'string' && note.trim() ? note.trim().slice(0, 256) : 'checkpoint';
    state.checkpointLog.push({ at, note: reason, phase: state.phase });
    if (state.checkpointLog.length > ULTRAGOAL_LIMITS.maxCheckpointLogEntries) {
      state.checkpointLog = state.checkpointLog.slice(-ULTRAGOAL_LIMITS.maxCheckpointLogEntries);
    }
    state.history.push(historyEntry({
      revision: state.revision,
      event: 'checkpoint',
      from: state.phase,
      to: state.phase,
      at,
      payloadHash: sha256(reason),
    }));
    return state;
  });
}

export function failUltragoal({ projectRoot = process.cwd(), sessionId, id, reason }) {
  const trimmed = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 256) : 'failed by operator';
  return transitionUltragoal({ projectRoot, sessionId, id }, (state) => {
    const from = state.phase;
    state.phase = 'failed';
    state.history.push(historyEntry({
      revision: state.revision,
      event: 'fail',
      from,
      to: 'failed',
      at: state.updatedAt,
      payloadHash: sha256(trimmed),
    }));
    return state;
  });
}

export function cancelUltragoal({ projectRoot = process.cwd(), sessionId, id, reason }) {
  const trimmed = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 256) : 'cancelled by operator';
  return transitionUltragoal({ projectRoot, sessionId, id }, (state) => {
    const from = state.phase;
    state.phase = 'cancelled';
    state.history.push(historyEntry({
      revision: state.revision,
      event: 'cancel',
      from,
      to: 'cancelled',
      at: state.updatedAt,
      payloadHash: sha256(trimmed),
    }));
    return state;
  });
}
