#!/usr/bin/env node
/**
 * UserPromptSubmit router for explicit Bizar workflow commands.
 *
 * Only an unquoted slash command at the start of the user's prompt can mutate
 * durable state. Command-looking text in prose, code, URLs, diffs, paths, or
 * prior-instruction quotations is treated as inert evidence.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const EXPLICIT_COMMANDS = Object.freeze(new Map([
  ['autopilot', 'autopilot'],
  ['cancel', 'cancel'],
  ['deep-interview', 'deep-interview'],
  ['ralph', 'ralph'],
  ['ultrawork', 'ultrawork'],
  ['ultraqa', 'ultraqa'],
  ['ultragoal', 'ultragoal'],
  ['bizplan', 'bizplan'],
  // Legacy aliases — both `/plan` and `/ralplan` route to bizplan.
  ['plan', 'bizplan'],
  ['ralplan', 'bizplan'],
]));

/**
 * Prose-level alias detector: when a prompt contains the substring
 * "ralplan" outside an explicit slash command, surface a routing
 * context that directs the operator toward the bizplan skill. The
 * bizplan literal match (via `/bizplan`) takes priority over this
 * detector because explicit commands are the only durable mutation
 * surface.
 */
export const BIZPLAN_PROSE_ALIAS_RE = /\bralplan\b/i;

const MAX_PROMPT = 16_384;
const MAX_ARGUMENTS = 4_096;
const AUTOPILOT_PROFILES = new Set(['default', 'plan-build-qa']);

export function parseExplicitCommand(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) return null;
  const bounded = prompt.slice(0, MAX_PROMPT).replaceAll('\r\n', '\n');
  const leadingTrimmed = bounded.replace(/^\s+/, '');

  // Explicit commands must be the first user-authored token. These prefixes
  // cover fenced/inline code, Markdown quotes, quoted strings, diff hunks, and
  // markup commonly used to repeat prior instructions.
  if (/^(?:```|~~~|`|>|["']|@@|\+\+\+|---|<)/.test(leadingTrimmed)) return null;

  const firstLine = leadingTrimmed.split('\n', 1)[0];
  const match = /^\/(autopilot|cancel|deep-interview|ralph|ultrawork|ultraqa|ultragoal|bizplan|plan|ralplan)(?=\s|$)([^\n]*)$/i.exec(firstLine);
  if (!match) return null;

  const command = match[1].toLowerCase();
  const firstLineArgs = match[2].trim();
  const lineEnd = leadingTrimmed.indexOf('\n');
  const remainder = lineEnd === -1 ? '' : leadingTrimmed.slice(lineEnd + 1).trim();
  const args = [firstLineArgs, remainder].filter(Boolean).join('\n').slice(0, MAX_ARGUMENTS);
  return Object.freeze({ command, skill: EXPLICIT_COMMANDS.get(command), args });
}

function workflowCommand(args, input, options = {}) {
  const executable = options.executable || process.env.BIZAR_EXECUTABLE || 'bizar';
  const result = spawnSync(executable, ['workflow', ...args, '--json'], {
    cwd: input.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeout || 5_000,
    maxBuffer: 1024 * 1024,
  });
  let payload = null;
  const raw = result.status === 0 ? result.stdout : result.stderr;
  try { payload = JSON.parse(String(raw || '').trim()); } catch { payload = null; }
  return {
    ok: result.status === 0 && payload?.ok === true,
    workflow: payload?.workflow || null,
  };
}

function workflowContext(input) {
  const args = [];
  if (input.session_id) args.push('--session', String(input.session_id));
  if (input.cwd) args.push('--project', String(input.cwd));
  return args;
}

export function applyExplicitWorkflowCommand(parsed, input, options = {}) {
  const sessionId = typeof input.session_id === 'string' ? input.session_id.trim() : '';
  if (!sessionId) return { attempted: false, ok: false, workflow: null };
  const contextArgs = workflowContext(input);

  if (parsed.command === 'autopilot') {
    const isResume = /^resume(?:\s|$)/i.test(parsed.args);
    let args;
    if (isResume) {
      args = ['resume', ...contextArgs];
    } else {
      let goal = parsed.args.trim();
      let profile = 'default';
      const workflowMatch = /^--workflow(?:\s+|=)([^\s]+)(?:\s+([\s\S]*))?$/.exec(goal);
      if (goal.startsWith('--workflow') && !workflowMatch) {
        return { attempted: false, ok: false, workflow: null, error: 'invalid --workflow syntax' };
      }
      if (workflowMatch) {
        profile = workflowMatch[1];
        goal = (workflowMatch[2] || '').trim();
        if (!AUTOPILOT_PROFILES.has(profile)) {
          return { attempted: false, ok: false, workflow: null, error: `unknown workflow profile: ${profile}` };
        }
      }
      args = ['start', ...contextArgs, '--workflow', profile, ...(goal ? ['--goal', goal] : [])];
    }
    return { attempted: true, ...workflowCommand(args, input, options) };
  }

  if (parsed.command === 'cancel') {
    const status = workflowCommand(['status', ...contextArgs], input, options);
    if (!status.ok || !status.workflow || status.workflow.status !== 'active') {
      return { attempted: true, ok: false, workflow: status.workflow };
    }
    const workflow = status.workflow;
    return {
      attempted: true,
      ...workflowCommand([
        'cancel',
        ...contextArgs,
        '--run', String(workflow.runId),
        '--revision', String(workflow.revision),
        '--stage', String(workflow.stage),
        '--reason', parsed.args || 'cancelled by explicit /cancel command',
      ], input, options),
    };
  }

  return { attempted: false, ok: false, workflow: null };
}

export function routePrompt(input, options = {}) {
  const prompt = input.prompt ?? input.user_prompt ?? '';
  const parsed = parseExplicitCommand(prompt);

  // Prose-level legacy alias: when a prompt mentions "ralplan" outside an
  // explicit slash command (e.g., "/ralplan was renamed to bizplan" or
  // "the ralplan workflow"), surface a routing context that directs the
  // operator to the bizplan skill. This is intentionally lower priority
  // than an explicit `/bizplan` (or `/plan`, `/ralplan`) match, which
  // the explicit-command parser above handles first.
  if (!parsed && typeof prompt === 'string' && BIZPLAN_PROSE_ALIAS_RE.test(prompt)) {
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          'Legacy "ralplan" reference detected. Bizplan is the only planning surface in Bizar; ' +
          'invoke the Skill tool with skill "bizplan" now and follow the tier decision tree.',
      },
    };
  }

  if (!parsed) return {};

  const state = applyExplicitWorkflowCommand(parsed, input, options);
  const lines = [
    `Explicit Bizar command detected: /${parsed.command}.`,
    `Invoke the Skill tool with skill "${parsed.skill}" now and follow that skill as the active workflow instruction.`,
  ];
  if (parsed.args) lines.push(`Command arguments: ${parsed.args}`);
  if (state.attempted && state.ok && state.workflow) {
    lines.push(
      `Durable workflow state: ${state.workflow.status} at stage ${state.workflow.stage} ` +
      `(run ${state.workflow.runId}, revision ${state.workflow.revision}).`,
    );
  } else if (state.attempted) {
    lines.push('Durable workflow state was not updated; do not assume it is active or cancelled. Diagnose through the selected skill.');
  } else if (state.error) {
    lines.push(`Durable workflow state was not updated: ${state.error}. Correct the command before continuing.`);
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: lines.join('\n'),
    },
  };
}

export function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { input = {}; }
  process.stdout.write(`${JSON.stringify(routePrompt(input))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
