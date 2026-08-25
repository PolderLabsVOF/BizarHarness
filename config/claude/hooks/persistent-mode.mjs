#!/usr/bin/env node
/**
 * SessionStart / PreCompact / Stop bridge for durable Bizar workflows.
 *
 * This hook is deliberately read-only. It reports the revision-bound stage
 * stored by `bizar workflow`; it never advances, completes, fails, or repairs
 * workflow state based on transcript text.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const STAGE_INSTRUCTIONS = Object.freeze({
  research: 'Continue the research/spec stage. Gather current official documentation and repository evidence before recording a guarded transition.',
  plan: 'Continue the consensus-plan stage. Draft the plan, run adversarial review, and transition only after the plan gate has fresh evidence.',
  execute: 'Continue the execution stage. Dispatch bounded owned scopes, integrate verified results, and preserve all hard approval boundaries.',
  qa: 'Continue the bounded QA/fix stage. Run fresh checks, classify failures, and stay within the recorded retry ceilings.',
  validate: 'Continue multi-perspective validation. Completion requires fresh functional, policy, quality, and test evidence plus an explicit guarded transition.',
});

function contextArgs(input) {
  const args = ['workflow', 'status'];
  if (input.session_id) args.push('--session', String(input.session_id));
  if (input.cwd) args.push('--project', String(input.cwd));
  args.push('--json');
  return args;
}

export function readActiveWorkflow(input, options = {}) {
  if (!input || typeof input !== 'object') return null;
  if (typeof input.session_id !== 'string' || !input.session_id.trim()) return null;
  const executable = options.executable || process.env.BIZAR_EXECUTABLE || 'bizar';
  let result;
  try {
    result = spawnSync(executable, contextArgs(input), {
      cwd: input.cwd || process.cwd(),
      env: options.env || process.env,
      encoding: 'utf8',
      timeout: options.timeout || 5_000,
      maxBuffer: 1024 * 1024,
    });
  } catch {
    return null;
  }
  // Missing state, unavailable command, auth/context exhaustion, malformed
  // output, and timeouts are all fail-open conditions for lifecycle hooks.
  if (result.status !== 0 || result.error) return null;
  let payload;
  try { payload = JSON.parse(String(result.stdout || '').trim()); } catch { return null; }
  const workflow = payload?.ok === true ? payload.workflow : null;
  if (!workflow || workflow.status !== 'active') return null;
  if (!workflow.runId || !workflow.stage || !Number.isSafeInteger(workflow.revision)) return null;
  return workflow;
}

function workflowSummary(workflow) {
  const instruction = STAGE_INSTRUCTIONS[workflow.stage]
    || 'Continue only the recorded current stage and require fresh evidence before any guarded transition.';
  return [
    `Active Bizar ${workflow.mode || 'autopilot'} workflow checkpoint:`,
    `- stage: ${workflow.stage}`,
    `- run: ${workflow.runId}`,
    `- revision: ${workflow.revision}`,
    `- profile: ${workflow.profile || 'default'}`,
    `- instruction: ${instruction}`,
    '- Do not infer success or advance state from this context. Use revision-bound `bizar workflow` transitions only after fresh evidence.',
  ].join('\n');
}

export function persistentModeOutput(input, options = {}) {
  const eventName = String(input?.hook_event_name || '');
  if (eventName === 'Stop' && input?.stop_hook_active === true) return {};
  if (!['Stop', 'SessionStart', 'PreCompact'].includes(eventName)) return {};

  const workflow = readActiveWorkflow(input, options);
  if (!workflow) return {};
  const summary = workflowSummary(workflow);

  if (eventName === 'Stop') {
    return {
      decision: 'block',
      reason: `${summary}\nInvoke the autopilot skill and perform the next bounded action for the current stage before stopping.`,
    };
  }

  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: summary,
    },
  };
}

export function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { input = {}; }
  process.stdout.write(`${JSON.stringify(persistentModeOutput(input))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
