#!/usr/bin/env node
/**
 * .claude/hooks/worker-suggest.mjs
 *
 * Bizar Background Workers — UserPromptSubmit hook.
 *
 * Runs on every user prompt. Only unmistakably tiny, single-scope edits take
 * a cheap fast path. Every other request is routed into a team-first Bizar
 * coordination mode selected by Mike after bounded orientation.
 *
 * Uses import.meta.url + dynamic import() to resolve the sibling CLI module so
 * the hook works regardless of install path (fixes ERR_MODULE_NOT_FOUND after
 * installation when the repo source lived at a non-default location).
 * Lazy import inside the stdin handler avoids top-level-await issues in any
 * transitive dependency chain.
 *
 * Claude Code stdin shape (UserPromptSubmit):
 *   {
 *     "session_id": "...",
 *     "transcript_path": "...",
 *     "cwd": "...",
 *     "hook_event_name": "UserPromptSubmit",
 *     "prompt": "raw prompt text"
 *   }
 *
 * Claude Code stdout shape (hookSpecificOutput.additionalContext):
 *   { "hookSpecificOutput": {
 *       "hookEventName": "UserPromptSubmit",
 *       "additionalContext": "Bizar workers suggest: …"
 *   }}
 *
 * On any unexpected error: log to stderr, write a no-op hook output,
 * exit 0. Never block the user.
 */
'use strict';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTinyDirectTask } from './workflow-route-state.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Fast work must be small, local, and mechanically bounded. This deliberately
 * rejects external integrations and cross-cutting changes: those need the
 * normal routing path. Keeping the classifier lexical makes it free on the
 * UserPromptSubmit hot path and easy to explain to the model.
 */
const isFastLocalTask = isTinyDirectTask;

const FAST_ROUTE_POLICY = [
  'Bizar tiny direct path:',
  '- Direct execution is allowed only because this request is an unmistakably tiny, single-scope copy/style/format edit. Inspect the exact target, make one minimal reversible edit, and run the smallest proving check. Do not plan, research, or dispatch a subagent.',
  '- If inspection reveals behavioral logic, more than one target, ambiguity, a required test change, or any interaction beyond the named micro-edit, stop the direct path and invoke the matching native Bizar workflow before editing further.',
].join('\n');

const QUICK_ROUTE_POLICY = [
  'Bizar /quick direct path:',
  '- The user explicitly selected direct, primary-session execution for this turn. Do not create an Agent team, dispatch a subagent, or start a workflow merely because the request is substantial.',
  '- Do bounded read-only orientation, then proceed autonomously when the requested outcome, acceptance criteria, and safety boundary are clear. Ask only when a material choice or missing success criterion prevents a safe, correct implementation.',
  '- /quick never bypasses worktree, approval, credential, destructive-action, or verification safeguards. Run the smallest relevant proof before reporting completion.',
].join('\n');

const ROUTE_POLICY = [
  'Adaptive Bizar routing policy:',
  '- If this is the primary session, you ARE @mike. First do only bounded read-only orientation. If the inferred outcome, acceptance criteria, and safety boundary are clear, continue without a clarification question. Ask one concise question only when a material choice, unresolved constraint, or missing success criterion would change the work.',
  '- For substantive work, native Agent teams are the default execution method. Form a small team with clear ownership, use a lead to integrate evidence, and use worktrees for editors. Use direct execution only for an unmistakably tiny edit or an explicit /quick request. Use a single agent or a native workflow only when the user explicitly requests that mode or an existing workflow must be resumed.',
  '- For every normal Agent, workflow worker, or agent-team teammate, pick ONE of the four native aliases (`haiku`, `sonnet`, `opus`, `fable`) as the native `model` field per the alias policy in the plan: `haiku` for trivial/cheap, `sonnet` for ordinary work, `opus` for hard / architectural / adversarial / debug / high-risk review lanes, `fable` for explicit Anthropic OpenAI-compat surfaces. Do NOT pass a raw gateway ID (e.g., `claude-minimax/...`, `cx/...`); OmniRoute handles ordered failover between configured full IDs for the chosen alias. Do NOT read model-router state, user-selected profiles, tier hints, or health snapshots. Do NOT construct `args.routing`. For teams, do not name a competing model in the spawn prompt. Every editing worker uses call-level `isolation: "worktree"`. For genuinely disjoint writable scopes, dispatch concurrently; otherwise use one owner.',
  '- Consume each terminal agent result exactly once from its original `<result>`/final summary, merge queued worktrees with bizar worktree-merge, and run integration checks in the primary session. Never send a terminal notification, idle ping, or completed task back to that agent as a follow-up and never re-dispatch a completed background agent merely to summarize its result. A subagent may not recursively dispatch itself.',
  '- Do NOT execute any tool you do not have. If a tool you need is missing from your tools list, dispatch to a subagent that has it — do not pretend you have it.',
  '- If you are already running as a Bizar custom agent, follow your assigned role and do not recursively dispatch yourself.',
].join('\n');

