import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const BIN = resolve(import.meta.dirname, '..', 'bin.mjs');
const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bizar-control-command-'));
  roots.push(root);
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(root, '.claude', 'agents', 'mike.md'), [
    '---',
    'name: mike',
    'description: Office manager',
    '---',
  ].join('\n'));
  mkdirSync(join(root, '.ok', 'tasks'), { recursive: true });
  mkdirSync(join(root, '.ok', 'plans'), { recursive: true });
  mkdirSync(join(root, '.ok', 'prds'), { recursive: true });
  writeFileSync(join(root, '.ok', 'tasks', 'tsk-120.json'), JSON.stringify({ schema: 'ok.task.v1', id: 'tsk-120', title: 'OpenKan integration', status: 'in_progress' }));
  writeFileSync(join(root, '.ok', 'plans', 'pln-120.json'), JSON.stringify({ schema: 'ok.plan.v1', id: 'pln-120', title: 'Adoption' }));
  writeFileSync(join(root, '.ok', 'prds', 'prd-120.json'), JSON.stringify({ schema: 'ok.prd.v1', id: 'prd-120', title: 'Planning', goals: [] }));

  const log = join(root, 'claude-args.jsonl');
  const fake = join(root, 'claude');
  writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'agents') {
  process.stdout.write(JSON.stringify([{
    id: 'abc12345',
    sessionId: 'abc12345-1234-4234-8234-123456789abc',
    cwd: process.cwd(),
    name: 'Managed session',
    state: 'running',
    status: 'working',
    pid: 999999,
    startedAt: 1000
  }]));
}
`);
  chmodSync(fake, 0o755);
  return { root, fake, log };
}

function run(root, fake, args) {
  return spawnSync(process.execPath, [BIN, 'control', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      BIZAR_SKIP_BUILD: '1',
      CLAUDE_BIN: fake,
    },
  });
}

test('control snapshot returns agents, tasks, sessions, and messages as JSON', () => {
  const { root, fake } = fixture();
  const result = run(root, fake, ['snapshot', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(result.stdout);
  assert.equal(snapshot.projectRoot, root);
  assert.equal(snapshot.agents[0].id, 'mike');
  assert.equal(snapshot.sessions[0].sessionId, 'abc12345-1234-4234-8234-123456789abc');
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.tasks[0].id, 'tsk-120');
  assert.equal(snapshot.plans[0].id, 'pln-120');
  assert.equal(snapshot.goals[0].id, 'prd-120');
  assert.deepEqual(snapshot.messages, []);
  assert.equal(snapshot.features, undefined);
  assert.equal(snapshot.progress, undefined);
});

test('control session send queues a message and resumes through Claude background mode', () => {
  const { root, fake, log } = fixture();
  const id = 'abc12345-1234-4234-8234-123456789abc';
  const result = run(root, fake, [
    'session', 'send', id,
    '--text', 'Check the updated task.',
    '--from', 'openkan',
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.message.toSession, id);
  assert.equal(body.dispatch.ok, true);

  const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.some((args) =>
    args.includes('--background') && args.includes('--resume') && args.includes(id)));
});
