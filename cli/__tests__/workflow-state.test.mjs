import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  WORKFLOW_LIMITS,
  WORKFLOW_STAGES,
  MAX_WORKFLOW_EVIDENCE_LENGTH,
  MAX_WORKFLOW_GOAL_LENGTH,
  WorkflowStateError,
  advanceWorkflow,
  cancelWorkflow,
  createWorkflowDescriptor,
  failWorkflow,
  getWorkflowState,
  normalizeSessionId,
  resolveWorkflowPaths,
  resumeWorkflow,
  startWorkflow as startWorkflowCore,
  validateWorkflowState,
} from '../core/workflow-state.mjs';
import { loadModelRouter } from '../../config/agents/model-assignment.mjs';
import { probeAvailableModels } from '../commands/workflow.mjs';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const testRegistry = loadModelRouter();
const availableModelIds = [
  ...new Set(Object.values(testRegistry.tiers).flatMap((tier) => tier.models)),
];

function startWorkflow(options) {
  return startWorkflowCore({
    availableModelIds,
    registry: testRegistry,
    ...options,
  });
}

function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'bizar-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function expected(state) {
  return { runId: state.runId, revision: state.revision, stage: state.stage };
}

function advance(state, root, sessionId = 'session-1') {
  return advanceWorkflow({
    projectRoot: root,
    sessionId,
    expected: expected(state),
    evidence: `fresh evidence for ${state.stage}`,
  });
}

function advanceToQa(root, sessionId = 'session-1') {
  let state = startWorkflow({ projectRoot: root, sessionId, goal: 'Implement the requested workflow' });
  state = advance(state, root, sessionId);
  state = advance(state, root, sessionId);
  state = advance(state, root, sessionId);
  return state;
}

function assertCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof WorkflowStateError);
    assert.equal(error.code, code);
    return true;
  });
}

function runWorkflowCli(root, env, args) {
  return new Promise((resolveResult) => {
    const child = spawn(
      process.execPath,
      [join(repoRoot, 'cli', 'bin.mjs'), 'workflow', ...args, '--project', root, '--json'],
      { cwd: root, env: { ...process.env, BIZAR_SKIP_BUILD: '1', FORCE_COLOR: '0', ...env } },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolveResult({ status: code, stdout, stderr }));
  });
}

async function fakeModelGateway(t, root, modelIds = availableModelIds) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: modelIds.map((id) => ({ id })) }));
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => {
    server.close(resolveClose);
    server.closeAllConnections?.();
  }));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  const registry = structuredClone(testRegistry);
  registry.endpoint = endpoint;
  registry.gateway.endpoint = endpoint;
  const routerPath = join(root, 'model-router.json');
  writeFileSync(routerPath, JSON.stringify(registry));
  return {
    requests,
    env: {
      CLAUDE_SESSION_ID: 'cli-session',
      ANTHROPIC_AUTH_TOKEN: 'workflow-test-token',
      ANTHROPIC_BASE_URL: endpoint,
      BIZAR_MODEL_ROUTER_URL: endpoint,
      BIZAR_MODEL_ROUTER_PATH: routerPath,
    },
  };
}

test('fixed descriptors expose only canonical profiles and stages', () => {
  const descriptor = createWorkflowDescriptor('default');
  assert.deepEqual(descriptor.stages, WORKFLOW_STAGES);
  assert.equal(descriptor.limits.maxQaCycles, 5);
  assert.equal(descriptor.limits.sameQaFailureThreshold, 3);
  assert.equal(descriptor.limits.maxValidationRounds, 3);
  assert.ok(Object.isFrozen(descriptor));
  assert.ok(Object.isFrozen(descriptor.stages));
  assertCode('INVALID_PROFILE', () => createWorkflowDescriptor('custom-shell-stage'));
});