/**
 * OMX-derived primitive hints — surfaced additively in `additionalContext` when
 * the prompt exhibits the documented signal. These are *informational pivots*
 * that complement the dispatcher-emitted worker suggestions; they do not
 * modify the dispatcher itself. See `office-manager.md` for the gating
 * contract (HITL floor, ambiguity floor ≤ 0.10) that governs every primitive.
 */
const OMX_PRIMITIVE_HINTS = [
  'Bizar OMX-derived primitive pivots (Phase 6):',
  '- Prompt is brief, broad, or missing acceptance criteria, decision boundaries, or non-goals → consider `deep-interview` (Stage 1-3 spec crispening). Only resume normal routing after the spec crystallizes at ambiguity ≤ 0.10.',
  '- Request describes a multi-objective run with sub-stories, weighted lanes, or checkpoints → consider `ultragoal` (durable progress tracker with four-lane completion fence). Treat its terminal transitions as the completion contract.',
  '- User asks for a research-grounded plan, architecture decision, or "what should we do" without immediate implementation → consider `ralplan` (separate planner + adversarial reviewer). Do not let execution leak past the `plan` stage.',
  '- Greenfield ideation with no spec yet ("I want to build X") → consider `brainstorming` before any deep-interview or ralplan escalation.',
  '- Two non-negotiable gates always apply: (1) surface any HITL-floor category (push, PR mutation, release, publish, deploy, prod write, credential, public exposure, irreversible destruction) before continuing, even when `/autopilot` or `/ultragoal` is in flight; (2) refuse to advance past `/deep-interview` while the spec ambiguity score is > 0.10.',
].join('\n');

/**
 * Returns true when the prompt is brief enough and anchor-free enough to merit
 * a proactive `deep-interview` redirect. Mirrors the office-manager row
 * "Brief crispening first": effective words ≤ 25 AND zero concrete anchors.
 *
 * "Concrete anchors" here means file paths, symbol names, named APIs/CLIs,
 * version numbers, or quoted identifiers. The check is lexical and bounded
 * so it stays free on the UserPromptSubmit hot path.
 */
