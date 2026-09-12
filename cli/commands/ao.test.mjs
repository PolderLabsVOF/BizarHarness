import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AO_RULES_FILE,
  configuredProjectConfig,
  defaultProjectId,
  isAoSession,
  materializeWorkerRules,
  parseAoArgs,
  setupAo,
} from './ao.mjs';

function scriptedRunner(responses, calls) {
  return (_binary, args) => {
    calls.push(args);
    const response = responses.shift();
    assert.ok(response, `unexpected AO command: ${args.join(' ')}`);
    return { status: response.status ?? 0, stdout: response.stdout ?? '', stderr: response.stderr ?? '' };
  };
}

test('parseAoArgs preserves supported AO passthrough commands', () => {
  assert.equal(parseAoArgs(['setup', '--model', 'gpt-5.6']).subcommand, 'setup');
  assert.equal(parseAoArgs(['session', 'ls']).subcommand, 'forward');
  assert.deepEqual(parseAoArgs(['session', 'ls']).forward, ['session', 'ls']);
});

test('defaultProjectId produces AO-safe project ids', () => {
  assert.equal(defaultProjectId('/work/Bizar Harness!'), 'bizar-harness');
});

test('isAoSession detects AO-owned sessions', () => {
  assert.equal(isAoSession({}), false);
  assert.equal(isAoSession({ AO_SESSION_ID: 'ao-42' }), true);
  assert.equal(isAoSession({ AO_PROJECT_ID: 'bizar' }), true);
});

test('configuredProjectConfig preserves unrelated AO configuration', () => {
  const next = configuredProjectConfig({
    env: { KEEP: 'yes' },
    autoReview: true,
    worker: { agent: 'claude-code', agentConfig: { mode: 'tui' } },
    orchestrator: { agent: 'claude-code' },
  }, { model: 'gpt-5.6', permissions: 'accept-edits' });

  assert.equal(next.env.KEEP, 'yes');
  assert.equal(next.autoReview, true);
  assert.equal(next.worker.agent, 'codex');
  assert.equal(next.worker.agentConfig.mode, 'tui');
  assert.equal(next.orchestrator.agent, 'codex');
  assert.equal(next.agentRulesFile, AO_RULES_FILE);
  assert.equal(next.agentConfig.model, 'gpt-5.6');
  assert.equal(next.agentConfig.permissions, 'accept-edits');
});

test('setupAo preserves an existing AO project configuration before replacing it', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bizar-ao-existing-'));
  const calls = [];
  const responses = [
    { stdout: JSON.stringify({ projects: [{ id: 'bizar' }] }) },
    { stdout: JSON.stringify({ project: { id: 'bizar', path: cwd, config: { autoReview: true, env: { KEEP: 'yes' } } } }) },
    { stdout: JSON.stringify({ project: { id: 'bizar' } }) },
  ];
  try {
    const result = setupAo({ cwd, execute: scriptedRunner(responses, calls) });

    assert.equal(result.ok, true);
    assert.deepEqual(calls[0], ['project', 'ls', '--json']);
    assert.deepEqual(calls[1], ['project', 'get', 'bizar', '--json']);
    assert.deepEqual(calls[2].slice(0, 4), ['project', 'set-config', 'bizar', '--config-json']);
    const config = JSON.parse(calls[2][4]);
    assert.equal(config.autoReview, true);
    assert.equal(config.env.KEEP, 'yes');
    assert.equal(config.worker.agent, 'codex');
    assert.equal(config.orchestrator.agent, 'codex');
    assert.equal(config.agentRulesFile, AO_RULES_FILE);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('setupAo registers a missing project as Codex roles before configuring it', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bizar-ao-missing-'));
  const calls = [];
  const responses = [
    { stdout: JSON.stringify({ projects: [] }) },
    { stdout: 'registered project bizar at /repo/bizar\n' },
    { stdout: JSON.stringify({ project: { id: 'bizar', path: cwd, config: {} } }) },
    { stdout: JSON.stringify({ project: { id: 'bizar' } }) },
  ];
  try {
    const result = setupAo({ cwd, execute: scriptedRunner(responses, calls) });

    assert.equal(result.ok, true);
    assert.deepEqual(calls[1], ['project', 'add', '--path', cwd, '--id', defaultProjectId(cwd), '--worker-agent', 'codex', '--orchestrator-agent', 'codex']);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('setupAo materializes AO worker rules in a non-Bizar target repository', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bizar-ao-target-'));
  const calls = [];
  const responses = [
    { stdout: JSON.stringify({ projects: [] }) },
    { stdout: 'registered project arbitrary-app\n' },
    { stdout: JSON.stringify({ project: { id: 'arbitrary-app', path: cwd, config: {} } }) },
    { stdout: JSON.stringify({ project: { id: 'arbitrary-app' } }) },
  ];
  try {
    const result = setupAo({ cwd, execute: scriptedRunner(responses, calls) });
    const rulesPath = join(cwd, AO_RULES_FILE);

    assert.equal(result.ok, true);
    assert.equal(existsSync(rulesPath), true);
    assert.match(readFileSync(rulesPath, 'utf8'), /sole owner of worker sessions/);
    const config = JSON.parse(calls[3][4]);
    assert.equal(config.agentRulesFile, AO_RULES_FILE);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('materializeWorkerRules preserves an existing project-owned file', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bizar-ao-rules-'));
  const rulesPath = join(cwd, AO_RULES_FILE);
  try {
    materializeWorkerRules(cwd);
    const initial = readFileSync(rulesPath, 'utf8');
    materializeWorkerRules(cwd);
    assert.equal(readFileSync(rulesPath, 'utf8'), initial);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
