import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleTeamLifecycle } from '../team-lifecycle.mjs';
import { selectEventChain } from '../../../../cli/commands/hook.mjs';

test('team lifecycle hooks are advisory and write bounded evidence', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-team-hooks-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = handleTeamLifecycle({
    hook_event_name: 'TaskCompleted',
    session_id: 'session-1',
    teammate_name: 'worker-1',
    task_id: 'task-1',
    subject: 'x'.repeat(1000),
  }, { bizarHome: home });
  assert.deepEqual(result, {});
  const rows = readFileSync(join(home, 'telemetry', 'team-lifecycle.jsonl'), 'utf8').trim().split('\n');
  const record = JSON.parse(rows[0]);
  assert.equal(record.event, 'TaskCompleted');
  assert.equal(record.taskId, 'task-1');
  assert.ok(record.subject.length <= 301);
});

test('portable dispatcher wires all current team lifecycle events', () => {
  assert.deepEqual(selectEventChain('task-created'), ['team-lifecycle']);
  assert.deepEqual(selectEventChain('task-completed'), ['team-lifecycle']);
  assert.deepEqual(selectEventChain('teammate-idle'), ['team-lifecycle']);
});

test('team lifecycle logging fails open', () => {
  assert.deepEqual(handleTeamLifecycle({ hook_event_name: 'TeammateIdle' }, { bizarHome: '/dev/null/unwritable' }), {});
});