function shouldSuggestDeepInterview(prompt) {
  const text = String(prompt ?? '').trim();
  if (text.length === 0) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 25) return false;
  const anchorPattern = /(?:[./\\][\w./-]+|`[^`]+`|"[^"]+"|'\w+'|\b\d+(?:\.\d+)+\b|\b[A-Z][A-Z0-9_]{2,}\b|\b(?:[a-z]+:[a-z]+|\w+:\/\/\S+))/;
  return !anchorPattern.test(text);
}

/**
 * Returns true when the prompt matches a multi-objective / long-horizon signal.
 * Lexical and bounded; no regex backtracking.
 */
function shouldSuggestUltragoal(prompt) {
  const text = String(prompt ?? '').trim();
  if (text.length === 0) return false;
  return /\b(?:(?:multi|several|multiple)[-\s]?(?:objective|story|stories|goal|goals|task|tasks)|(?:sub[-\s]?stor(?:y|ies)|sub[-\s]?goal|weighted\s+lanes|checkpoint(?:s)?|long[-\s]?horizon))\b/i.test(text);
}

/**
 * Returns true when the prompt explicitly asks for a plan / architecture
 * decision without immediate implementation.
 */
function shouldSuggestRalplan(prompt) {
  const text = String(prompt ?? '').trim();
  if (text.length === 0) return false;
  if (/\b(?:implement|build|write|code|scaffold|ship|deploy)\b/i.test(text)) return false;
  return /\b(?:plan|planning|architect(?:ure)?|design\s+decision|consensus|what\s+should\s+we\s+do|how\s+should\s+we|roadmap|approach)\b/i.test(text);
}

/**
 * Returns true when the prompt is a greenfield ideation request — vague
 * product need with no spec yet.
 */
function shouldSuggestBrainstorming(prompt) {
  const text = String(prompt ?? '').trim();
  if (text.length === 0) return false;
  if (/(?:\.[a-z0-9]{1,5}\b|`[^`]+`|"\w+"|\b\d+(?:\.\d+)+\b)/.test(text)) return false;
  return /\b(?:i\s+want\s+to\s+build|let'?s\s+build|new\s+(?:app|product|feature|tool|service|system|project)|idea\s+for|thinking\s+about\s+building|brainstorm(?:ing)?)\b/i.test(text);
}

/**
 * Builds the Phase-6 OMX primitive pivot block. Always emits the gate
 * reminder so destructive-action surfacing and the ambiguity floor stay
 * visible on every non-empty prompt. Individual primitive names are added
 * only when their lexical signal matches; this keeps the block short for
 * prompts that already have a clear shape.
 */
