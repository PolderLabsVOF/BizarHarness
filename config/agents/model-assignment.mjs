/**
 * Strict, immutable model assignments for one Bizar orchestration run.
 *
 * Claude Code accepts full model IDs in agent frontmatter, but environment or
 * per-invocation overrides can otherwise take precedence. Bizar therefore
 * snapshots the exact registry assignment before dispatch. Callers must pass
 * the model IDs reported by the configured gateway; missing agents and models
 * fail instead of falling back to a different provider or inherited model.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEFAULT_MODEL_ROUTER_PATH = resolve(ROOT, 'config', 'claude', 'model-router.json');

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertStrictRegistry(registry) {
  if (
    !registry?.gateway?.required
    || !registry?.policies?.requireConfiguredGateway
    || typeof registry?.gateway?.endpoint !== 'string'
    || registry.gateway.endpoint === ''
    || typeof registry?.gateway?.availabilityProbe !== 'string'
    || registry.gateway.availabilityProbe === ''
  ) {
    fail('GATEWAY_NOT_REQUIRED', 'The model registry must require its configured gateway and availability probe.');
  }
  if (!registry?.gateway?.exactModelRequired || !registry?.policies?.requireExactRequestedModel) {
    fail('EXACT_MODEL_NOT_REQUIRED', 'The model registry must require exact requested model IDs.');
  }
  if (registry.endpoint !== registry.gateway.endpoint) {
    fail('GATEWAY_ENDPOINT_DRIFT', 'The compatibility endpoint must match the configured gateway endpoint.');
  }
  if (registry?.policies?.rejectDispatchModelOverride !== true) {
    fail('MODEL_OVERRIDE_ENABLED', 'Dispatch-time model overrides must be rejected.');
  }
  if (registry?.policies?.silentFallback !== false || registry?.gateway?.unavailableBehavior !== 'fail') {
    fail('SILENT_FALLBACK_ENABLED', 'Silent model fallback must remain disabled.');
  }
  if (Array.isArray(registry?.policies?.fallback_chain) && registry.policies.fallback_chain.length > 0) {
    fail('SILENT_FALLBACK_ENABLED', 'The model fallback chain must remain empty.');
  }
  if (registry?.policies?.assignmentSnapshot !== 'immutable-per-run') {
    fail('ASSIGNMENT_SNAPSHOT_REQUIRED', 'The registry must require immutable per-run assignments.');
  }
  if (!registry.agents || typeof registry.agents !== 'object') {
    fail('MODEL_REGISTRY_INVALID', 'The model registry has no agent assignments.');
  }
  return registry;
}

export function loadModelRouter(path = DEFAULT_MODEL_ROUTER_PATH) {
  let registry;
  try {
    registry = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail('MODEL_REGISTRY_INVALID', `Cannot load model registry at ${path}: ${error.message}`);
  }

  return assertStrictRegistry(registry);
}

/**
 * Create the canonical schemaVersion 1 frozen assignment record for one run.
 *
 * `availableModelIds` must come from a successful availability probe against
 * the configured gateway. It is deliberately mandatory: without fresh
 * availability evidence Bizar cannot promise the requested provider/model.
 * Snapshot assignments use the `model` key consumed by workflow state and the
 * Agent guard; the SDK produces the identical payload and fingerprint.
 */
export function createRunAssignmentSnapshot({
  runId,
  agentNames,
  availableModelIds,
  registry = loadModelRouter(),
  createdAt = new Date().toISOString(),
}) {
  assertStrictRegistry(registry);
  if (typeof runId !== 'string' || runId.trim() === '') {
    fail('RUN_ID_REQUIRED', 'A non-empty runId is required for a model assignment snapshot.');
  }
  if (!availableModelIds || typeof availableModelIds[Symbol.iterator] !== 'function') {
    fail('GATEWAY_AVAILABILITY_REQUIRED', 'Gateway model availability evidence is required.');
  }

  const available = new Set(availableModelIds);
  if (available.size === 0) {
    fail('GATEWAY_UNAVAILABLE', 'The configured gateway returned no available models.');
  }

  const requested = agentNames === undefined
    ? Object.keys(registry.agents)
    : Array.from(agentNames);
  if (requested.length === 0) {
    fail('AGENT_ASSIGNMENT_REQUIRED', 'At least one agent assignment is required.');
  }
  if (new Set(requested).size !== requested.length) {
    fail('DUPLICATE_AGENT_ASSIGNMENT', 'Each agent may appear only once in a run snapshot.');
  }

  const assignments = {};
  for (const agent of requested) {
    const configured = registry.agents[agent];
    if (!configured) {
      fail('UNKNOWN_AGENT', `No exact model assignment exists for agent ${agent}.`);
    }
    if (typeof configured.model !== 'string' || configured.model === '') {
      fail('MODEL_ASSIGNMENT_INVALID', `Agent ${agent} has no exact model ID.`);
    }
    if (!available.has(configured.model)) {
      fail(
        'REQUESTED_MODEL_UNAVAILABLE',
        `Configured model ${configured.model} for agent ${agent} is unavailable; refusing silent fallback.`,
      );
    }
    assignments[agent] = {
      model: configured.model,
      tier: configured.tier,
      rationale: configured.rationale,
    };
  }

  const payload = {
    schemaVersion: 1,
    runId,
    createdAt,
    routerVersion: registry.version,
    gatewayEndpoint: registry.gateway.endpoint,
    availabilityProbe: registry.gateway.availabilityProbe,
    assignments,
  };
  const fingerprint = createHash('sha256').update(stableJson(payload)).digest('hex');
  return deepFreeze({ ...payload, fingerprint });
}

export function verifyRunAssignmentSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.fingerprint !== 'string') return false;
  const { fingerprint, ...payload } = snapshot;
  const expected = createHash('sha256').update(stableJson(payload)).digest('hex');
  return fingerprint === expected;
}