test('workflow starts snapshot dynamic routing decisions and inherit when discovery is unavailable', (t) => {
  const root = project(t);
  const inherited = startWorkflowCore({
    projectRoot: root,
    sessionId: 'session-inherit',
    goal: 'Inherit session model when discovery is unavailable',
    registry: testRegistry,
    requiredAgents: ['mike'],
  });
  assert.equal(inherited.assignmentSnapshot.decisions.mike.model, null);
  assert.equal(inherited.assignmentSnapshot.decisions.mike.inheritSession, true);

  const state = startWorkflow({
    projectRoot: root,
    sessionId: 'session-live',
    goal: 'Bind live dynamic routing decisions',
    requiredAgents: ['mike', 'todd'],
  });
  assert.equal(state.assignmentSnapshot.runId, state.runId);
  assert.equal(state.assignmentSnapshot.gatewayEndpoint, testRegistry.gateway.endpoint);
  assert.equal(state.assignmentSnapshot.availabilityProbe, testRegistry.gateway.availabilityProbe);
  assert.equal(Object.keys(state.assignmentSnapshot.decisions).length, 2);
  assert.equal(state.assignmentSnapshot.decisions.mike.model, testRegistry.tiers.premium.models[0]);
  assert.equal(state.assignmentSnapshot.decisions.todd.model, testRegistry.tiers.mid.models[0]);
  assert.equal(Object.isFrozen(state.assignmentSnapshot), true);
  assert.equal(Object.isFrozen(state.assignmentSnapshot.decisions.mike), true);
});

test('availability probes enforce timeout and exact response ids', async () => {
  const probeRegistry = structuredClone(testRegistry);
  probeRegistry.endpoint = 'http://127.0.0.1:1/v1';
  probeRegistry.gateway.endpoint = 'http://127.0.0.1:1/v1';
  await assert.rejects(
    probeAvailableModels({
      registry: probeRegistry,
      timeoutMs: 5,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    }),
    (error) => error instanceof WorkflowStateError && error.code === 'GATEWAY_TIMEOUT',
  );
  await assert.rejects(
    probeAvailableModels({
      registry: probeRegistry,
      fetchImpl: async () => ({
        ok: true,
        async json() { return { data: [{ id: ' claude-qwen/qwen3.8-max ' }] }; },
      }),
    }),
    (error) => error instanceof WorkflowStateError && error.code === 'GATEWAY_RESPONSE_INVALID',
  );
});

test('workflow completes the fixed lifecycle with monotonic revisions', (t) => {
  const root = project(t);
  let state = startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'Complete the lifecycle' });
  assert.equal(state.status, 'active');
  assert.equal(state.stage, 'research');
  assert.equal(state.revision, 1);
  assert.match(state.runId, /^[0-9a-f-]{36}$/i);
  assert.equal(state.projectRoot, root);
  assert.equal(state.goalLength, 'Complete the lifecycle'.length);
  assert.equal(state.goal, undefined);

  for (const stage of WORKFLOW_STAGES.slice(1)) {
    state = advance(state, root);
    assert.equal(state.stage, stage);
  }
  state = advance(state, root);
  assert.equal(state.status, 'completed');
  assert.equal(state.stage, 'validate');
  assert.equal(state.revision, 6);
  assert.ok(state.terminalAt);
  assert.equal(getWorkflowState({ projectRoot: root, sessionId: 'session-1' }).stateHash, state.stateHash);
});

test('active workflow is mutually exclusive and a terminal run may be replaced', (t) => {
  const root = project(t);
  let first = startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'First run' });
  assertCode('ALREADY_ACTIVE', () => startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'Duplicate run' }));
  first = cancelWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: expected(first),
  });
  const second = startWorkflow({ projectRoot: root, sessionId: 'session-1', profile: 'plan-build-qa', goal: 'Second run' });
  assert.notEqual(second.runId, first.runId);
  assert.equal(second.profile, 'plan-build-qa');
});

test('lock excludes concurrent writers and does not leave temp files', (t) => {
  const root = project(t);
  const paths = resolveWorkflowPaths({ projectRoot: root, sessionId: 'session-1' });
  startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'Test locking' });
  writeFileSync(paths.lockPath, 'owner\n');
  assertCode('WORKFLOW_BUSY', () => startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'Concurrent run' }));
  rmSync(paths.lockPath, { force: true });
  const entries = readdirSync(paths.sessionDir);
  assert.deepEqual(entries, ['autopilot.json']);
});

