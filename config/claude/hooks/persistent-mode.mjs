#!/usr/bin/env node
/**
 * SessionStart / PreCompact / Stop bridge for durable Bizar plans.
 *
 * This hook is deliberately read-only. It reports the active OpenKan
 * plan + task state; it never advances, completes, fails, or repairs
 * state based on transcript text.
 *
 * Migrated from `bizar workflow status` (now retired) to OpenKan's
 * `ok plan list --status active --json` + `ok task list --json`. The
 * legacy `{ ok, workflow: { runId, stage, revision, ... } }` shape
 * is preserved for downstream consumers that still match on those
 * keys (keyword-router, slash commands) — the OpenKan fields are
 * mapped onto the legacy keys below.
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

const TASK_STATUS_TO_STAGE = Object.freeze({
  pending: 'research',
  in_progress: 'execute',
  review: 'qa',
  done: 'validate',
});

/**
 * Spawn the OpenKan CLI. Defaults to `ok` from `~/.local/bin/ok`;
 * callers may override via options.executable for testability.
 */
function runOk(args, cwd, env, executable) {
  return spawnSync(executable || 'ok', args, {
    cwd: cwd || process.cwd(),
    env: env || process.env,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
}

/**
 * Read the active OpenKan plan + its in-flight tasks and translate
 * them into the legacy `{ ok, workflow }` JSON shape.
 */
export function readActiveWorkflow(input, options = {}) {
  if (!input || typeof input !== 'object') return null;
  if (typeof input.session_id !== 'string' || !input.session_id.trim()) return null;

  let planResult;
  try {
    planResult = runOk(['plan', 'list', '--status', 'active', '--json'],
      input.cwd, options.env, options.executable);
  } catch {
    return null;
  }
  if (planResult.status !== 0 || planResult.error) return null;
  let plans;
  try { plans = JSON.parse(String(planResult.stdout || '').trim()); } catch { return null; }
  if (!Array.isArray(plans) || plans.length === 0) return null;
  const plan = plans.find((entry) => entry && entry.status === 'active') || plans[0];
  if (!plan || !plan.id) return null;

  let taskResult;
  try {
    taskResult = runOk(['task', 'list', '--plan', plan.id, '--json'],
      input.cwd, options.env, options.executable);
  } catch {
    return null;
  }
  if (taskResult.status !== 0 || taskResult.error) return null;
  let tasks;
  try { tasks = JSON.parse(String(taskResult.stdout || '').trim()); } catch { tasks = []; }

  // Pick the in-flight task (in_progress > review > pending). If
  // nothing is in-flight but a plan exists, surface the plan's
  // overall status as the "stage".
  const inflight = (Array.isArray(tasks) ? tasks : [])
    .find((task) => task && task.status === 'in_progress')
    || (Array.isArray(tasks) ? tasks : [])
      .find((task) => task && task.status === 'review')
    || (Array.isArray(tasks) ? tasks : [])
      .find((task) => task && task.status === 'pending');
  const stage = inflight ? (TASK_STATUS_TO_STAGE[inflight.status] || 'execute') : 'execute';
  const revision = Number.isSafeInteger(plan.updatedAt) ? plan.updatedAt : 1;

  return {
    runId: plan.id,
    stage,
    revision,
    mode: plan.summary && plan.summary.toLowerCase().includes('autopilot') ? 'autopilot' : 'plan-build',
    profile: 'default',
    status: plan.status,
    activeTask: inflight ? inflight.id : null,
  };
}

function workflowSummary(workflow) {
  const instruction = STAGE_INSTRUCTIONS[workflow.stage]
    || 'Continue only the recorded current stage and require fresh evidence before any guarded transition.';
  return [
    `Active Bizar ${workflow.mode || 'autopilot'} plan checkpoint:`,
    `- stage: ${workflow.stage}`,
    `- plan: ${workflow.runId}`,
    `- revision: ${workflow.revision}`,
    `- profile: ${workflow.profile || 'default'}`,
    workflow.activeTask ? `- task: ${workflow.activeTask}` : null,
    `- instruction: ${instruction}`,
    '- Do not infer success or advance state from this context. Use revision-bound `ok task update`/`ok plan update` transitions only after fresh evidence.',
  ].filter(Boolean).join('\n');
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
