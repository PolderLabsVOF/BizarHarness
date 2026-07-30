import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  claimControlMessages,
  enqueueControlMessage,
  listControlAgents,
  listControlMessages,
  stopControlSession,
} from './control-store.mjs';

const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), 'bizar-control-'));
  roots.push(root);
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  return root;
}

test('control store exposes installed Bizar agent metadata', () => {
  const root = project();
  writeFileSync(join(root, '.claude', 'agents', 'todd.md'), [
    '---',
    'name: todd',
    'description: Tests and verifies implementation.',
    'model: sonnet',
    '---',
    '# Todd',
  ].join('\n'));

  assert.deepEqual(listControlAgents(root), [{
    id: 'todd',
    name: 'todd',
    description: 'Tests and verifies implementation.',
    model: 'sonnet',
    source: '.claude/agents/todd.md',
  }]);
});

test('control inbox atomically claims a targeted message once', () => {
  const root = project();
  const message = enqueueControlMessage(root, {
    from: 'openkan',
    toAgent: 'todd',
    text: 'Please run the full verification gate.',
  });

  const first = claimControlMessages(root, {
    sessionId: 'session-1',
    agentType: 'todd',
  });
  const second = claimControlMessages(root, {
    sessionId: 'session-1',
    agentType: 'todd',
  });

  assert.equal(first.length, 1);
  assert.equal(first[0].id, message.id);
  assert.equal(first[0].deliveredTo.sessionId, 'session-1');
  assert.deepEqual(second, []);
  assert.equal(listControlMessages(root).messages[0].status, 'delivered');
});

test('control inbox leaves messages for other recipients queued', () => {
  const root = project();
  enqueueControlMessage(root, {
    from: 'mike',
    toSession: 'session-2',
    text: 'Review the plan.',
  });

  assert.deepEqual(claimControlMessages(root, {
    sessionId: 'session-1',
    agentType: 'paul',
  }), []);
  assert.equal(listControlMessages(root).messages[0].status, 'queued');
});

test('control stop signals only a Claude-reported live session PID', () => {
  const root = project();
  const fake = join(root, 'claude');
  writeFileSync(fake, `#!/usr/bin/env node
if (process.argv[2] === 'agents') process.stdout.write(JSON.stringify([{
  sessionId: '12345678-1234-4234-8234-123456789abc',
  state: 'running',
  pid: 4242
}]));
`);
  chmodSync(fake, 0o755);
  const previous = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = fake;
  const signals = [];
  try {
    const result = stopControlSession(
      root,
      '12345678-1234-4234-8234-123456789abc',
      (pid, signal) => signals.push({ pid, signal }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(signals, [{ pid: 4242, signal: 'SIGTERM' }]);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = previous;
  }
});