test('transitions reject stale revisions, stages, and run ids before writing', (t) => {
  const root = project(t);
  const state = startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'Test compare and swap' });
  assertCode('STALE_REVISION', () => advanceWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: { ...expected(state), revision: state.revision + 1 },
    evidence: 'fresh tests',
  }));
  assertCode('STAGE_CONFLICT', () => advanceWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: { ...expected(state), stage: 'plan' },
    evidence: 'fresh tests',
  }));
  assertCode('RUN_CONFLICT', () => advanceWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: { ...expected(state), runId: '00000000-0000-4000-8000-000000000000' },
    evidence: 'fresh tests',
  }));
  assert.equal(getWorkflowState({ projectRoot: root, sessionId: 'session-1' }).revision, 1);
});

test('all write transitions require expected run, revision, and stage', (t) => {
  const root = project(t);
  startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'Test required comparisons' });
  assertCode('EXPECTED_REQUIRED', () => advanceWorkflow({ projectRoot: root, sessionId: 'session-1', evidence: 'fresh tests' }));
  assertCode('EXPECTED_REQUIRED', () => cancelWorkflow({ projectRoot: root, sessionId: 'session-1', expected: {} }));
  assertCode('EXPECTED_REQUIRED', () => failWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: { runId: 'x', revision: 1 },
    reason: 'failure',
  }));
});

test('resume is read-only for active state and rejects terminal state', (t) => {
  const root = project(t);
  let state = startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'Test resume' });
  const resumed = resumeWorkflow({ projectRoot: root, sessionId: 'session-1' });
  assert.deepEqual(resumed, state);
  state = cancelWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: expected(state),
    reason: 'operator stop',
  });
  assert.equal(state.status, 'cancelled');
  assert.match(state.terminalReasonHash, /^[0-9a-f]{64}$/);
  assertCode('TERMINAL', () => resumeWorkflow({ projectRoot: root, sessionId: 'session-1' }));
});

test('the third identical QA failure terminates the run', (t) => {
  const root = project(t);
  let state = advanceToQa(root);
  assert.equal(state.attempts.qaCycles, 1);
  for (let index = 0; index < 2; index++) {
    state = failWorkflow({
      projectRoot: root,
      sessionId: 'session-1',
      expected: expected(state),
      reason: 'same regression',
    });
    assert.equal(state.status, 'active');
  }
  state = failWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: expected(state),
    reason: 'same regression',
  });
  assert.equal(state.status, 'failed');
  assert.equal(state.attempts.sameQaFailureCount, WORKFLOW_LIMITS.sameQaFailureThreshold);
});

test('QA retries are bounded to five cycles across distinct failures', (t) => {
  const root = project(t);
  let state = advanceToQa(root);
  for (let failure = 1; failure <= 4; failure++) {
    state = failWorkflow({
      projectRoot: root,
      sessionId: 'session-1',
      expected: expected(state),
      reason: `distinct failure ${failure}`,
    });
    assert.equal(state.status, 'active');
  }
  assert.equal(state.attempts.qaCycles, 5);
  state = failWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: expected(state),
    reason: 'distinct failure 5',
  });
  assert.equal(state.status, 'failed');
  assert.equal(state.attempts.qaCycles, 5);
});

test('validation retries are bounded to three rounds', (t) => {
  const root = project(t);
  let state = advanceToQa(root);
  state = advance(state, root);
  assert.equal(state.stage, 'validate');
  assert.equal(state.attempts.validationRounds, 1);
  for (let round = 1; round <= 2; round++) {
    state = failWorkflow({
      projectRoot: root,
      sessionId: 'session-1',
      expected: expected(state),
      reason: `validation failure ${round}`,
    });
    assert.equal(state.status, 'active');
  }
  assert.equal(state.attempts.validationRounds, 3);
  state = failWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: expected(state),
    reason: 'validation failure 3',
  });
  assert.equal(state.status, 'failed');
});

test('fail outside QA and validation is terminal', (t) => {
  const root = project(t);
  const state = startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'Test terminal failure' });
  const failed = failWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: expected(state),
    reason: 'research evidence unavailable',
  });
  assert.equal(failed.status, 'failed');
  assertCode('TERMINAL', () => advanceWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: expected(failed),
    evidence: 'should not write',
  }));
});

