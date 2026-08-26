#!/usr/bin/env node
/**
 * Validate orchestrator-selected Agent model overrides without pinning roles.
 *
 * Bizar agents inherit the active session model by default. Mike may pass an
 * explicit model only when it is one of the configured tier candidates and live
 * discovery has reported it. Discovery failure never blocks dispatch and never
 * triggers alias retries: omit `model` and inherit the session instead.
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

function configuredModels(registry) {
  return new Set(Object.values(registry?.tiers || {}).flatMap((tier) => Array.isArray(tier?.models) ? tier.models : []));
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

  if (!configuredModels(registry).has(requested)) {
    return deny(`Bizar Agent dispatch blocked: model override ${requested} is outside the configured dynamic tiers. Omit model to inherit the session or choose one discovered tier candidate.`);
  }

  if (Array.isArray(options.availableModelIds)) {
    const available = new Set(options.availableModelIds);
    if (!available.has(requested)) {
      return deny(`Bizar Agent dispatch blocked: ${requested} was not reported by live discovery. Omit model to inherit the active session; do not retry aliases.`);
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
