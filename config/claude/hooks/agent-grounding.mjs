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
  const context = [
    `Bizar grounding policy for @${agentType}:`,
    '- For any external API, library, framework, CLI, configuration format, or version-sensitive behavior, use WebSearch before proposing or attempting a solution.',
    '- Search for the current official documentation, then open the exact relevant page with WebFetch. Prefer primary vendor documentation over blogs, snippets, memory, or examples.',
    '- Do not guess an API shape and do not use trial-and-error as a substitute for reading documentation.',
    '- If official documentation is unavailable or ambiguous, inspect authoritative source code, state the evidence gap, and keep conclusions qualified.',
    '- For repository-local facts, inspect the actual files, tests, and tool output; do not manufacture an unnecessary web citation.',
    '- Report the documentation or source evidence used in your handoff.',
  ].join('\n');

  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: context,
    },
  })}\n`);
});
