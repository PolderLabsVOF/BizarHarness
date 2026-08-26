import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  lstatSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  createRunAssignmentSnapshot,
  verifyRunAssignmentSnapshot,
} from '../../config/agents/model-assignment.mjs';

export const WORKFLOW_STAGES = Object.freeze([
  'research',
  'plan',
  'execute',
  'qa',
  'validate',
]);

export const WORKFLOW_PROFILES = Object.freeze({
  default: Object.freeze({
    id: 'default',
    description: 'Research, plan, execute, QA, and validate with bounded retries.',
    execution: Object.freeze({ strategy: 'task-waves', maxParallelAgents: 3 }),
  }),
  'plan-build-qa': Object.freeze({
    id: 'plan-build-qa',
    description: 'Plan-led build with a dedicated QA and validation gate.',
    execution: Object.freeze({ strategy: 'plan-build-qa', maxParallelAgents: 5 }),
  }),
});

export const WORKFLOW_LIMITS = Object.freeze({
  maxQaCycles: 5,
  sameQaFailureThreshold: 3,
  maxValidationRounds: 3,
});

export const WORKFLOW_STATUSES = Object.freeze([
  'active',
  'completed',
  'failed',
  'cancelled',
]);

const SCHEMA_VERSION = 1;
const MODE = 'autopilot';
const LOCK_STALE_MS = 30_000;
const MAX_REASON_LENGTH = 1_024;
export const MAX_WORKFLOW_GOAL_LENGTH = 4_096;
export const MAX_WORKFLOW_EVIDENCE_LENGTH = 4_096;

export class WorkflowStateError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'WorkflowStateError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeBoundedInput(value, { name, maxLength }) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WorkflowStateError(`${name.toUpperCase()}_REQUIRED`, `a non-empty ${name} is required`);
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length > maxLength) {
    throw new WorkflowStateError(
      `${name.toUpperCase()}_TOO_LONG`,
      `${name} must not exceed ${maxLength} characters`,
      { maxLength },
    );
  }
  return normalized;
}

function privateInputRecord(value) {
  return Object.freeze({ hash: sha256(value), length: value.length });
}

function hashValue(value) {
  return sha256(canonicalJson(value));
}

export function createWorkflowDescriptor(profile = 'default') {
  const profileDefinition = WORKFLOW_PROFILES[profile];
  if (!profileDefinition) {
    throw new WorkflowStateError(
      'INVALID_PROFILE',
      `unknown workflow profile: ${profile}`,
      { allowed: Object.keys(WORKFLOW_PROFILES) },
    );
  }
  const descriptor = {
    mode: MODE,
    profile: profileDefinition,
    stages: [...WORKFLOW_STAGES],
    limits: { ...WORKFLOW_LIMITS },
  };
  return Object.freeze({
    ...descriptor,
    profile: Object.freeze({ ...profileDefinition }),
    stages: Object.freeze(descriptor.stages),
    limits: Object.freeze(descriptor.limits),
  });
}

function descriptorHash(descriptor) {
  return hashValue(descriptor);
}

function stateHash(state) {
  const { stateHash: _ignored, ...hashable } = state;
  return hashValue(hashable);
}

function withStateHash(state) {
  return { ...state, stateHash: stateHash(state) };
}

export function normalizeSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new WorkflowStateError(
      'SESSION_REQUIRED',
      'a non-empty Claude session id is required',
    );
  }
  const value = sessionId.trim();
  if (
    value.length > 128 ||
    value === '.' ||
    value === '..' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  ) {
    throw new WorkflowStateError(
      'INVALID_SESSION',
      'session id must be 1-128 safe filename characters and cannot contain path separators',
    );
  }
  return value;
}

export function resolveProjectRoot(projectRoot = process.cwd()) {
  const absolute = resolve(projectRoot);
  if (!existsSync(absolute)) {
    throw new WorkflowStateError('INVALID_PROJECT', `project root does not exist: ${absolute}`);
  }
  return realpathSync(absolute);
}

