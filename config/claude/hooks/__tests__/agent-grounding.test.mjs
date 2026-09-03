import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const hooksDir = join(import.meta.dirname, '..');

function runHook(name, input) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [join(hooksDir, name)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 5_000,
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('every non-empty primary prompt receives adaptive Bizar routing', () => {
  const result = runHook('worker-suggest.mjs', {
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Add a button to the navbar.',
  });
  const context = result.hookSpecificOutput.additionalContext;
  assert.match(context, /Adaptive Bizar routing/i);
  assert.match(context, /Ask one concise question only/);
  assert.match(context, /Agent teams are the default execution method/);
  assert.match(context, /@mike/);
  assert.match(context, /you ARE @mike/i);
});

test('specialized suggestions supplement rather than replace adaptive routing', () => {
  const result = runHook('worker-suggest.mjs', {
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Find the missing tests for authentication.',
  });
  const context = result.hookSpecificOutput.additionalContext;
  assert.match(context, /Adaptive Bizar routing/i);
  assert.match(context, /Bizar workers suggest/i);
});

test('empty primary prompts remain silent', () => {
  const result = runHook('worker-suggest.mjs', {
    hook_event_name: 'UserPromptSubmit',
    prompt: '   ',
  });
  assert.equal(result.hookSpecificOutput.additionalContext, '');
});

test('every subagent receives terse grounding', () => {
  const result = runHook('agent-grounding.mjs', {
    hook_event_name: 'SubagentStart',
    agent_id: 'agent-123',
    agent_type: 'linda',
  });
  const context = result.hookSpecificOutput.additionalContext;
  // Pin the agent-type echo, skill behavior, WebSearch directive, and a
  // hard size budget so a future edit cannot quietly re-bloat the prompt.
  assert.match(context, /@linda/);
  assert.match(context, /WebSearch/);
  assert.match(context, /i-have-adhd/);
  assert.match(context, /skills\.sh/);
  assert.match(context, /hard\/stuck/);
  assert.ok(context.length <= 240, `payload ${context.length} chars exceeds 240`);
});

test('project settings apply grounding to all subagents', () => {
  const settings = JSON.parse(
    readFileSync(join(hooksDir, '..', 'settings.json'), 'utf8'),
  );
  const hooks = settings.hooks.SubagentStart;
  // F-169: SubagentStart hook now routes through the wrapper shim (either
  // via sh -c probe OR an absolute wrapper path). Match the subagent-start
  // subcommand label regardless of which wrapper form shipped.
  const grounding = hooks.find((entry) =>
    JSON.stringify(entry).includes('subagent-start'));
  assert.ok(grounding, 'SubagentStart must run the portable Bizar dispatcher');
  assert.equal(
    grounding.matcher,
    undefined,
    'documentation grounding must not be limited to selected agent types',
  );
});
