#!/usr/bin/env node
/**
 * Validate orchestrator-selected Agent model overrides without pinning roles.
 *
 * Bizar agents must use an explicit enabled configured model. Mike selects
 * from the configured tiers, with a `bizar models` user pick taking priority.
 *
 * For non-user-selected models, live discovery is still required when the
 * caller passes `options.availableModelIds` (defensive: someone may have
 * manually added a tier candidate that no longer exists).
 *
 * Discovery failure never triggers alias retries: dispatch keeps the selected
 * configured candidate rather than falling through to a provider default.
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
 *   - Registry load failures fail closed: allowing the dispatch would hand
 *     model choice back to Claude Code's unconfigured provider default.
 *
 * Callers that pass only `model` are accepted only when that literal ID is in
 * the enabled configured pool. Missing or inherited model selection is denied.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { loadModelRouter } from '../../../config/agents/model-assignment.mjs';

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

/**
 * 10.22.0 / Phase 4: extract the operator's `disabledProviders` list from
 * the loaded registry. Whitespace-trimmed + lowercased at read time.
 * Returns `[]` for legacy configs that lack the key (no in-code default).
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
 * 10.22.0 / Phase 4: case-insensitive prefix filter against the normalized
 * disabled list. Empty / missing prefix list is a no-op.
 */
function isDisabledId(id, prefixes) {
  if (!Array.isArray(prefixes) || prefixes.length === 0) return false;
  if (typeof id !== 'string' || !id) return false;
  const normalized = id.toLowerCase();
  for (const p of prefixes) {
    if (typeof p === 'string' && p && normalized.startsWith(p)) return true;
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

  if (!requested || requested === 'inherit') {
    return deny('Bizar Agent dispatch blocked: every Agent call requires an explicit enabled model from `bizar models`; session/provider inheritance is prohibited.');
  }

  let registry;
  try {
    registry = options.registry || loadModelRouter(options.routerPath);
  } catch {
    return deny('Bizar Agent dispatch blocked: the global model router is missing or invalid. Run `bizar models`, then retry.');
  }

  // Disabled is an enforceable operator boundary. Falling through here would
  // still invoke the explicitly disabled provider; it is not a substitution.
  const disabled = readDisabledProvidersFromRegistry(registry);
  if (isDisabledId(requested, disabled)) {
    return deny(`Bizar Agent dispatch blocked: ${requested} matches disabledProviders. Select an enabled configured model.`);
  }

  const allowed = configuredModels(registry);
  const userPicks = userSelectedModels(registry);

  // F-185 contract: when the orchestrator passes both `routingDecisionId`
  // and `fallback`, validate the fallback against the userSelected pool
  // but skip the live-discovery re-probe. The fallback's eligibility was
  // already computed by `pickFailover` against this same registry.
  if (hasFailoverContract) {
    if (!userPicks.has(failoverBlock.fallback)) {
      return deny(`Bizar Agent dispatch blocked: fallback ${failoverBlock.fallback} is outside the user-selected pool; select an enabled configured fallback.`);
    }
    if (!allowed.has(requested)) {
      return deny(`Bizar Agent dispatch blocked: model override ${requested} is outside the configured dynamic tiers and the user-selected pool. Pick it via \`bizar models\`.`);
    }
    // Both IDs are user-selected. Accept without re-probing the gateway.
    return {};
  }

  if (!allowed.has(requested)) {
    return deny(`Bizar Agent dispatch blocked: model override ${requested} is outside the configured dynamic tiers and the user-selected pool. Pick it via \`bizar models\`.`);
  }

  // User-selected models bypass live-discovery validation. The picker is the
  // discovery surface; users explicitly told us these IDs are valid.
  const fromUserPick = userPicks.has(requested);
  if (!fromUserPick && Array.isArray(options.availableModelIds)) {
    const available = new Set(options.availableModelIds);
    if (!available.has(requested)) {
      return deny(`Bizar Agent dispatch blocked: ${requested} was not reported by live discovery. Select another enabled configured model; do not retry aliases.`);
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