function assertContained(root, candidate) {
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(candidate) === resolve(root)) {
    throw new WorkflowStateError('UNSAFE_PATH', 'workflow state path escaped its state root');
  }
}

function rejectSymlink(path, label) {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new WorkflowStateError(
        'UNSAFE_STATE_PATH',
        `${label} must not be a symbolic link: ${path}`,
      );
    }
  } catch (error) {
    if (error instanceof WorkflowStateError) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
}

function assertSafeStatePaths(paths) {
  const bizarDir = join(paths.projectRoot, '.bizar');
  const stateDir = join(bizarDir, 'state');
  rejectSymlink(bizarDir, '.bizar');
  rejectSymlink(stateDir, '.bizar/state');
  rejectSymlink(paths.stateRoot, '.bizar/state/sessions');
  rejectSymlink(paths.sessionDir, 'workflow session directory');
  rejectSymlink(paths.statePath, 'workflow state file');
  rejectSymlink(paths.lockPath, 'workflow lock file');
}

export function resolveWorkflowPaths({ projectRoot = process.cwd(), sessionId }) {
  const project = resolveProjectRoot(projectRoot);
  const session = normalizeSessionId(sessionId);
  const stateRoot = join(project, '.bizar', 'state', 'sessions');
  const sessionDir = join(stateRoot, session);
  const statePath = join(sessionDir, `${MODE}.json`);
  assertContained(stateRoot, sessionDir);
  assertContained(stateRoot, statePath);
  const paths = {
    projectRoot: project,
    sessionId: session,
    stateRoot,
    sessionDir,
    statePath,
    lockPath: `${statePath}.lock`,
  };
  assertSafeStatePaths(paths);
  return Object.freeze(paths);
}

function writeAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
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
        // A racing owner may have removed the lock; retry once.
        stale = true;
      }
      if (stale && attempt === 0) {
        rmSync(lockPath, { force: true });
        continue;
      }
      throw new WorkflowStateError(
        'WORKFLOW_BUSY',
        'another workflow operation is already in progress for this session',
      );
    }
  }
  throw new WorkflowStateError('WORKFLOW_BUSY', 'workflow state is locked');
}

function withLock(paths, operation) {
  assertSafeStatePaths(paths);
  mkdirSync(paths.sessionDir, { recursive: true, mode: 0o700 });
  // Recheck after directory creation and immediately before opening the lock.
  // This narrows the local symlink-swap window and guarantees every normal
  // read/write path refuses pre-existing linked ancestors.
  assertSafeStatePaths(paths);
  const fd = acquireLock(paths.lockPath);
  try {
    return operation();
  } finally {
    closeSync(fd);
    rmSync(paths.lockPath, { force: true });
  }
}

function isIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function assert(condition, code, message) {
  if (!condition) throw new WorkflowStateError(code, message);
}

