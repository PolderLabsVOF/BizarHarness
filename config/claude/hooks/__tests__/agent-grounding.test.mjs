import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const hooksDir = join(import.meta.dirname, '..');

function runHook(name, input) {
  const result = spawnSync(process.execPath, [join(hooksDir, name)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('every non-empty primary prompt receives mandatory Bizar routing', () => {
  const result = runHook('worker-suggest.mjs', {
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Add a button to the navbar.',
  });
  const context = result.hookSpecificOutput.additionalContext;
  assert.match(context, /mandatory Bizar routing/i);
  assert.match(context, /Agent tool/);
  assert.match(context, /@mike/);
  assert.match(context, /you ARE @mike/i);
});

test('specialized suggestions supplement rather than replace mandatory routing', () => {
  const result = runHook('worker-suggest.mjs', {
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Find the missing tests for authentication.',
  });
  const context = result.hookSpecificOutput.additionalContext;
  assert.match(context, /mandatory Bizar routing/i);
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
  // v10.20.0: payload trimmed from ~700 chars / 6 bullets to ~80 chars / 1 line.
  // Pin the agent-type echo, WebSearch mention, citation directive, and a
  // hard size budget so a future edit cannot quietly re-bloat the prompt.
  assert.match(context, /@linda/);
  assert.match(context, /WebSearch/);
  assert.match(context, /external-API/);
  assert.match(context, /Cite/);
  assert.ok(context.length <= 200, `payload ${context.length} chars exceeds 200`);
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
