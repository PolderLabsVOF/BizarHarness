import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleTeamLifecycle } from '../team-lifecycle.mjs';
import { selectEventChain } from '../../../../cli/commands/hook.mjs';

test('TaskCompleted is terminal and writes bounded state', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-team-hooks-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = handleTeamLifecycle({
    hook_event_name: 'TaskCompleted',
    session_id: 'session-1',
    teammate_name: 'worker-1',
    task_id: 'task-1',
    subject: 'x'.repeat(1000),
  }, { bizarHome: home });
  assert.match(result.hookSpecificOutput.additionalContext, /terminal \(completed\)/);
  const rows = readFileSync(join(home, 'telemetry', 'team-lifecycle.jsonl'), 'utf8').trim().split('\n');
  const record = JSON.parse(rows[0]);
  assert.equal(record.event, 'TaskCompleted');
  assert.equal(record.taskId, 'task-1');
  assert.ok(record.subject.length <= 301);
  const state = JSON.parse(readFileSync(join(home, 'telemetry', 'team-state', 'session-1.json'), 'utf8'));
  assert.equal(state.tasks[0].state, 'completed');
  assert.equal(state.tasks[0].taskId, 'task-1');
});

test('second idle notification tells the orchestrator to inspect and reassign', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-team-idle-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const input = { hook_event_name: 'TeammateIdle', session_id: 's', task_id: 't' };
  assert.deepEqual(handleTeamLifecycle(input, { bizarHome: home }), {});
  const second = handleTeamLifecycle(input, { bizarHome: home });
  assert.match(second.hookSpecificOutput.additionalContext, /idle 2 times/);
  assert.match(second.hookSpecificOutput.additionalContext, /stop and reassign/i);
});

test('portable dispatcher wires all current team lifecycle events', () => {
  assert.deepEqual(selectEventChain('task-created'), ['team-lifecycle']);
  assert.deepEqual(selectEventChain('task-completed'), ['team-lifecycle']);
  assert.deepEqual(selectEventChain('teammate-idle'), ['team-lifecycle']);
  assert.deepEqual(selectEventChain('subagent-stop', JSON.stringify({ agent_type: 'karen' })), [
    'team-lifecycle', 'verify-deliverables', 'worktree-archive',
  ]);
});

test('team lifecycle logging fails open', () => {
  assert.deepEqual(handleTeamLifecycle({ hook_event_name: 'TeammateIdle' }, { bizarHome: '/dev/null/unwritable' }), {});
});
