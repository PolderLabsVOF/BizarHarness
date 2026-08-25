#!/usr/bin/env node
/**
 * .claude/hooks/control-inbox.mjs
 *
 * Bizar OpenKan — UserPromptSubmit / SessionStart hook.
 *
 * On UserPromptSubmit: reads queued control messages and injects them as
 * additional context so the primary session processes durable directives from
 * OpenKan before taking any action.
 *
 * On SessionStart: primes the session with the same control-inbox context so
 * agents see queued messages at session open.
 *
 * Uses import.meta.url + dynamic import() to resolve the sibling CLI module so
 * the hook works regardless of install path (fixes ERR_MODULE_NOT_FOUND after
 * installation when the repo source lived at a non-default location).
 * Lazy import inside the stdin handler avoids top-level-await issues in the
 * transitive dependency chain (control-store.mjs → task-ledger.mjs → better-sqlite3).
 *
 * Claude Code stdin shape (UserPromptSubmit / SessionStart):
 *   { session_id, cwd, hook_event_name }
 *
 * Claude Code stdout shape (hookSpecificOutput):
 *   { hookSpecificOutput: { hookEventName, additionalContext } }
 */

'use strict';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  let input = {};
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
    process.exit(0);
    return;
  }

  // Dynamic import so the hook resolves correctly regardless of install path.
  // Uses import.meta.url to anchor relative resolution.
  let claimControlMessages;
  try {
    ({ claimControlMessages } = await import(join(__dirname, '..', '..', '..', 'cli', 'control-store.mjs')));
  } catch (err) {
    process.stderr.write(`[bizar.control] WARN: could not load control-store: ${err && err.message ? err.message : String(err)}\n`);
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
    process.exit(0);
    return;
  }

  const cwd = input.cwd || process.cwd();
  const messages = claimControlMessages(cwd, {
    sessionId: input.session_id || '',
    agentType: input.agent_type || input.agent_id || '',
  });

  if (messages.length === 0) {
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
    process.exit(0);
    return;
  }

  const context = [
    '# Bizar control messages',
    '',
    'Process these durable messages in order. They were sent through OpenKan/Bizar.',
    '',
    ...messages.flatMap((message) => [
      `## Message ${message.id}`,
      `From: ${message.from}`,
      message.taskId ? `Task: ${message.taskId}` : null,
      '',
      message.text,
      '',
    ].filter(Boolean)),
  ].join('\n');

  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: input.hook_event_name || 'SessionStart',
      additionalContext: context,
    },
  }) + '\n');
  process.exit(0);
}

main();
