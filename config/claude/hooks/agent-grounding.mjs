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
  // v10.20.0: trim from 6 bullets / ~700 chars to one terse line.
  // Full policy lives in AGENT_BASELINE.md §4 (research and tool routing)
  // + agent-grounding.mjs context, referenced via the same hook on every dispatch.
  const context = `Bizar grounding for @${agentType}: WebSearch before external-API proposals. Read repo for local facts. Cite docs.`;

  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: context,
    },
  })}\n`);
});
