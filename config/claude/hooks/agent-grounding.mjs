#!/usr/bin/env node
/**
 * Inject current-documentation and evidence requirements into every subagent.
 *
 * SubagentStart hooks cannot block creation, but their additionalContext is
 * added before the agent's first prompt. The static agent verifier separately
 * guarantees that every shipped Bizar agent can call WebSearch.
 */
'use strict';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    input = {};
  }

  const agentType = String(input.agent_type || 'unknown');
  // Keep universal context below 200 characters; detailed policy stays in the
  // shared baseline and skill bodies load only when selected.
  const context = `Bizar @${agentType}: use relevant installed skills and i-have-adhd. Search skills.sh only if hard/stuck with no match. WebSearch official docs externally; repo evidence locally.`;

  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: context,
    },
  })}\n`);
});
