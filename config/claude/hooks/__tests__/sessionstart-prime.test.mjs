import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'sessionstart-prime.mjs');

function writeOk(dir, kind, value) {
  const folder = kind === 'task' ? 'tasks' : kind === 'plan' ? 'plans' : 'prds';
  mkdirSync(join(dir, '.ok', folder), { recursive: true });
  if (kind === 'task') {
    // v2 format: directory with task.json
    mkdirSync(join(dir, '.ok', folder, value.id), { recursive: true });
    writeFileSync(join(dir, '.ok', folder, value.id, 'task.json'), JSON.stringify(value));
  } else {
    // v1 format for plans and prds (not yet migrated)
    writeFileSync(join(dir, '.ok', folder, `${value.id}.json`), JSON.stringify(value));
  }
}

function project({ active = true } = {}) {
  const dir = join(tmpdir(), `bizar-openkan-prime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, '.bizar'), { recursive: true });
  writeFileSync(join(dir, '.bizar', 'PROJECT.md'), '# TestProject\nA test fixture for the OpenKan SessionStart hook.\n');
  writeOk(dir, 'task', { schema: 'ok.task.v2', id: 'tsk-101', title: 'Wire OpenKan briefing', status: active ? 'in_progress' : 'pending' });
  writeOk(dir, 'plan', { schema: 'ok.plan.v1', id: 'plan-1', title: 'Migration', status: 'active' });
  writeOk(dir, 'prd', { schema: 'ok.prd.v1', id: 'prd-1', title: 'OpenKan-first Bizar', status: 'active' });
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  spawnSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function context(dir, input = {}) {
  const result = spawnSync(process.execPath, [hook], {
    cwd: dir, input: JSON.stringify({ source: 'startup', cwd: dir, ...input }), encoding: 'utf8', timeout: 8000,
    env: { ...process.env, BIZAR_HOME: join(dir, '.test-bizar-home') },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
}

test('startup reports active OpenKan work and active PRD', () => {
  const dir = project();
  try {
    const value = context(dir);
    assert.match(value, /OpenKan goal: prd-1 — active/);
    assert.match(value, /OpenKan active: tsk-101 — Wire OpenKan briefing/);
    assert.match(value, /A test fixture for the OpenKan SessionStart hook/);
    assert.match(value, /OpenKan \.ok is the sole task\/progress\/goals authority/);
    assert.doesNotMatch(value, /feature_list\.json|PROGRESS\.md|WIP=1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('startup tells the agent how to select ready OpenKan work', () => {
  const dir = project({ active: false });
  try {
    const value = context(dir);
    assert.match(value, /no active task/);
    assert.match(value, /ok task list/);
    assert.match(value, /ok prd list/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resume restores the OpenKan task handoff', () => {
  const dir = project();
  try {
    writeFileSync(join(dir, '.bizar', 'session-state.json'), JSON.stringify({ activeTask: 'tsk-101', nextStep: 'finish tests', blockers: ['Error: ENOENT'] }));
    const value = context(dir, { source: 'resume' });
    assert.match(value, /Last active OpenKan task: tsk-101/);
    assert.match(value, /finish tests/);
    assert.match(value, /Open blockers: Error: ENOENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('missing .ok remains a helpful, non-blocking briefing', () => {
  const dir = project();
  try {
    rmSync(join(dir, '.ok'), { recursive: true, force: true });
    const value = context(dir);
    assert.match(value, /\.ok\/ is not initialised/);
    assert.match(value, /ok init/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('briefing is bounded', () => {
  const dir = project();
  try {
    for (let i = 0; i < 40; i++) writeOk(dir, 'task', { schema: 'ok.task.v2', id: `tsk-${i}`, title: 'x'.repeat(100), status: 'in_progress' });
    assert.ok(context(dir).length <= 1200);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
