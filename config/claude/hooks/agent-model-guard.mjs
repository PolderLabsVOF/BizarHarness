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
 * Models that pass the configured-tier check: every model in any
 * `tiers.<x>.models` block, PLUS every model in `userSelected.models`.
 */
function configuredModels(registry) {
  const out = new Set();
  for (const tier of Object.values(registry?.tiers || {})) {
    if (Array.isArray(tier?.models)) for (const id of tier.models) out.add(id);
  }
  const userSelected = registry?.userSelected;
  if (userSelected && Array.isArray(userSelected.models)) {
    for (const id of userSelected.models) out.add(id);
  }
  return out;
}

/**
 * Subset of `configuredModels` that came from the user picker. These bypass
 * the live-discovery validation (the picker IS the discovery).
 */
function userSelectedModels(registry) {
  const out = new Set();
  const userSelected = registry?.userSelected;
  if (userSelected && Array.isArray(userSelected.models)) {
    for (const id of userSelected.models) out.add(id);
  }
  return out;
}

export async function guardAgentModel(input, options = {}) {
  if (!input || typeof input !== 'object') return {};
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Agent') return {};
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const requested = typeof toolInput.model === 'string' ? toolInput.model.trim() : '';

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
  if (!allowed.has(requested)) {
    return advise(`Bizar Agent dispatch blocked: model override ${requested} is outside the configured dynamic tiers and the user-selected pool. Omit model to inherit the session or pick it via \`bizar models\`.`);
  }

  // User-selected models bypass live-discovery validation. The picker is the
  // discovery surface; users explicitly told us these IDs are valid.
  const fromUserPick = userSelectedModels(registry).has(requested);
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
