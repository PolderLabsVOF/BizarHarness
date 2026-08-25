#!/usr/bin/env node
/**
 * Portable Claude Code hook dispatcher.
 *
 * Claude settings call `bizar hook <name>` instead of importing scripts from
 * a checkout or from `~/.claude/hooks`. The dispatcher resolves shipped hook
 * assets relative to this installed package, forwards the original JSON input,
 * and combines event-level hook results into one schema-valid response.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK_ROOT = resolve(PACKAGE_ROOT, 'config', 'claude', 'hooks');
const PRETOOL_SAFETY_LEAVES = new Set([
  'pretooluse-editwrite', 'path-ownership-guard',
  'pretooluse-bash', 'git-workflow-guard',
  'agent-model-guard',
]);

export const HOOK_PROGRAMS = Object.freeze({
  'advisor-context': 'advisor-context.mjs',
  'agent-grounding': 'agent-grounding.mjs',
  'agent-model-guard': 'agent-model-guard.mjs',
  'auto-instinct': 'auto-instinct.sh',
  'content-style-guard': 'content-style-guard.mjs',
  'control-inbox': 'control-inbox.mjs',
  'git-workflow-guard': 'git-workflow-guard.mjs',
  'keyword-router': 'keyword-router.mjs',
  'learning-extract': 'learning-extract.mjs',
  'path-ownership-guard': 'path-ownership-guard.mjs',
  'permission-request-policy': 'permission-request.mjs',
  'persistent-mode': 'persistent-mode.mjs',
  'posttooluse-editwrite': 'posttooluse-editwrite.mjs',
  'post-tool-use-failure-policy': 'post-tool-use-failure.mjs',
  'precompact-priorities': 'precompact-priorities.sh',
  'pretooluse-bash': 'pretooluse-bash.mjs',
  'pretooluse-editwrite': 'pretooluse-editwrite.mjs',
  'sessionend-recall': 'sessionend-recall.mjs',
  'sessionstart-prime': 'sessionstart-prime.mjs',
  'simplify-guard': 'simplify-guard.mjs',
  telemetry: 'telemetry.mjs',
  'thinking-route': 'thinking-route.mjs',
  'verify-deliverables': 'verify-deliverables.mjs',
  'worker-suggest': 'worker-suggest.mjs',
  'worktree-bootstrap': 'worktree-bootstrap.mjs',
});

export const EVENT_CHAINS = Object.freeze({
  'user-prompt-submit': Object.freeze([
    'control-inbox',
    'keyword-router',
    'worker-suggest',
    'thinking-route',
    'telemetry',
  ]),
  'session-start': Object.freeze([
    'control-inbox',
    'sessionstart-prime',
    'persistent-mode',
    'telemetry',
  ]),
  'pre-tool-use': Object.freeze([
    'pretooluse-editwrite',
    'path-ownership-guard',
    'pretooluse-bash',
    'git-workflow-guard',
  ]),
  'permission-request': Object.freeze(['permission-request-policy']),
  'post-tool-use': Object.freeze([
    'posttooluse-editwrite',
    'auto-instinct',
  ]),
  'post-tool-use-failure': Object.freeze(['post-tool-use-failure-policy']),
  'subagent-start': Object.freeze([
    'agent-grounding',
    'advisor-context',
    'worktree-bootstrap',
  ]),
  'subagent-stop': Object.freeze(['verify-deliverables']),
  'pre-compact': Object.freeze(['persistent-mode', 'precompact-priorities']),
  stop: Object.freeze(['persistent-mode']),
  'session-end': Object.freeze(['sessionend-recall', 'learning-extract']),
});

const EVENT_NAMES = Object.freeze({
  'user-prompt-submit': 'UserPromptSubmit',
  'session-start': 'SessionStart',
  'pre-tool-use': 'PreToolUse',
  'permission-request': 'PermissionRequest',
  'post-tool-use': 'PostToolUse',
  'post-tool-use-failure': 'PostToolUseFailure',
  'subagent-start': 'SubagentStart',
  'subagent-stop': 'SubagentStop',
  'pre-compact': 'PreCompact',
  stop: 'Stop',
  'session-end': 'SessionEnd',
});

function executeLeaf(name, input, options = {}) {
  const relative = HOOK_PROGRAMS[name];
  if (!relative) return { status: 64, stdout: '', stderr: `unknown hook: ${name}\n` };
  const path = resolve(options.hookRoot || HOOK_ROOT, relative);
  const shell = relative.endsWith('.sh');
  let result;
  try {
    result = options.executor
      ? options.executor({ name, path, program: shell ? 'bash' : process.execPath, input })
      : spawnSync(shell ? 'bash' : process.execPath, [path], {
        cwd: options.cwd || process.cwd(),
        env: options.env || process.env,
        input,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
        timeout: options.timeout || 30_000,
      });
  } catch (error) {
    result = { status: 1, stdout: '', stderr: error?.message || String(error) };
  }
  return {
    status: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  };
}

function parseHookOutput(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return {};
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return { __plainContext: trimmed };
  }
}

function permissionRank(value) {
  if (value === 'deny') return 3;
  if (value === 'ask') return 2;
  if (value === 'allow') return 1;
  return 0;
}

function combineOutputs(eventKey, results) {
  const eventName = EVENT_NAMES[eventKey];
  const contexts = [];
  let topDecision;
  let topReason;
  let permissionDecision;
  let permissionReason;
  let eventDecision;
  let continueValue;
  let stopReason;

  for (const result of results) {
    const value = parseHookOutput(result.stdout);
    if (value.__plainContext) contexts.push(value.__plainContext);
    if (typeof value.continue === 'boolean' && value.continue === false) {
      continueValue = false;
      if (value.stopReason) stopReason = String(value.stopReason);
    }
    if (value.decision === 'block') {
      topDecision = 'block';
      if (value.reason) topReason = String(value.reason);
    }
    const specific = value.hookSpecificOutput;
    if (!specific || typeof specific !== 'object') continue;
    if (specific.additionalContext) contexts.push(String(specific.additionalContext));
    if (specific.decision && typeof specific.decision === 'object') {
      eventDecision = specific.decision;
    }
    if (permissionRank(specific.permissionDecision) > permissionRank(permissionDecision)) {
      permissionDecision = specific.permissionDecision;
      permissionReason = specific.permissionDecisionReason
        ? String(specific.permissionDecisionReason)
        : undefined;
    }
  }

  const output = {};
  if (continueValue === false) {
    output.continue = false;
    if (stopReason) output.stopReason = stopReason;
  }
  if (topDecision) {
    output.decision = topDecision;
    if (topReason) output.reason = topReason;
  }
  if (contexts.length > 0 || permissionDecision) {
    output.hookSpecificOutput = { hookEventName: eventName };
    if (contexts.length > 0) {
      output.hookSpecificOutput.additionalContext = [...new Set(contexts)].join('\n\n');
    }
    if (permissionDecision) {
      output.hookSpecificOutput.permissionDecision = permissionDecision;
      if (permissionReason) output.hookSpecificOutput.permissionDecisionReason = permissionReason;
    }
  }
  if (eventDecision) {
    output.hookSpecificOutput ||= { hookEventName: eventName };
    output.hookSpecificOutput.decision = eventDecision;
  }
  return output;
}

function parseInput(input) {
  let payload = {};
  try { payload = JSON.parse(input || '{}'); } catch { payload = {}; }
  return payload && typeof payload === 'object' ? payload : {};
}

export function selectEventChain(eventKey, input = '') {
  const chain = EVENT_CHAINS[eventKey];
  if (!chain) return null;
  const payload = parseInput(input);
  const toolName = String(payload.tool_name || '');
  const agentType = String(payload.agent_type || '');

  if (eventKey === 'pre-tool-use') {
    if (/^(Write|Edit|MultiEdit)$/.test(toolName)) {
      return ['pretooluse-editwrite', 'path-ownership-guard'];
    }
    if (toolName === 'Bash') {
      return ['pretooluse-bash', 'git-workflow-guard'];
    }
    if (toolName === 'Agent') return ['agent-model-guard'];
    return [];
  }

  if (eventKey === 'post-tool-use') {
    if (/^(Write|Edit|MultiEdit)$/.test(toolName)) return ['posttooluse-editwrite'];
    if (toolName === 'Bash') return ['auto-instinct'];
    return [];
  }

  if (eventKey === 'subagent-start') {
    return chain.filter((leaf) => {
      if (leaf === 'advisor-context') {
        return /^(linda|karen|carl|qa-reviewer|principal-engineer|debug-specialist)$/.test(agentType);
      }
      if (leaf === 'worktree-bootstrap') {
        return /^(brad|carl|pam|brenda|karen|todd|ria)$/.test(agentType);
      }
      return true;
    });
  }

  return [...chain];
}

export function executeHook(name, input = '', options = {}) {
  if (Object.hasOwn(HOOK_PROGRAMS, name)) return executeLeaf(name, input, options);
  const chain = selectEventChain(name, input);
  if (!chain) return { status: 64, stdout: '', stderr: `unknown hook: ${name}\n` };
  const results = [];
  for (const leaf of chain) {
    const result = executeLeaf(leaf, input, options);
    if (name === 'pre-tool-use' && PRETOOL_SAFETY_LEAVES.has(leaf) && result.status !== 0) {
      results.push({
        status: 0,
        stdout: `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `Bizar safety hook ${leaf} failed; refusing the tool call until the hook is healthy.`,
          },
        })}\n`,
        stderr: '',
      });
      continue;
    }
    // Hook crashes and unavailable optional integrations fail open. A single
    // broken context hook must not disable later safety hooks in the chain.
    if (result.status === 0) results.push(result);
  }
  return {
    status: 0,
    stdout: `${JSON.stringify(combineOutputs(name, results))}\n`,
    stderr: '',
  };
}

function showHelp() {
  process.stderr.write('Usage: bizar hook <name>\n');
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'hook') return false;
  const [hookName] = args;
  if (isHelpRequest || !hookName) {
    showHelp();
    if (!isHelpRequest) process.exitCode = 64;
    return true;
  }
  let input = '';
  try { input = readFileSync(0, 'utf8'); } catch { input = ''; }
  const result = executeHook(hookName, input);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.status;
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , hookName] = process.argv;
  await run('hook', hookName ? [hookName] : [], false);
}