export function validateWorkflowState(state, context) {
  assert(state && typeof state === 'object' && !Array.isArray(state), 'INVALID_STATE', 'workflow state must be an object');
  assert(state.schemaVersion === SCHEMA_VERSION, 'INVALID_STATE', 'unsupported workflow state schema');
  assert(state.mode === MODE, 'INVALID_STATE', 'workflow mode must be autopilot');
  assert(typeof state.runId === 'string' && /^[0-9a-f-]{36}$/i.test(state.runId), 'INVALID_STATE', 'workflow run id is invalid');
  assert(state.sessionId === context.sessionId, 'FOREIGN_SESSION', 'workflow state belongs to a different session');
  assert(state.projectRoot === context.projectRoot, 'FOREIGN_PROJECT', 'workflow state belongs to a different project');
  assert(Object.hasOwn(WORKFLOW_PROFILES, state.profile), 'INVALID_STATE', 'workflow profile is invalid');
  assert(WORKFLOW_STATUSES.includes(state.status), 'INVALID_STATE', 'workflow status is invalid');
  assert(WORKFLOW_STAGES.includes(state.stage), 'INVALID_STATE', 'workflow stage is invalid');
  assert(Number.isSafeInteger(state.revision) && state.revision >= 1, 'INVALID_STATE', 'workflow revision is invalid');
  assert(isIsoDate(state.startedAt) && isIsoDate(state.updatedAt), 'INVALID_STATE', 'workflow timestamps are invalid');
  assert(typeof state.goalHash === 'string' && /^[0-9a-f]{64}$/.test(state.goalHash), 'INVALID_STATE', 'workflow goal hash is invalid');
  assert(Number.isSafeInteger(state.goalLength) && state.goalLength > 0 && state.goalLength <= MAX_WORKFLOW_GOAL_LENGTH, 'INVALID_STATE', 'workflow goal length is invalid');
  assert(state.descriptor && typeof state.descriptor === 'object', 'INVALID_STATE', 'workflow descriptor is missing');
  const expectedDescriptor = createWorkflowDescriptor(state.profile);
  assert(canonicalJson(state.descriptor) === canonicalJson(expectedDescriptor), 'DESCRIPTOR_MISMATCH', 'workflow descriptor is not canonical');
  assert(state.descriptorHash === descriptorHash(expectedDescriptor), 'DESCRIPTOR_MISMATCH', 'workflow descriptor hash is invalid');
  assert(state.assignmentSnapshot && typeof state.assignmentSnapshot === 'object', 'INVALID_STATE', 'model assignment snapshot is missing');
  assert(state.assignmentSnapshot.runId === state.runId, 'ASSIGNMENT_RUN_MISMATCH', 'model assignment snapshot belongs to a different run');
  assert(verifyRunAssignmentSnapshot(state.assignmentSnapshot), 'ASSIGNMENT_INTEGRITY_ERROR', 'model assignment snapshot fingerprint is invalid');
  assert(
    state.assignmentSnapshot.gatewayEndpoint === null || (
      typeof state.assignmentSnapshot.gatewayEndpoint === 'string' &&
      state.assignmentSnapshot.gatewayEndpoint.length > 0 &&
      state.assignmentSnapshot.gatewayEndpoint.trim() === state.assignmentSnapshot.gatewayEndpoint
    ),
    'INVALID_STATE',
    'routing snapshot gateway endpoint is invalid',
  );
  assert(
    state.assignmentSnapshot.availabilityProbe === null || (
      typeof state.assignmentSnapshot.availabilityProbe === 'string' &&
      state.assignmentSnapshot.availabilityProbe.length > 0 &&
      state.assignmentSnapshot.availabilityProbe.trim() === state.assignmentSnapshot.availabilityProbe
    ),
    'INVALID_STATE',
    'routing snapshot availability probe is invalid',
  );
  assert(
    state.assignmentSnapshot.decisions &&
      typeof state.assignmentSnapshot.decisions === 'object' &&
      !Array.isArray(state.assignmentSnapshot.decisions),
    'INVALID_STATE',
    'routing decision snapshot is invalid',
  );
  for (const [agent, decision] of Object.entries(state.assignmentSnapshot.decisions)) {
    assert(typeof agent === 'string' && agent.length > 0, 'INVALID_STATE', 'routing decision agent is invalid');
    assert(decision && typeof decision === 'object', 'INVALID_STATE', `routing decision for ${agent} is invalid`);
    assert(typeof decision.tier === 'string' && decision.tier.length > 0, 'INVALID_STATE', `routing tier for ${agent} is invalid`);
    assert(decision.model === null || (typeof decision.model === 'string' && decision.model.length > 0), 'INVALID_STATE', `routing model for ${agent} is invalid`);
    assert(typeof decision.inheritSession === 'boolean', 'INVALID_STATE', `routing inheritance for ${agent} is invalid`);
  }
  deepFreeze(state.assignmentSnapshot);
  assert(state.attempts && typeof state.attempts === 'object', 'INVALID_STATE', 'workflow attempt counters are missing');
  assert(Number.isSafeInteger(state.attempts.qaCycles) && state.attempts.qaCycles >= 0 && state.attempts.qaCycles <= WORKFLOW_LIMITS.maxQaCycles, 'INVALID_STATE', 'QA cycle counter is invalid');
  assert(Number.isSafeInteger(state.attempts.validationRounds) && state.attempts.validationRounds >= 0 && state.attempts.validationRounds <= WORKFLOW_LIMITS.maxValidationRounds, 'INVALID_STATE', 'validation round counter is invalid');
  assert(Number.isSafeInteger(state.attempts.sameQaFailureCount) && state.attempts.sameQaFailureCount >= 0 && state.attempts.sameQaFailureCount <= WORKFLOW_LIMITS.sameQaFailureThreshold, 'INVALID_STATE', 'same-failure counter is invalid');
  assert(state.evidenceByStage && typeof state.evidenceByStage === 'object' && !Array.isArray(state.evidenceByStage), 'INVALID_STATE', 'workflow evidence map is missing');
  assert(Object.keys(state.evidenceByStage).length === WORKFLOW_STAGES.length, 'INVALID_STATE', 'workflow evidence map is invalid');
  for (const stage of WORKFLOW_STAGES) {
    const evidence = state.evidenceByStage[stage];
    assert(evidence === null || (
      typeof evidence === 'object' &&
      typeof evidence.hash === 'string' && /^[0-9a-f]{64}$/.test(evidence.hash) &&
      Number.isSafeInteger(evidence.length) && evidence.length > 0 && evidence.length <= MAX_WORKFLOW_EVIDENCE_LENGTH &&
      Number.isSafeInteger(evidence.revision) && evidence.revision >= 2 &&
      isIsoDate(evidence.recordedAt)
    ), 'INVALID_STATE', `workflow evidence for ${stage} is invalid`);
  }
  assert(typeof state.stateHash === 'string' && state.stateHash === stateHash(state), 'INTEGRITY_ERROR', 'workflow state integrity check failed');
  return state;
}

