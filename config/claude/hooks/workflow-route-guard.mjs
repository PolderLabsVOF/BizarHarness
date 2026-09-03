#!/usr/bin/env node
/** Preserve a mutation barrier while Mike selects an adaptive coordination mode. */
'use strict';

import {
  clearWorkflowRequired,
  markWorkflowRequired,
  promptRequiresWorkflow,
  workflowRequired,
} from './workflow-route-state.mjs';
import { parseGitCommands } from './git-command-parser.mjs';

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'diff', 'log', 'ls-files', 'rev-parse', 'show', 'status',
]);
const READ_ONLY_BRANCH_OPTIONS = new Set([
  '--all', '--list', '--remotes', '--show-current', '--verbose', '-a', '-r', '-v', '-vv',
]);
const WORKFLOW_SUCCESS = new Set(['completed', 'dry', 'ready-for-integration', 'succeeded', 'success']);
const WORKFLOW_FAILURE = new Set(['blocked', 'budget-exhausted', 'cancelled', 'canceled', 'error', 'failed', 'failure']);

export function isReadOnlyShellInspection(command) {
  const source = String(command || '').trim();
  if (!source || /[\n\r;|<>`]/.test(source) || /\$\(|(?:^|\s)&(?:\s|$)/.test(source)) return false;

  return source.split(/\s*&&\s*/).every((segment) => {
    const trimmed = segment.trim();
    // These commands can inspect a newly opened project but cannot mutate it.
    // Permit them before workflow launch so the primary can choose the right
    // native workflow instead of deadlocking on its standard orientation step.
    if (/^(?:echo|ls)(?:\s|$)/.test(trimmed) || trimmed === 'pwd') return true;
    if (!/^git(?:\s|$)/.test(trimmed) || /(?:^|\s)--(?:output|ext-diff)(?:=|\s|$)/.test(trimmed)) return false;
    const parsed = parseGitCommands(trimmed);
    if (parsed.length !== 1) return false;
    const [git] = parsed;
    if (READ_ONLY_GIT_SUBCOMMANDS.has(git.subcommand)) return true;
    return git.subcommand === 'branch'
      && git.args.every((argument) => READ_ONLY_BRANCH_OPTIONS.has(argument));
  });
}

export function workflowCompletedSuccessfully(input) {
  const root = input?.tool_response ?? input?.tool_result ?? input?.toolUseResult;
  if (!root || typeof root !== 'object') return false;
  const statuses = [];
  let nestedError = false;
  let acceptedLaunch = false;
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 3) return;
    if (typeof value.status === 'string') statuses.push(value.status.toLowerCase());
    if (value.is_error === true || value.error) nestedError = true;
    if (value.status === 'async_launched' && value.taskType === 'local_workflow') acceptedLaunch = true;
    for (const key of ['result', 'workflow', 'data']) visit(value[key], depth + 1);
  };
  visit(root);
  if (nestedError || statuses.some((status) => WORKFLOW_FAILURE.has(status))) return false;
  return acceptedLaunch || statuses.some((status) => WORKFLOW_SUCCESS.has(status));
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { input = {}; }

  const event = String(input.hook_event_name || '');
  const sessionId = String(input.session_id || '');
  const toolName = String(input.tool_name || '');

  try {
    if (event === 'UserPromptSubmit') {
      if (promptRequiresWorkflow(input)) markWorkflowRequired(input);
      else clearWorkflowRequired(sessionId);
      process.stdout.write('{}\n');
      return;
    }

    if (event === 'PostToolUse' && toolName === 'Workflow') {
      if (workflowCompletedSuccessfully(input)) clearWorkflowRequired(sessionId);
      process.stdout.write('{}\n');
      return;
    }

    if (event !== 'PreToolUse' || input.agent_id || !workflowRequired(sessionId)) {
      process.stdout.write('{}\n');
      return;
    }

    // Coordination is an orchestrator decision, not a hard-coded tool gate.
    // Instructions require orientation, then a team by default; clarification
    // is conditional on unresolved material choices. Agent calls are
    // independently protected by agent-model-guard.mjs. Keeping this hook
    // advisory avoids trapping valid direct, single-worker, and team plans.
  } catch (error) {
    process.stderr.write(`[bizar.workflow-route] ${error?.message || String(error)}\n`);
  }

  process.stdout.write('{}\n');
});
