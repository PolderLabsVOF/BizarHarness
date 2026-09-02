/**
 * Dynamic model-tier selection for Bizar orchestration.
 *
 * Agent roles are model-agnostic. Mike selects a tier per dispatch from task
 * risk/complexity, then chooses the first enabled configured model in that
 * tier. A missing discovery response must not make dispatch omit its model
 * override: that would inherit an unconfigured provider default.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolveGlobalModelRouter } from '../../cli/config-paths.mjs';

/** Resolve the single operator-owned router at call time, never from a repo. */
export function defaultModelRouterPath() {
  return resolveGlobalModelRouter();
}

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

function normalizeModelIds(values) {
  return Array.isArray(values)
    ? [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
    : [];
}

function assertDynamicRegistry(registry) {
  if (!registry || typeof registry !== 'object') fail('MODEL_REGISTRY_INVALID', 'The model router must be an object.');
  if (!registry.tiers || typeof registry.tiers !== 'object' || Object.keys(registry.tiers).length === 0) {
    fail('MODEL_REGISTRY_INVALID', 'The model router must define at least one dynamic tier.');
  }
  const policies = registry.policies || {};
  if (policies.selectionOwner !== 'orchestrator') fail('MODEL_POLICY_INVALID', 'The orchestrator must own model selection.');
  if (!['configured-tier-fallback', 'inherit-session'].includes(policies.discoveryFailure)
    || !['configured-tier-fallback', 'inherit-session'].includes(policies.unavailableModel)) {
    fail('MODEL_POLICY_INVALID', 'Discovery and unavailable-model failures must use the configured-tier fallback.');
  }
  if (policies.retryModelAliases !== false || policies.maxDispatchModelAttempts !== 1) {
    fail('MODEL_POLICY_INVALID', 'Model alias retries are forbidden; each dispatch gets one model attempt.');
  }
  return registry;
}

export function loadModelRouter(path = defaultModelRouterPath()) {
  try {
    return assertDynamicRegistry(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    if (error?.code) throw error;
    fail('MODEL_REGISTRY_INVALID', `Cannot load model router at ${path}: ${error.message}`);
  }
}

export function resolveDispatchModel({
  agent,
  tier,
  availableModelIds,
  registry = loadModelRouter(),
} = {}) {
  const chosenTier = tier || registry.roleDefaults?.[agent] || 'default';
  const definition = registry.tiers?.[chosenTier];
  if (!definition) fail('UNKNOWN_TIER', `Unknown model tier ${chosenTier}.`);
  const disabled = new Set(normalizeModelIds(registry.disabledProviders).map((prefix) => prefix.toLowerCase()));
  const selected = normalizeModelIds(registry.userSelected?.models)
    .filter((candidate) => ![...disabled].some((prefix) => candidate.toLowerCase().startsWith(prefix)));
  const hints = registry.userSelected?.tierHints && typeof registry.userSelected.tierHints === 'object'
    ? registry.userSelected.tierHints
    : {};
  // The operator's picker is authoritative. A matching tier hint narrows the
  // pool; otherwise all enabled picks remain eligible rather than silently
  // falling back to repository-supplied candidates.
  const hinted = selected.filter((candidate) => hints[candidate] === chosenTier);
  const candidates = (hinted.length > 0 ? hinted : selected.length > 0 ? selected : normalizeModelIds(definition.models))
    .filter((candidate) => ![...disabled].some((prefix) => candidate.toLowerCase().startsWith(prefix)));
  if (candidates.length === 0) fail('NO_ENABLED_TIER_MODEL', `Tier ${chosenTier} has no enabled candidate models.`);
  const available = availableModelIds == null ? null : new Set(normalizeModelIds(availableModelIds));
  const model = available ? candidates.find((candidate) => available.has(candidate)) || candidates[0] : candidates[0];
  return deepFreeze({
    agent: typeof agent === 'string' && agent.trim() ? agent.trim() : null,
    tier: chosenTier,
    model,
    inheritSession: false,
    candidates,
    reason: available?.has(model) ? 'live-tier-candidate' : 'configured-tier-fallback',
    effort: definition.effort || null,
    endpoint: registry.endpoint || registry.gateway?.endpoint || null,
  });
}

export function createRunAssignmentSnapshot({
  runId,
  agentNames,
  availableModelIds,
  registry = loadModelRouter(),
  createdAt = new Date().toISOString(),
} = {}) {
  if (typeof runId !== 'string' || !runId.trim()) fail('RUN_ID_REQUIRED', 'A non-empty runId is required for a routing snapshot.');
  const agents = Array.isArray(agentNames) && agentNames.length > 0
    ? [...new Set(agentNames.filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim()))]
    : [];
  const decisions = Object.fromEntries(agents.map((agent) => {
    const decision = resolveDispatchModel({ agent, availableModelIds, registry });
    return [agent, { tier: decision.tier, model: decision.model, inheritSession: decision.inheritSession, reason: decision.reason }];
  }));
  const payload = {
    runId: runId.trim(),
    routerVersion: registry.version,
    gatewayEndpoint: registry.endpoint || registry.gateway?.endpoint || null,
    availabilityProbe: registry.gateway?.availabilityProbe || null,
    discoveryAttempted: availableModelIds != null,
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