function readState(paths) {
  if (!existsSync(paths.statePath)) {
    throw new WorkflowStateError('NOT_FOUND', 'no autopilot workflow exists for this session');
  }
  let state;
  try {
    state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
  } catch (error) {
    throw new WorkflowStateError('INVALID_STATE', `cannot read workflow state: ${error.message}`);
  }
  return validateWorkflowState(state, paths);
}

function historyEntry({ revision, event, from, to, at, reasonHash = null }) {
  return { revision, event, from, to, at, ...(reasonHash ? { reasonHash } : {}) };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function startWorkflow({
  projectRoot = process.cwd(),
  sessionId,
  profile = 'default',
  goal,
  availableModelIds,
  registry,
  requiredAgents,
  now = new Date(),
}) {
  const paths = resolveWorkflowPaths({ projectRoot, sessionId });
  const descriptor = createWorkflowDescriptor(profile);
  const normalizedGoal = normalizeBoundedInput(goal, { name: 'goal', maxLength: MAX_WORKFLOW_GOAL_LENGTH });
  const goalRecord = privateInputRecord(normalizedGoal);
  const runId = randomUUID();
  let assignmentSnapshot;
  try {
    assignmentSnapshot = createRunAssignmentSnapshot({
      runId,
      agentNames: requiredAgents,
      availableModelIds,
      registry,
      createdAt: now.toISOString(),
    });
  } catch (error) {
    if (error instanceof WorkflowStateError) throw error;
    throw new WorkflowStateError(
      typeof error?.code === 'string' ? error.code : 'MODEL_ASSIGNMENT_ERROR',
      error?.message || String(error),
    );
  }
  return withLock(paths, () => {
    if (existsSync(paths.statePath)) {
      const current = readState(paths);
      if (current.status === 'active') {
        throw new WorkflowStateError(
          'ALREADY_ACTIVE',
          'an autopilot workflow is already active for this session',
          { runId: current.runId, revision: current.revision, stage: current.stage },
        );
      }
    }
    const timestamp = now.toISOString();
    const state = withStateHash({
      schemaVersion: SCHEMA_VERSION,
      mode: MODE,
      runId,
      sessionId: paths.sessionId,
      projectRoot: paths.projectRoot,
      profile,
      descriptor,
      descriptorHash: descriptorHash(descriptor),
      assignmentSnapshot,
      goalHash: goalRecord.hash,
      goalLength: goalRecord.length,
      status: 'active',
      stage: WORKFLOW_STAGES[0],
      revision: 1,
      startedAt: timestamp,
      updatedAt: timestamp,
      terminalAt: null,
      terminalReasonHash: null,
      attempts: {
        qaCycles: 0,
        validationRounds: 0,
        sameQaFailureCount: 0,
        lastQaFailureHash: null,
      },
      evidenceByStage: Object.fromEntries(WORKFLOW_STAGES.map((stage) => [stage, null])),
      history: [historyEntry({ revision: 1, event: 'start', from: null, to: WORKFLOW_STAGES[0], at: timestamp })],
    });
    writeAtomic(paths.statePath, state);
    return state;
  });
}

export function getWorkflowState({ projectRoot = process.cwd(), sessionId }) {
  return readState(resolveWorkflowPaths({ projectRoot, sessionId }));
}

function requireExpected(expected) {
  if (!expected || typeof expected !== 'object') {
    throw new WorkflowStateError('EXPECTED_REQUIRED', 'run id, revision, and stage are required for workflow transitions');
  }
  assert(typeof expected.runId === 'string' && expected.runId, 'EXPECTED_REQUIRED', 'expected run id is required');
  assert(Number.isSafeInteger(expected.revision) && expected.revision >= 1, 'EXPECTED_REQUIRED', 'expected revision is required');
  assert(WORKFLOW_STAGES.includes(expected.stage), 'EXPECTED_REQUIRED', 'expected stage is required');
}

function compareExpected(current, expected) {
  requireExpected(expected);
  if (current.runId !== expected.runId) {
    throw new WorkflowStateError('RUN_CONFLICT', 'workflow run id does not match', { current: current.runId });
  }
  if (current.revision !== expected.revision) {
    throw new WorkflowStateError('STALE_REVISION', 'workflow revision does not match', { current: current.revision });
  }
  if (current.stage !== expected.stage) {
    throw new WorkflowStateError('STAGE_CONFLICT', 'workflow stage does not match', { current: current.stage });
  }
  if (current.status !== 'active') {
    throw new WorkflowStateError('TERMINAL', `workflow is already ${current.status}`);
  }
}

function transition({ projectRoot = process.cwd(), sessionId, expected, now = new Date() }, mutate) {
  const paths = resolveWorkflowPaths({ projectRoot, sessionId });
  return withLock(paths, () => {
    const current = readState(paths);
    compareExpected(current, expected);
    const timestamp = now.toISOString();
    const revision = current.revision + 1;
    const next = mutate(structuredClone(current), { timestamp, revision });
    next.revision = revision;
    next.updatedAt = timestamp;
    next.history = next.history.slice(-63);
    const complete = withStateHash(next);
    validateWorkflowState(complete, paths);
    writeAtomic(paths.statePath, complete);
    return complete;
  });
}

export function advanceWorkflow(options) {
  const evidence = normalizeBoundedInput(options.evidence, {
    name: 'evidence',
    maxLength: MAX_WORKFLOW_EVIDENCE_LENGTH,
  });
  const evidenceRecord = privateInputRecord(evidence);
  return transition(options, (state, { timestamp, revision }) => {
    const index = WORKFLOW_STAGES.indexOf(state.stage);
    const from = state.stage;
    state.evidenceByStage[from] = {
      ...evidenceRecord,
      revision,
      recordedAt: timestamp,
    };
    if (index === WORKFLOW_STAGES.length - 1) {
      state.status = 'completed';
      state.terminalAt = timestamp;
      state.terminalReasonHash = null;
      state.history.push(historyEntry({ revision, event: 'complete', from, to: from, at: timestamp }));
      return state;
    }
    state.stage = WORKFLOW_STAGES[index + 1];
    if (state.stage === 'qa') state.attempts.qaCycles = 1;
    if (state.stage === 'validate') state.attempts.validationRounds = 1;
    state.history.push(historyEntry({ revision, event: 'advance', from, to: state.stage, at: timestamp }));
    return state;
  });
}

function normalizeReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new WorkflowStateError('REASON_REQUIRED', 'a non-empty failure reason is required');
  }
  return reason.trim().slice(0, MAX_REASON_LENGTH);
}

