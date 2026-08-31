#!/usr/bin/env node
/**
 * Validate orchestrator-selected Agent model overrides without pinning roles.
 *
 * Bizar agents inherit the active session model by default. Mike may pass an
 * explicit model only when it is one of the configured tier candidates OR a
 * model the user explicitly selected via `bizar models` (the picker IS the
 * discovery surface for user picks — live gateway discovery is not required).
 *
 * For non-user-selected models, live discovery is still required when the
 * caller passes `options.availableModelIds` (defensive: someone may have
 * manually added a tier candidate that no longer exists).
 *
 * Discovery failure never blocks dispatch and never triggers alias retries:
 * omit `model` and inherit the session instead.
 *
 * ── F-185 / IMP-019 health-aware failover contract ─────────────────────────
 *
 * The orchestrator may pass an optional `additionalContext` block on the
 * Agent tool input:
 *
 *   {
 *     "model": "claude-qwen/qwen3.8-max",        // primary pick
 *     "additionalContext": {
 *       "routingDecisionId": "r-2026-08-27-001",  // routingDecisionId tag
 *       "fallback": "claude-minimax/MiniMax-M2.7" // pre-computed failover
 *     }
 *   }
 *
 * Contract:
 *   - `routingDecisionId` MUST be set whenever `fallback` is set. The ID
 *     pins the failover to a specific `pickFailover` verdict so the audit
 *     trail is reconstructable.
 *   - `fallback` MUST be a user-selected model (F-166 / IMP-016). Out-of-pool
 *     fallbacks are still denied the same way out-of-pool primaries are.
 *   - When both are set, the guard accepts BOTH `model` and `fallback`
 *     without re-probing the gateway. The fallback has already been
 *     validated by `pickFailover` against the same registry.
 *   - The hard deny of out-of-pool models STILL APPLIES when
 *     `routingDecisionId` is absent — the contract is opt-in.
 *   - Registry load failures still fail open (F-176 advisory): the orchestrator
 *     already chose a model, let Claude Code validate it once.
 *
 * The contract is intentionally additive. Existing callers that only pass
 * `model` see no behavior change.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { loadModelRouter } from '../../../config/agents/model-assignment.mjs';

function advise(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      additionalContext: `🟡 Model override guidance: ${reason} The dispatch will proceed regardless.`,
    },
  };
}

/**
 * 10.22.0 / Phase 4: extract the operator's `disabledProviders` list from
 * the loaded registry. Whitespace-trimmed + lowercased at read time.
 * Returns `[]` for legacy configs that lack the key (no in-code default).
 * The hook MUST fail open on parse errors — the orchestrator already
 * chose a model; let Claude Code validate it once.
 */
function readDisabledProvidersFromRegistry(registry) {
  if (!registry || typeof registry !== 'object') return [];
  const raw = registry.disabledProviders;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    out.push(trimmed.toLowerCase());
  }
  return out;
}

/**
 * 10.22.0 / Phase 4: case-sensitive prefix filter against the (lowercase)
 * disabled list. Empty / missing prefix list is a no-op (returns input).
 */
function isDisabledId(id, prefixes) {
  if (!Array.isArray(prefixes) || prefixes.length === 0) return false;
  if (typeof id !== 'string' || !id) return false;
  for (const p of prefixes) {
    if (typeof p === 'string' && p && id.startsWith(p)) return true;
  }
  return false;
}

/**
 * Models that pass the configured-tier check: every model in any
 * `tiers.<x>.models` block, PLUS every model in `userSelected.models`.
 *
 * 10.22.0 / Phase 4: ids whose provider prefix is on the operator's
 * `disabledProviders` list are silently filtered out — the picker IS
 * still the discovery surface for user picks, but the operator's
 * disable intent overrides user intent.
 */
function configuredModels(registry) {
  const disabled = readDisabledProvidersFromRegistry(registry);
  const out = new Set();
  for (const tier of Object.values(registry?.tiers || {})) {
    if (Array.isArray(tier?.models)) for (const id of tier.models) {
      if (!isDisabledId(id, disabled)) out.add(id);
    }
  }
  const userSelected = registry?.userSelected;
  if (userSelected && Array.isArray(userSelected.models)) {
    for (const id of userSelected.models) {
      if (!isDisabledId(id, disabled)) out.add(id);
    }
  }
  return out;
}

