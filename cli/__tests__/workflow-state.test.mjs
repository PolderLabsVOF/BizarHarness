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
import { join } from 'node:path';
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

// Controlled fixture registry — deterministic models, no dependency on the live
// global router which was moved to ~/.claude/model-router.json (10.23.12).
// loadModelRouter() returns a validated plain-object (tiers is NOT a Map).
const testRegistry = {
  version: '13.0.0',
  endpoint: 'http://test/v1',
  gateway: { endpoint: 'http://test/v1', availabilityProbe: '/models', unavailableBehavior: 'inherit-session' },
  roleDefaults: { mike: 'premium', paul: 'premium', carl: 'premium', karen: 'high', linda: 'high', ria: 'mid-design', greg: 'default', steve: 'default', oscar: 'mid', todd: 'mid', susan: 'mid', pam: 'budget', brenda: 'budget', janet: 'budget', kevin: 'budget', brad: 'mid-design' },
  tiers: {
    premium: { models: ['cx/gpt-5.6-luna', 'cx/gpt-5.6-sol'], purpose: 'hard work', effort: 'high' },
    mid: { models: ['cx/gpt-5.6-terra'], purpose: 'bounded work', effort: 'medium' },
    default: { models: ['cx/gpt-5.6-mini'], purpose: 'ordinary work', effort: 'medium' },
    high: { models: ['cx/gpt-5.6-high'], purpose: 'high work', effort: 'high' },
    'mid-design': { models: ['cx/gpt-5.6-mid-design'], purpose: 'design work', effort: 'medium' },
    budget: { models: ['cx/gpt-5.6-budget'], purpose: 'light work', effort: 'low' },
  },
  policies: { selectionOwner: 'orchestrator', discoveryFailure: 'configured-tier-fallback', unavailableModel: 'configured-tier-fallback', retryModelAliases: false, maxDispatchModelAttempts: 1 },
};
const availableModelIds = [
  ...new Set(Object.values(testRegistry.tiers).flatMap((tier) => tier.models)),
];

function startWorkflow(options) {
  return startWorkflowCore(options);
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

test('workflow starts snapshot explicit configured models when discovery is unavailable', (t) => {
  const root = project(t);
  const inherited = startWorkflowCore({
    projectRoot: root,
    sessionId: 'session-inherit',
    goal: 'Use configured model when discovery is unavailable',
    requiredAgents: ['mike'],
  });
  assert.equal(inherited.assignmentSnapshot.decisions.mike.alias, 'opus');
  assert.equal(inherited.assignmentSnapshot.decisions.mike.inheritSession, false);
  assert.equal(inherited.assignmentSnapshot.decisions.mike.reason, 'static-alias');

  const state = startWorkflow({
    projectRoot: root,
    sessionId: 'session-live',
    goal: 'Bind live dynamic routing decisions',
    requiredAgents: ['mike', 'todd'],
  });
  assert.equal(state.assignmentSnapshot.runId, state.runId);
  assert.equal(state.assignmentSnapshot.gatewayEndpoint, null);
  assert.equal(state.assignmentSnapshot.availabilityProbe, null);
  assert.equal(Object.keys(state.assignmentSnapshot.decisions).length, 2);
  assert.equal(state.assignmentSnapshot.decisions.mike.alias, 'opus');
  assert.equal(state.assignmentSnapshot.decisions.todd.alias, 'sonnet');
  assert.equal(Object.isFrozen(state.assignmentSnapshot), true);
  assert.equal(Object.isFrozen(state.assignmentSnapshot.decisions.mike), true);
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

test('workflow validation accepts configured fallback without discovery evidence', (t) => {
  const root = project(t);
  const state = startWorkflowCore({
    projectRoot: root,
    sessionId: 'session-1',
    goal: 'Validate configured fallback',
    requiredAgents: ['mike'],
  });
  assert.equal(state.assignmentSnapshot.discoveryAttempted, false);
  assert.equal(state.assignmentSnapshot.decisions.mike.inheritSession, false);
  assert.equal(state.assignmentSnapshot.decisions.mike.alias, 'opus');
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