test('state validation rejects foreign sessions and projects', (t) => {
  const root = project(t);
  const other = project(t);
  const state = startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'Test project binding' });
  assertCode('FOREIGN_SESSION', () => validateWorkflowState(state, {
    projectRoot: root,
    sessionId: 'session-2',
  }));
  assertCode('FOREIGN_PROJECT', () => validateWorkflowState(state, {
    projectRoot: other,
    sessionId: 'session-1',
  }));
});

test('state hash and canonical descriptor detect on-disk tampering', (t) => {
  const root = project(t);
  const paths = resolveWorkflowPaths({ projectRoot: root, sessionId: 'session-1' });
  startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'Test integrity' });
  const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
  state.revision = 99;
  writeFileSync(paths.statePath, JSON.stringify(state));
  assertCode('INTEGRITY_ERROR', () => getWorkflowState({ projectRoot: root, sessionId: 'session-1' }));

  const freshRoot = project(t);
  const freshPaths = resolveWorkflowPaths({ projectRoot: freshRoot, sessionId: 'session-1' });
  const fresh = startWorkflow({ projectRoot: freshRoot, sessionId: 'session-1', goal: 'Test descriptor integrity' });
  const altered = structuredClone(fresh);
  altered.descriptor.stages.push('deploy');
  writeFileSync(freshPaths.statePath, JSON.stringify(altered));
  assertCode('DESCRIPTOR_MISMATCH', () => getWorkflowState({ projectRoot: freshRoot, sessionId: 'session-1' }));
});

test('routing snapshots reject cross-run reuse and fingerprint tampering', (t) => {
  const root = project(t);
  const paths = resolveWorkflowPaths({ projectRoot: root, sessionId: 'session-1' });
  const state = startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: 'Protect assignments', requiredAgents: ['mike'] });
  const crossRun = JSON.parse(JSON.stringify(state));
  crossRun.assignmentSnapshot.runId = '00000000-0000-4000-8000-000000000000';
  writeFileSync(paths.statePath, JSON.stringify(crossRun));
  assertCode('ASSIGNMENT_RUN_MISMATCH', () => getWorkflowState({ projectRoot: root, sessionId: 'session-1' }));

  const secondRoot = project(t);
  const secondPaths = resolveWorkflowPaths({ projectRoot: secondRoot, sessionId: 'session-1' });
  const second = startWorkflow({ projectRoot: secondRoot, sessionId: 'session-1', goal: 'Protect fingerprints', requiredAgents: ['mike'] });
  const tampered = JSON.parse(JSON.stringify(second));
  tampered.assignmentSnapshot.decisions.mike.model = 'claude-minimax/MiniMax-M2.5';
  writeFileSync(secondPaths.statePath, JSON.stringify(tampered));
  assertCode('ASSIGNMENT_INTEGRITY_ERROR', () => getWorkflowState({ projectRoot: secondRoot, sessionId: 'session-1' }));
});

test('workflow validation accepts session inheritance without discovery evidence', (t) => {
  const root = project(t);
  const state = startWorkflowCore({
    projectRoot: root,
    sessionId: 'session-1',
    goal: 'Validate session-model inheritance',
    registry: testRegistry,
    requiredAgents: ['mike'],
  });
  assert.equal(state.assignmentSnapshot.discoveryAttempted, false);
  assert.equal(state.assignmentSnapshot.decisions.mike.inheritSession, true);
  assert.equal(validateWorkflowState(state, {
    projectRoot: root,
    sessionId: 'session-1',
  }), state);
});

test('session ids cannot traverse or alias workflow state paths', (t) => {
  const root = project(t);
  for (const unsafe of ['../escape', '..', '.', '/absolute', 'a/b', 'a\\b', '', ' '.repeat(2)]) {
    assertCode(unsafe.trim() ? 'INVALID_SESSION' : 'SESSION_REQUIRED', () => normalizeSessionId(unsafe));
  }
  const paths = resolveWorkflowPaths({ projectRoot: root, sessionId: 'safe.session-_1' });
  assert.ok(paths.statePath.startsWith(join(root, '.bizar', 'state', 'sessions')));
  assert.equal(paths.statePath, join(root, '.bizar', 'state', 'sessions', 'safe.session-_1', 'autopilot.json'));
});