/**
 * Subset of `configuredModels` that came from the user picker. These bypass
 * the live-discovery validation (the picker IS the discovery).
 *
 * 10.22.0 / Phase 4: same disabled-prefix filter as `configuredModels`.
 */
function userSelectedModels(registry) {
  const disabled = readDisabledProvidersFromRegistry(registry);
  const out = new Set();
  const userSelected = registry?.userSelected;
  if (userSelected && Array.isArray(userSelected.models)) {
    for (const id of userSelected.models) {
      if (!isDisabledId(id, disabled)) out.add(id);
    }
  }
  return out;
}

/**
 * Read the optional F-185 failover block off the Agent tool input. Returns
 * `{ routingDecisionId, fallback }` with empty-string sentinels when
 * missing; the caller MUST treat `fallback` as absent when the decision ID
 * is empty (the contract is both-or-neither).
 */
function readFailoverBlock(toolInput) {
  const ctx = toolInput && typeof toolInput === 'object' && typeof toolInput.additionalContext === 'object' && toolInput.additionalContext !== null
    ? toolInput.additionalContext
    : null;
  if (!ctx) return { routingDecisionId: '', fallback: '' };
  return {
    routingDecisionId: typeof ctx.routingDecisionId === 'string' ? ctx.routingDecisionId.trim() : '',
    fallback: typeof ctx.fallback === 'string' ? ctx.fallback.trim() : '',
  };
}

export async function guardAgentModel(input, options = {}) {
  if (!input || typeof input !== 'object') return {};
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Agent') return {};
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const requested = typeof toolInput.model === 'string' ? toolInput.model.trim() : '';
  const failoverBlock = readFailoverBlock(toolInput);
  const hasFailoverContract = Boolean(failoverBlock.routingDecisionId) && Boolean(failoverBlock.fallback);

  // No override is the canonical safe path: Claude Code inherits the session.
  if (!requested) return {};
  if (requested === 'inherit') return {};

  let registry;
  try {
    registry = options.registry || loadModelRouter(options.routerPath);
  } catch {
    // A broken optional router must not strand subagents. The caller already
    // chose a model; let Claude Code/provider validate it once.
    return {};
  }

  const allowed = configuredModels(registry);
  const userPicks = userSelectedModels(registry);

  // F-185 contract: when the orchestrator passes both `routingDecisionId`
  // and `fallback`, validate the fallback against the userSelected pool
  // but skip the live-discovery re-probe. The fallback's eligibility was
  // already computed by `pickFailover` against this same registry.
  if (hasFailoverContract) {
    if (!userPicks.has(failoverBlock.fallback)) {
      return advise(`Bizar Agent dispatch: fallback ${failoverBlock.fallback} is outside the user-selected pool; omit fallback to inherit the session.`);
    }
    if (!allowed.has(requested)) {
      return advise(`Bizar Agent dispatch blocked: model override ${requested} is outside the configured dynamic tiers and the user-selected pool. Omit model to inherit the session or pick it via \`bizar models\`.`);
    }
    // Both IDs are user-selected. Accept without re-probing the gateway.
    return {};
  }

  if (!allowed.has(requested)) {
    return advise(`Bizar Agent dispatch blocked: model override ${requested} is outside the configured dynamic tiers and the user-selected pool. Omit model to inherit the session or pick it via \`bizar models\`.`);
  }

  // User-selected models bypass live-discovery validation. The picker is the
  // discovery surface; users explicitly told us these IDs are valid.
  const fromUserPick = userPicks.has(requested);
  if (!fromUserPick && Array.isArray(options.availableModelIds)) {
    const available = new Set(options.availableModelIds);
    if (!available.has(requested)) {
      return advise(`Bizar Agent dispatch blocked: ${requested} was not reported by live discovery. Omit model to inherit the active session; do not retry aliases.`);
    }
  }

  return {};
}

export async function main() {
  let input;
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {
    process.stdout.write('{}\n');
    return;
  }
  process.stdout.write(`${JSON.stringify(await guardAgentModel(input))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}