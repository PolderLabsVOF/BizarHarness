#!/usr/bin/env node
/**
 * .claude/hooks/worker-suggest.mjs
 *
 * Bizar Background Workers — UserPromptSubmit hook.
 *
 * Runs on every user prompt. Only unmistakably tiny, single-scope edits take
 * a cheap fast path. Every other request is routed into a native Bizar
 * adaptive coordination mode selected by Mike after bounded orientation and a
 * clarification checkpoint.
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
import { existsSync, unlinkSync } from 'node:fs';
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

const ROUTE_POLICY = [
  'Adaptive Bizar routing policy:',
  '- If this is the primary session, you ARE @mike. First do only bounded read-only orientation. Then ask one concise clarification question describing the inferred outcome, the material choice/risk, and your proposed coordination mode. Wait for the answer before edits, branches, tests, or editor dispatch. If the user explicitly waives questions, continue autonomously.',
  '- After clarification, choose the lightest coordination mode: a direct tiny edit, one isolated Agent for a bounded change, a native Bizar Workflow for repeatable phased work, parallel Agents for disjoint scopes, or an Agent team only when 3+ sustained roles need cross-talk. Do not force a workflow or team when it adds no value.',
  '- For every Agent, workflow worker, or agent-team teammate, choose one exact ID from the enabled `bizar models` user selection, then obtain its generated definition name from `bizar models --agent-types --json`. Pass that name as `subagent_type` and OMIT the native `model` field. The definition frontmatter owns the exact gateway ID. Never put a raw gateway ID or a Claude family alias in the native model field; aliases are compatibility-only. For teams, do not name a competing model in the spawn prompt. If the map or definition is missing, run `bizar models`; do not retry by cycling providers or tiers. Every editing worker uses call-level `isolation: "worktree"`. For genuinely disjoint writable scopes, dispatch concurrently; otherwise use one owner.',
  '- Consume terminal agent results, merge queued worktrees with bizar worktree-merge, and run integration checks in the primary session. A subagent may not recursively dispatch itself.',
  '- Do NOT execute any tool you do not have. If a tool you need is missing from your tools list, dispatch to a subagent that has it — do not pretend you have it.',
  '- If you are already running as a Bizar custom agent, follow your assigned role and do not recursively dispatch yourself.',
].join('\n');

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
        additionalContext: 'Bizar terminal task update: consume the structured status and <result> now. Mark the agent terminal, merge any queued worktree, continue the active objective, and do not route this notification as a new request.',
      },
    }) + '\n');
    return;
  }

  if (/^\/quick(?:\s|$)/i.test(prompt)) {
    const quickTask = prompt.replace(/^\/quick(?:\s+|$)/i, '').trim();
    const context = !quickTask || isFastLocalTask(quickTask) ? FAST_ROUTE_POLICY : ROUTE_POLICY;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }) + '\n');
    return;
  }

  // /quick sentinel bypass: when .bizar/.quick-once exists, skip the
  // orchestrator routing policy for this single turn. The sentinel is
  // created by the /quick slash command and removed by session-end.
  const quickSentinel = join(input.cwd || process.cwd(), '.bizar', '.quick-once');
  if (existsSync(quickSentinel)) {
    try { unlinkSync(quickSentinel); } catch { /* best-effort one-shot cleanup */ }
    const context = isFastLocalTask(prompt) ? FAST_ROUTE_POLICY : ROUTE_POLICY;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context,
      },
    }) + '\n');
    process.exit(0);
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
