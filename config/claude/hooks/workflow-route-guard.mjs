#!/usr/bin/env node
/** Enforce native-workflow entry before substantive primary-session mutation. */
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
const WORKFLOW_SUCCESS = new Set(['completed', 'dry', 'ready-for-integration', 'succeeded', 'success']);
const WORKFLOW_FAILURE = new Set(['blocked', 'budget-exhausted', 'cancelled', 'canceled', 'error', 'failed', 'failure']);

export function isReadOnlyShellInspection(command) {
  const source = String(command || '').trim();
  if (!source || /[\n\r;|<>`]/.test(source) || /\$\(|(?:^|\s)&(?:\s|$)/.test(source)) return false;

  return source.split(/\s*&&\s*/).every((segment) => {
    const trimmed = segment.trim();
    if (/^echo(?:\s|$)/.test(trimmed)) return true;
    if (!/^git(?:\s|$)/.test(trimmed) || /(?:^|\s)--(?:output|ext-diff)(?:=|\s|$)/.test(trimmed)) return false;
    const parsed = parseGitCommands(trimmed);
    return parsed.length === 1 && READ_ONLY_GIT_SUBCOMMANDS.has(parsed[0].subcommand);
  });
}

export function workflowCompletedSuccessfully(input) {
  const root = input?.tool_response ?? input?.tool_result ?? input?.toolUseResult;
  if (!root || typeof root !== 'object') return false;
  const statuses = [];
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 3) return;
    if (typeof value.status === 'string') statuses.push(value.status.toLowerCase());
    for (const key of ['result', 'workflow', 'data']) visit(value[key], depth + 1);
  };
  visit(root);
  if (root.is_error === true || root.error || statuses.some((status) => WORKFLOW_FAILURE.has(status))) return false;
  return statuses.some((status) => WORKFLOW_SUCCESS.has(status));
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

    const readOnlyBash = toolName === 'Bash' && isReadOnlyShellInspection(input.tool_input?.command);
    if (!readOnlyBash && /^(?:Edit|Write|MultiEdit|Bash|Agent)$/.test(toolName)) {
      process.stdout.write(`${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Bizar workflow routing guard: ${toolName} is unavailable in the primary session until the required native Workflow runs successfully. Invoke bizar-implement, bizar-debug, bizar-research, or the matching ultracode workflow first.`,
        },
      })}\n`);
      return;
    }
  } catch (error) {
    process.stderr.write(`[bizar.workflow-route] ${error?.message || String(error)}\n`);
  }

  process.stdout.write('{}\n');
});