function buildOmxPrimitiveHints(prompt) {
  const text = String(prompt ?? '').trim();
  if (text.length === 0) return '';

  const pivots = [];
  if (shouldSuggestDeepInterview(prompt)) pivots.push('deep-interview (Stage 1-3 spec crispening — prompt is broad or anchor-free)');
  if (shouldSuggestUltragoal(prompt)) pivots.push('ultragoal (long-horizon multi-objective run with checkpoint steer)');
  if (shouldSuggestRalplan(prompt)) pivots.push('ralplan (consensus plan only — planner + adversarial reviewer)');
  if (shouldSuggestBrainstorming(prompt)) pivots.push('brainstorming (greenfield ideation, no spec yet)');

  if (pivots.length === 0) {
    return OMX_PRIMITIVE_HINTS;
  }

  return [
    OMX_PRIMITIVE_HINTS,
    '',
    'Matched pivots for this prompt:',
    ...pivots.map((p) => `- ${p}`),
  ].join('\n');
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', async () => {
  let input = {};
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    input = {};
  }

  const prompt = String(input.prompt ?? input.user_prompt ?? '').trim();

  if (input.task_notification || /^<task-notification\b[\s\S]*<result\b[\s\S]*<\/task-notification>\s*$/i.test(prompt)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'Bizar terminal task update: consume this original structured <result> exactly once. Mark the agent terminal and merge any queued worktree. Do not send this notification back to the agent, do not request a follow-up acknowledgement, and do not replace its result with a later idle/status reply.',
      },
    }) + '\n');
    return;
  }

  if (/^\/quick(?:\s|$)/i.test(prompt)) {
    const quickTask = prompt.replace(/^\/quick(?:\s+|$)/i, '').trim();
    const context = !quickTask ? FAST_ROUTE_POLICY : QUICK_ROUTE_POLICY;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }) + '\n');
    return;
  }

  // Empty prompts get the silent treatment — the user has not yet
  // committed any intent.
  if (prompt.length === 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: '',
      },
    }) + '\n');
    process.exit(0);
    return;
  }

  // Avoid dynamic imports, ledger writes, and broad routing context for the
  // common small-fix path. Those operations are useful for substantial work
  // but add latency before the model can begin a deterministic edit.
  if (isFastLocalTask(prompt)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: FAST_ROUTE_POLICY,
      },
    }) + '\n');
    process.exit(0);
    return;
  }

  let dispatch;
  let recordSuggestion;
  try {
    ({ dispatch, recordSuggestion } = await import(join(__dirname, '..', '..', '..', 'cli', 'worker-dispatcher.mjs')));
  } catch (err) {
    process.stderr.write(
      `[bizar.workers] WARN: dispatch failed (import): ${err?.message ?? String(err)}\n`,
    );
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: ROUTE_POLICY,
      },
    }) + '\n');
    process.exit(0);
    return;
  }

  let suggestions;
  try {
    suggestions = dispatch(prompt, { maxSuggestions: 3 });
  } catch (err) {
    process.stderr.write(
      `[bizar.workers] WARN: dispatch failed: ${err?.message ?? String(err)}\n`,
    );
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: ROUTE_POLICY,
      },
    }) + '\n');
    process.exit(0);
    return;
  }

  // Emit one stderr line per suggestion (for operator visibility in logs).
  for (const s of suggestions) {
    const skill = s.skill ? `skill: ${s.skill}` : 'skill: (none)';
    const agent = s.agent ? `, agent: ${s.agent}` : '';
    process.stderr.write(
      `[bizar.workers] suggested: ${s.workerId} (${skill}${agent}) via pattern "${s.matchedPattern}"\n`,
    );
  }

  // Phase D write side: persist a fingerprint-only `worker-suggest` row to
  // behavior.jsonl so future sessions can learn which workers the operator
  // accepted vs rejected. The record carries no prompt text — only worker
  // ids, agents, skills, and a fingerprint over the canonicalized record.
  // Failure is silent (never throw from the hook path).
  if (suggestions.length > 0) {
    try {
      await recordSuggestion({
        matches: suggestions,
        cwd: input.cwd || process.cwd(),
        env: process.env,
      });
    } catch (err) {
      process.stderr.write(
        `[bizar.workers] WARN: recordSuggestion raised: ${err?.message ?? String(err)}\n`,
      );
    }
  }

  // Build additionalContext for the model so Bizar routing is mandatory even
  // when no specialized worker pattern matches.
  let note = ROUTE_POLICY;
  if (suggestions.length > 0) {
    const lines = suggestions.map((s) => {
      const skillPart = s.skill ? `, skill=${s.skill}` : '';
      const agentPart = s.agent ? `, agent=${s.agent}` : '';
      return `- ${s.workerId} (weight=${s.weight}${skillPart}${agentPart}) matched "${s.matchedPattern}"`;
    });
    note +=
      '\n\n' +
      'Bizar workers suggest the following skills/agents for this prompt:\n' +
      lines.join('\n');
  }

  // Phase 6: append the OMX-derived primitive pivot block. Always emits the
  // gate reminder so destructive-action surfacing and the ambiguity floor
  // stay visible on every non-empty prompt; per-primitive entries only
  // appear when the prompt's lexical signal matches.
  const omxHints = buildOmxPrimitiveHints(prompt);
  if (omxHints) note += '\n\n' + omxHints;

  // Append only the bounded explicit-learning snapshot. Historical suggestion
  // telemetry is evidence, not an instruction source.
  try {
    const { buildLearningContext } = await import(
      join(__dirname, '..', '..', '..', 'cli', 'commands', 'learn.mjs')
    );
    const feed = buildLearningContext({ cwd: input.cwd || process.cwd(), env: process.env });
    if (feed) note += '\n\n' + feed;
  } catch (err) {
    process.stderr.write(
      `[bizar.workers] WARN: learning feed unavailable: ${
        err && err.message ? err.message : String(err)
      }\n`,
    );
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: note,
    },
  }) + '\n');
  process.exit(0);
});
