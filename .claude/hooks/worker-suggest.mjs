#!/usr/bin/env node
/**
 * .claude/hooks/worker-suggest.mjs
 *
 * Bizar Background Workers — UserPromptSubmit hook.
 *
 * Runs on every user prompt. Injects the mandatory Bizar delegation policy,
 * then calls `dispatch()` from cli/worker-dispatcher.mjs to add specialized
 * skill/agent suggestions. Emits suggestions to stderr (stdout is reserved for
 * Claude Code's hook protocol).
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

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  const routePolicy = [
    'Mandatory Bizar routing policy:',
    '- If this is the primary session, use the Agent tool to delegate the request to custom Bizar agent @mike before doing task analysis or implementation.',
    '- @mike must route trivial work to @brenda and non-trivial work through the configured research, plan, implementation, review, and verification agents.',
    '- Do not implement directly in the primary session.',
    '- If you are already running as a Bizar custom agent, follow your assigned role and do not recursively dispatch yourself.',
  ].join('\n');

  let dispatch;
  try {
    ({ dispatch } = await import(join(__dirname, '..', '..', 'cli', 'worker-dispatcher.mjs')));
  } catch (err) {
    process.stderr.write(
      `[bizar.workers] WARN: dispatch failed (import): ${
        err && err.message ? err.message : String(err)
      }\n`,
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
      `[bizar.workers] WARN: dispatch failed: ${
        err && err.message ? err.message : String(err)
      }\n`,
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

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: note,
    },
  }) + '\n');
  process.exit(0);
});