test('symlinked state ancestors and files are rejected before access', (t) => {
  const outside = project(t);
  const cases = [
    {
      name: '.bizar',
      prepare(root) { symlinkSync(outside, join(root, '.bizar'), 'dir'); },
    },
    {
      name: '.bizar/state',
      prepare(root) {
        mkdirSync(join(root, '.bizar'));
        symlinkSync(outside, join(root, '.bizar', 'state'), 'dir');
      },
    },
    {
      name: 'sessions',
      prepare(root) {
        mkdirSync(join(root, '.bizar', 'state'), { recursive: true });
        symlinkSync(outside, join(root, '.bizar', 'state', 'sessions'), 'dir');
      },
    },
    {
      name: 'session directory',
      prepare(root) {
        mkdirSync(join(root, '.bizar', 'state', 'sessions'), { recursive: true });
        symlinkSync(outside, join(root, '.bizar', 'state', 'sessions', 'session-1'), 'dir');
      },
    },
  ];
  for (const fixture of cases) {
    const root = project(t);
    fixture.prepare(root);
    assertCode('UNSAFE_STATE_PATH', () => startWorkflow({
      projectRoot: root,
      sessionId: 'session-1',
      goal: `Reject ${fixture.name}`,
    }));
    assert.equal(readdirSync(outside).length, 0);
  }

  const root = project(t);
  const sessionDir = join(root, '.bizar', 'state', 'sessions', 'session-1');
  mkdirSync(sessionDir, { recursive: true });
  const outsideFile = join(outside, 'escaped.json');
  writeFileSync(outsideFile, '{}');
  symlinkSync(outsideFile, join(sessionDir, 'autopilot.json'));
  assertCode('UNSAFE_STATE_PATH', () => getWorkflowState({ projectRoot: root, sessionId: 'session-1' }));
  assert.equal(readFileSync(outsideFile, 'utf8'), '{}');
});

test('goal and advance evidence are required, bounded, and stored only as digests', (t) => {
  const root = project(t);
  assertCode('GOAL_REQUIRED', () => startWorkflow({ projectRoot: root, sessionId: 'session-1' }));
  assertCode('GOAL_TOO_LONG', () => startWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    goal: 'g'.repeat(MAX_WORKFLOW_GOAL_LENGTH + 1),
  }));
  const secretGoal = 'ship feature without storing this plaintext';
  const state = startWorkflow({ projectRoot: root, sessionId: 'session-1', goal: secretGoal });
  const serialized = JSON.stringify(state);
  assert.equal(serialized.includes(secretGoal), false);
  assertCode('EVIDENCE_REQUIRED', () => advanceWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: expected(state),
  }));
  assertCode('EVIDENCE_TOO_LONG', () => advanceWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: expected(state),
    evidence: 'e'.repeat(MAX_WORKFLOW_EVIDENCE_LENGTH + 1),
  }));
  const secretEvidence = 'tests passed but do not retain this plaintext';
  const advanced = advanceWorkflow({
    projectRoot: root,
    sessionId: 'session-1',
    expected: expected(state),
    evidence: secretEvidence,
  });
  assert.equal(JSON.stringify(advanced).includes(secretEvidence), false);
  assert.equal(advanced.evidenceByStage.research.length, secretEvidence.length);
  assert.match(advanced.evidenceByStage.research.hash, /^[0-9a-f]{64}$/);
});

