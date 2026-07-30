#!/usr/bin/env node

import { claimControlMessages } from '../../cli/control-store.mjs';

let input = {};
try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  input = raw.trim() ? JSON.parse(raw) : {};
} catch {
  process.stdout.write(JSON.stringify({ continue: true }) + '\n');
  process.exit(0);
}

const cwd = input.cwd || process.cwd();
const messages = claimControlMessages(cwd, {
  sessionId: input.session_id || '',
  agentType: input.agent_type || input.agent_id || '',
});

if (messages.length === 0) {
  process.stdout.write(JSON.stringify({ continue: true }) + '\n');
  process.exit(0);
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

