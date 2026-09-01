#!/usr/bin/env node
/**
 * .claude/hooks/worker-suggest.mjs
 *
 * Bizar Background Workers — UserPromptSubmit hook.
 *
 * Runs on every user prompt. Small, repository-local requests take a cheap
 * fast path without loading the worker/learning modules. Larger requests get
 * routing and specialized suggestions from cli/worker-dispatcher.mjs.
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

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Fast work must be small, local, and mechanically bounded. This deliberately
 * rejects external integrations and cross-cutting changes: those need the
 * normal routing path. Keeping the classifier lexical makes it free on the
 * UserPromptSubmit hot path and easy to explain to the model.
 */
function isFastLocalTask(prompt) {
  if (prompt.length > 500 || prompt.split('\n').length > 3) return false;
  if (!/\b(fix|correct|rename|remove|delete|format|typo|style|padding|margin|color|spacing|align|change|update)\b/i.test(prompt)) return false;
  return !/\b(api|sdk|library|framework|dependency|version|migration|architecture|security|auth|credential|deploy|publish|release|database|workflow|agent team|hook|performance|benchmark|all files|every file|failing|failure|error|crash|root cause|regression)\b/i.test(prompt);
}

const FAST_ROUTE_POLICY = [
  'Bizar fast path:',
  '- This is a small, bounded, repository-local request. The primary orchestrator may execute it directly; otherwise dispatch exactly one @brenda worker with call-level `isolation: "worktree"`. Do not research, plan, or review first.',
  '- Inspect the named/local code, make the smallest reversible change, add or adjust only the directly relevant regression test when behavior changes, and run the smallest proving check. Use current official documentation only if the change touches an external or version-sensitive API.',
  '- Do not fan out duplicate analysis. Parallelize only independent file scopes; a single-file fix stays single-worker to avoid worktree and merge overhead.',
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

  if (input.task_notification || /<task-notification\b[\s\S]*<result\b/i.test(prompt)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'Bizar terminal task update: consume the structured status and <result> now. Mark the agent terminal, merge any queued worktree, continue the active objective, and do not route this notification as a new request.',
      },
    }) + '\n');
    return;
  }

  if (/^\/quick(?:\s|$)/i.test(prompt)) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '' } }) + '\n');
    return;
  }

  // /quick sentinel bypass: when .bizar/.quick-once exists, skip the
  // orchestrator routing policy for this single turn. The sentinel is
  // created by the /quick slash command and removed by session-end.
  const quickSentinel = join(input.cwd || process.cwd(), '.bizar', '.quick-once');
  if (existsSync(quickSentinel)) {
    try { unlinkSync(quickSentinel); } catch { /* best-effort one-shot cleanup */ }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: '',
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

  const routePolicy = [
    'Adaptive Bizar routing policy:',
    '- If this is the primary session, you ARE @mike. Execute small deterministic repository work directly, or use the Agent tool for one @brenda worktree worker when isolation helps. Do not add research, planning, review, or a second worker unless the task needs it.',
    '- For a known, multi-file change, first split only genuinely disjoint edit scopes and dispatch those writers concurrently with call-level `isolation: "worktree"`. A monolithic scope gets one writer, not artificial parallelism.',
    '- Use research and planning only when external/version-sensitive behavior, an unclear root cause, an architectural decision, or interacting scopes make them decision-reducing. When required, run independent research in parallel with repository inspection.',
    '- Do NOT execute any tool you do not have. If a tool you need is missing from your tools list, dispatch to a subagent that has it — do not pretend you have it.',
    '- If you are already running as a Bizar custom agent, follow your assigned role and do not recursively dispatch yourself.',
  ].join('\n');

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
        additionalContext: routePolicy,
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
        additionalContext: routePolicy,
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
  let note = routePolicy;
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