function markFailed(state, { timestamp, revision }, reason, reasonHash) {
  const stage = state.stage;
  state.status = 'failed';
  state.terminalAt = timestamp;
  state.terminalReasonHash = reasonHash;
  state.history.push(historyEntry({ revision, event: 'fail', from: stage, to: stage, at: timestamp, reasonHash }));
  return state;
}

export function failWorkflow(options) {
  const reason = normalizeReason(options.reason);
  const failureHash = sha256(reason);
  return transition(options, (state, meta) => {
    if (state.stage === 'qa') {
      const sameFailure = state.attempts.lastQaFailureHash === failureHash;
      state.attempts.sameQaFailureCount = sameFailure
        ? state.attempts.sameQaFailureCount + 1
        : 1;
      state.attempts.lastQaFailureHash = failureHash;
      const exhausted =
        state.attempts.qaCycles >= WORKFLOW_LIMITS.maxQaCycles ||
        state.attempts.sameQaFailureCount >= WORKFLOW_LIMITS.sameQaFailureThreshold;
      if (exhausted) return markFailed(state, meta, reason, failureHash);
      state.attempts.qaCycles += 1;
      state.history.push(historyEntry({
        revision: meta.revision,
        event: 'qa-retry',
        from: 'qa',
        to: 'qa',
        at: meta.timestamp,
        reasonHash: failureHash,
      }));
      return state;
    }
    if (state.stage === 'validate') {
      if (state.attempts.validationRounds >= WORKFLOW_LIMITS.maxValidationRounds) {
        return markFailed(state, meta, reason, failureHash);
      }
      state.attempts.validationRounds += 1;
      state.history.push(historyEntry({
        revision: meta.revision,
        event: 'validation-retry',
        from: 'validate',
        to: 'validate',
        at: meta.timestamp,
        reasonHash: failureHash,
      }));
      return state;
    }
    return markFailed(state, meta, reason, failureHash);
  });
}

export function cancelWorkflow(options) {
  const reason = typeof options.reason === 'string' && options.reason.trim()
    ? options.reason.trim().slice(0, MAX_REASON_LENGTH)
    : 'cancelled by operator';
  return transition(options, (state, { timestamp, revision }) => {
    const stage = state.stage;
    state.status = 'cancelled';
    state.terminalAt = timestamp;
    state.terminalReasonHash = sha256(reason);
    state.history.push(historyEntry({ revision, event: 'cancel', from: stage, to: stage, at: timestamp }));
    return state;
  });
}

export function resumeWorkflow({ projectRoot = process.cwd(), sessionId }) {
  const state = getWorkflowState({ projectRoot, sessionId });
  if (state.status !== 'active') {
    throw new WorkflowStateError('TERMINAL', `cannot resume a ${state.status} workflow`);
  }
  return state;
}
