#!/usr/bin/env node
/** Enforce immutable per-run Agent/model assignments during active workflows. */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { WorkflowStateError, getWorkflowState } from '../../cli/core/workflow-state.mjs';
import { loadModelRouter } from '../../config/agents/model-assignment.mjs';
import { probeAvailableModels } from '../../cli/commands/workflow.mjs';

const BUILT_IN_AGENT_TYPES = new Set([
  'Explore', 'Plan', 'general-purpose', 'statusline-setup', 'claude-code-guide',
]);

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function normalizeEndpoint(value) {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) return null;
  const normalized = value.replace(/\/+$/, '');
  return normalized || null;
}

export async function guardAgentModel(input, options = {}) {
  if (!input || typeof input !== 'object') return {};
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Agent') return {};
  const sessionId = typeof input.session_id === 'string' ? input.session_id.trim() : '';
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const target = String(
    toolInput.subagent_type || toolInput.agent_type || toolInput.agent || toolInput.name || '',
  ).trim();
  if (!target) return sessionId
    ? deny('Bizar Agent dispatch blocked: the active workflow requires an assigned agent target.')
    : {};
  if (BUILT_IN_AGENT_TYPES.has(target)) return {};
  const registryTarget = target.startsWith('bizar-harness:')
    ? target.slice('bizar-harness:'.length)
    : target;

  let workflow = null;
  if (sessionId) {
    try {
      workflow = getWorkflowState({
        projectRoot: input.cwd || process.cwd(),
        sessionId,
      });
    } catch (error) {
      if (!(error instanceof WorkflowStateError && error.code === 'NOT_FOUND')) {
        return deny(
          `Bizar Agent dispatch blocked because workflow state integrity could not be validated` +
          `${error?.code ? ` (${error.code})` : ''}. Repair or cancel the state before dispatching.`,
        );
      }
    }
  }

  let assignments;
  let source;
  let probeRegistry;
  if (workflow?.status === 'active') {
    assignments = workflow.assignmentSnapshot?.assignments;
    source = 'active workflow assignment snapshot';
    probeRegistry = {
      gateway: {
        endpoint: workflow.assignmentSnapshot.gatewayEndpoint,
        availabilityProbe: workflow.assignmentSnapshot.availabilityProbe,
      },
    };
  } else {
    let registry;
    try {
      registry = options.registry || loadModelRouter(options.routerPath);
    } catch (error) {
      if (target.startsWith('bizar-harness:') || /^(?:mike|paul|carl|karen|linda|brad|ria|greg|steve|todd|oscar|susan|brenda|pam|janet|kevin)$/.test(registryTarget)) {
        return deny(`Bizar Agent dispatch blocked because the canonical model router is invalid: ${error?.message || String(error)}.`);
      }
      return {};
    }
    assignments = registry.agents;
    source = 'canonical model router';
    probeRegistry = registry;
  }

  const assignment = assignments?.[registryTarget];
  if (!assignment) {
    if (workflow?.status === 'active' || target.startsWith('bizar-harness:')) {
      return deny(`Bizar Agent dispatch blocked: ${target} is not in the ${source}.`);
    }
    // Non-Bizar custom agent types intentionally outside the registry remain
    // under Claude Code's normal model/permission policy.
    return {};
  }

  const expectedModel = String(assignment.model || '');
  const explicitModel = typeof toolInput.model === 'string' ? toolInput.model.trim() : '';
  const env = options.env || process.env;
  if (workflow?.status === 'active') {
    const frozenEndpoint = normalizeEndpoint(workflow.assignmentSnapshot.gatewayEndpoint);
    const inferenceEndpoint = normalizeEndpoint(env.ANTHROPIC_BASE_URL);
    if (!inferenceEndpoint) {
      return deny(`Bizar Agent dispatch blocked: active workflow inference requires ANTHROPIC_BASE_URL=${workflow.assignmentSnapshot.gatewayEndpoint}.`);
    }
    if (inferenceEndpoint !== frozenEndpoint) {
      return deny(`Bizar Agent dispatch blocked: ANTHROPIC_BASE_URL does not match frozen workflow gateway ${workflow.assignmentSnapshot.gatewayEndpoint}.`);
    }
    const routerEndpointValue = env.BIZAR_MODEL_ROUTER_URL;
    if (typeof routerEndpointValue === 'string' && routerEndpointValue !== '') {
      const routerEndpoint = normalizeEndpoint(routerEndpointValue);
      if (!routerEndpoint || routerEndpoint !== frozenEndpoint) {
        return deny(`Bizar Agent dispatch blocked: BIZAR_MODEL_ROUTER_URL contradicts frozen workflow gateway ${workflow.assignmentSnapshot.gatewayEndpoint}.`);
      }
    }
  }
  const environmentModel = String(env.CLAUDE_CODE_SUBAGENT_MODEL || '').trim();
  if (explicitModel && explicitModel !== expectedModel) {
    return deny(`Bizar Agent dispatch blocked: ${target} is pinned by the ${source} to ${expectedModel}, not explicit override ${explicitModel}.`);
  }
  if (environmentModel && environmentModel !== expectedModel) {
    return deny(`Bizar Agent dispatch blocked: ${target} is pinned to ${expectedModel}, but CLAUDE_CODE_SUBAGENT_MODEL=${environmentModel}.`);
  }
  let availableModelIds;
  try {
    availableModelIds = options.availableModelIds || await probeAvailableModels({
      registry: probeRegistry,
      fetchImpl: options.fetchImpl,
      timeoutMs: 3_000,
    });
  } catch (error) {
    return deny(`Bizar Agent dispatch blocked: live gateway availability could not be proven for ${expectedModel} (${error?.code || 'GATEWAY_UNAVAILABLE'}).`);
  }
  if (!new Set(availableModelIds).has(expectedModel)) {
    return deny(`Bizar Agent dispatch blocked: live gateway does not report exact assigned model ${expectedModel} for ${target}.`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