test('CLI probes the strict gateway and emits JSON for the guarded lifecycle', async (t) => {
  const root = project(t);
  const gateway = await fakeModelGateway(t, root);
  const invoke = (...args) => runWorkflowCli(root, gateway.env, args);

  const started = await invoke('start', '--workflow', 'plan-build-qa', '--goal', 'CLI lifecycle');
  assert.equal(started.status, 0, started.stderr);
  const startPayload = JSON.parse(started.stdout);
  assert.equal(startPayload.workflow.stage, 'research');
  assert.equal(startPayload.workflow.profile, 'plan-build-qa');
  assert.equal(startPayload.workflow.assignmentSnapshot.runId, startPayload.workflow.runId);
  assert.equal(gateway.requests.length, 1);
  assert.equal(gateway.requests[0].url, '/v1/models?limit=1000');
  assert.equal(gateway.requests[0].authorization, 'Bearer workflow-test-token');

  const status = await invoke('status');
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).workflow.runId, startPayload.workflow.runId);

  const advanced = await invoke(
    'advance',
    '--run', startPayload.workflow.runId,
    '--revision', String(startPayload.workflow.revision),
    '--stage', startPayload.workflow.stage,
    '--evidence', 'research completed',
  );
  assert.equal(advanced.status, 0, advanced.stderr);
  assert.equal(JSON.parse(advanced.stdout).workflow.stage, 'plan');

  const stale = await invoke(
    'advance',
    '--run', startPayload.workflow.runId,
    '--revision', '1',
    '--stage', 'research',
    '--evidence', 'stale evidence',
  );
  assert.equal(stale.status, 1);
  assert.equal(JSON.parse(stale.stderr).error.code, 'STALE_REVISION');
});

test('CLI accepts matching profile aliases and rejects conflicts before probing', async (t) => {
  const root = project(t);
  const gateway = await fakeModelGateway(t, root);
  gateway.env.CLAUDE_SESSION_ID = 'alias-session';
  const invoke = (...args) => runWorkflowCli(root, gateway.env, args);

  const matching = await invoke(
    'start',
    '--profile', 'default',
    '--workflow', 'default',
    '--goal', 'Matching aliases',
  );
  assert.equal(matching.status, 0, matching.stderr);
  assert.equal(JSON.parse(matching.stdout).workflow.profile, 'default');

  const otherRoot = project(t);
  const conflicting = await runWorkflowCli(
    otherRoot,
    { ...gateway.env, CLAUDE_SESSION_ID: 'alias-conflict-session' },
    [
      'start',
      '--profile', 'default', '--workflow', 'plan-build-qa',
      '--goal', 'Conflicting aliases',
    ],
  );
  assert.equal(conflicting.status, 2);
  assert.equal(JSON.parse(conflicting.stderr).error.code, 'USAGE');
  assert.equal(gateway.requests.length, 1, 'conflicting aliases must fail before a network probe');
});

test('CLI falls back to session inheritance when gateway coordinates are missing or mismatched', async (t) => {
  const root = project(t);
  const gateway = await fakeModelGateway(t, root);

  const missing = await runWorkflowCli(root, {
    ...gateway.env,
    CLAUDE_SESSION_ID: 'missing-inference-endpoint',
    ANTHROPIC_BASE_URL: '',
  }, ['start', '--goal', 'Inherit without an effective inference endpoint']);
  assert.equal(missing.status, 0, missing.stderr);

  const mismatch = await runWorkflowCli(root, {
    ...gateway.env,
    CLAUDE_SESSION_ID: 'mismatched-inference-endpoint',
    ANTHROPIC_BASE_URL: 'https://other-gateway.example/v1',
  }, ['start', '--goal', 'Inherit on mismatched inference routing']);
  assert.equal(mismatch.status, 0, mismatch.stderr);

  const contradiction = await runWorkflowCli(root, {
    ...gateway.env,
    CLAUDE_SESSION_ID: 'contradictory-router-endpoint',
    BIZAR_MODEL_ROUTER_URL: 'https://other-gateway.example/v1',
  }, ['start', '--goal', 'Inherit on contradictory router routing']);
  assert.equal(contradiction.status, 0, contradiction.stderr);
  assert.equal(gateway.requests.length, 0, 'coordinate failures must skip discovery rather than retry');
});

test('CLI starts with session inheritance when no configured tier model is available', async (t) => {
  const root = project(t);
  const gateway = await fakeModelGateway(t, root, ['unconfigured/provider-model']);
  gateway.env.CLAUDE_SESSION_ID = 'inherit-session';
  const result = await runWorkflowCli(root, gateway.env, [
    'start', '--goal', 'Inherit instead of cycling model aliases',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const paths = resolveWorkflowPaths({ projectRoot: root, sessionId: 'inherit-session' });
  assert.equal(existsSync(paths.statePath), true);
  const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
  assert.equal(state.assignmentSnapshot.discoveryAttempted, true);
});
