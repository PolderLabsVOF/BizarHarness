/**
 * Run-scoped assignment snapshot for Bizar workflow state integrity.
 *
 * Static-alias cutover (omniRoute alias routing overhaul): the
 * dispatcher now selects one of four native aliases (`haiku`,
 * `sonnet`, `opus`, `fable`) per task shape. There is no model
 * router, no dynamic tier selection, and no model registry. This
 * module preserves a stable, fingerprint-signed assignment record
 * so workflow state can detect tampering or run drift, but it
 * records the agent list and a static alias policy only — it no
 * longer resolves model IDs or gateway endpoints.
 */
import { createHash } from 'node:crypto';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

const ALIASES = Object.freeze(['haiku', 'sonnet', 'opus', 'fable']);

function defaultAliasFor(role) {
  // Hard / debug / architectural / orchestration lanes default to opus;
  // the rest (small lookups, support tech, executors) use sonnet.
  const opusRoles = new Set(['mike', 'adversarial', 'architect', 'qa', 'security', 'reviewer', 'planner']);
  if (opusRoles.has(role)) return 'opus';
  return 'sonnet';
}

/**
 * Create a stable, fingerprint-signed record of which agents participate
 * in this run and which static alias they will dispatch through. The
 * fingerprint detects tampering in stored workflow state.
 */
export function createRunAssignmentSnapshot({
  runId,
  agentNames,
  createdAt,
} = {}) {
  if (typeof runId !== 'string' || !runId.trim()) fail('RUN_ID_REQUIRED', 'A non-empty runId is required for an assignment snapshot.');
  if (!Array.isArray(agentNames)) fail('AGENT_NAMES_REQUIRED', 'agentNames must be an array of role names.');
  const decisions = {};
  for (const role of agentNames) {
    if (typeof role !== 'string' || !role.trim()) fail('INVALID_AGENT_NAME', 'Each agent name must be a non-empty string.');
    const alias = defaultAliasFor(role.trim());
    decisions[role.trim()] = Object.freeze({
      tier: 'static-alias',
      alias,
      model: alias,
      inheritSession: false,
      reason: 'static-alias',
    });
  }
  const payload = {
    runId: runId.trim(),
    routerVersion: 'static-alias-v1',
    gatewayEndpoint: null,
    availabilityProbe: null,
    discoveryAttempted: false,
    decisions,
    createdAt,
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return deepFreeze({ ...payload, fingerprint });
}

export function verifyRunAssignmentSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.fingerprint !== 'string') return false;
  const { fingerprint, ...payload } = snapshot;
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex') === fingerprint;
}

export const snapshotAssignments = createRunAssignmentSnapshot;
export { ALIASES };
