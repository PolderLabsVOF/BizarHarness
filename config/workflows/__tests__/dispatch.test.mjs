/**
 * config/workflows/__tests__/dispatch.test.mjs — Dispatch helper tests (F-189 / IMP-014).
 *
 * Pins the workflow-side dispatch contract:
 *
 *   1. Every dispatchAgent call returns a `routingDecisionId` matching
 *      the UUID format.
 *   2. When selectedProfiles carries models, `model` is non-undefined
 *      and the cheapest-healthy / strongest-healthy ladder pins hold.
 *   3. `dryRun: true` does NOT invoke the agentFn and returns the
 *      decision.
 *   4. Two sequential calls produce distinct `routingDecisionId` values.
 *   5. Every fixture workflow parses and every dispatchAgent call site
 *      carries a non-empty `role` (or has a documented bypass).
 *   6. Captured Agent payloads (via the test capture hook) contain
 *      `model` or `routingDecisionId` for every nested call.
 *
 * The selector-mirror divergence test imports the canonical SDK
 * selector when present so the workflow-side mirror cannot drift
 * unnoticed. When the SDK is not built (`packages/sdk/dist/`
 * missing), the divergence test is skipped with an explicit reason.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = resolve(here, '..');
const repoRoot = resolve(workflowsDir, '..', '..');
const dispatchPath = resolve(workflowsDir, 'lib', 'dispatch.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dispatch = await import(pathToFileURL(dispatchPath).href);

function makeProfile(id, tier, profile) {
  return { id, tier, profile };
}

function makeCapabilities(overrides = {}) {
  return {
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    attachment: true,
    temperature: true,
    ...overrides,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Select + dispatch API                             */
/* ────────────────────────────────────────────────────────────────────────── */

test('dispatch: selectDispatchModelMirror returns session-inherit on empty pool', () => {
  const d = dispatch.selectDispatchModelMirror({
    task: { task: 'review', role: 'security' },
    selectedProfiles: [],
    budget: {},
    health: {},
    runId: 'r-empty',
  });
  assert.equal(d.modelId, null);
  assert.equal(d.reason, dispatch.REASON.SESSION_INHERIT);
  assert.equal(d.tier, 'default');
  assert.ok(UUID_RE.test(d.routingDecisionId));
});

test('dispatch: security role + selected pool picks strongest (never-downgrade)', () => {
  const selected = [
    makeProfile('provider/cheap', 'budget'),
    makeProfile('provider/strong', 'high'),
  ];
  const d = dispatch.selectDispatchModelMirror({
    task: { task: 'review', role: 'security', risk: 'high', capabilities: ['security'] },
    selectedProfiles: selected,
    budget: {},
    health: {},
    runId: 'r-sec',
  });
  assert.equal(d.modelId, 'provider/strong');
  assert.equal(d.tier, 'high');
  assert.equal(d.reason, dispatch.REASON.STRONGEST_NEVER_DOWNGRADE);
  assert.ok(UUID_RE.test(d.routingDecisionId));
});

test('dispatch: risk=low picks the cheapest healthy selected', () => {
  const selected = [
    makeProfile('provider/cheap', 'budget'),
    makeProfile('provider/strong', 'high'),
  ];
  const d = dispatch.selectDispatchModelMirror({
    task: { task: 'routing', role: 'generic', risk: 'low' },
    selectedProfiles: selected,
    budget: {},
    health: {},
    runId: 'r-low',
  });
  assert.equal(d.modelId, 'provider/cheap');
  assert.equal(d.tier, 'budget');
  assert.equal(d.reason, dispatch.REASON.CHEAPEST_RISK_LOW);
});

test('dispatch: risk=high picks strongest healthy', () => {
  const selected = [
    makeProfile('provider/cheap', 'budget'),
    makeProfile('provider/strong', 'high'),
  ];
  const d = dispatch.selectDispatchModelMirror({
    task: { task: 'adversarial', role: 'generic', risk: 'high' },
    selectedProfiles: selected,
    budget: {},
    health: {},
    runId: 'r-high',
  });
  assert.equal(d.modelId, 'provider/strong');
  assert.equal(d.tier, 'high');
  assert.equal(d.reason, dispatch.REASON.STRONGEST_RISK_HIGH);
});

test('dispatch: unhealthy models are skipped', () => {
  const selected = [
    makeProfile('provider/cheap', 'budget'),
    makeProfile('provider/strong', 'high'),
  ];
  const d = dispatch.selectDispatchModelMirror({
    task: { task: 'routing', role: 'generic', risk: 'low' },
    selectedProfiles: selected,
    budget: {},
    health: { 'provider/cheap': { status: 'unhealthy' } },
    runId: 'r-healthy',
  });
  assert.equal(d.modelId, 'provider/strong');
  assert.ok(d.fallbackChain.includes('provider/cheap:unhealthy'));
});

test('dispatch: empty selectedProfiles + activeSessionModel picks session', () => {
  const d = dispatch.selectDispatchModelMirror({
    task: { task: 'routing', role: 'generic' },
    selectedProfiles: [],
    activeSessionModel: 'session/inherit',
    budget: {},
    health: {},
    runId: 'r-inherit',
  });
  assert.equal(d.modelId, 'session/inherit');
  assert.equal(d.reason, dispatch.REASON.SESSION_INHERIT);
  assert.equal(d.confidence, 0.5);
});

test('dispatch: REASON enum matches the SDK source verbatim', () => {
  const expected = new Set([
    'cheapest-healthy-risk-low',
    'exact-capability',
    'no-eligible-selected',
    'next-stronger',
    'session-inherit',
    'strongest-healthy-never-downgrade',
    'strongest-healthy-risk-high',
  ]);
  const actual = new Set(Object.values(dispatch.REASON));
  assert.deepEqual([...actual].sort(), [...expected].sort());
});

/* ────────────────────────────────────────────────────────────────────────── */
/*                            dispatchAgent wrapper                            */
/* ────────────────────────────────────────────────────────────────────────── */

const FIXTURE_CONTEXT = {
  selectedProfiles: [
    makeProfile('provider/cheap', 'budget', { capabilities: makeCapabilities(), limits: { contextTokens: 32000, inputTokens: null, outputTokens: null } }),
    makeProfile('provider/strong', 'high', { capabilities: makeCapabilities(), limits: { contextTokens: 200000, inputTokens: null, outputTokens: null } }),
  ],
  staticProfiles: [],
  activeSessionModel: 'session/inherit',
  budget: {},
  health: {},
  history: undefined,
};

test('dispatchAgent: with selectedProfiles + risk=high -> model + routingDecisionId', async () => {
  let capturedOpts = null;
  const agentFn = async (prompt, opts) => { capturedOpts = opts; return { prompt, opts }; };
  const result = await dispatch.dispatchAgent(
    agentFn,
    'mike',
    'review this',
    { role: 'security', risk: 'high', capabilities: ['security'], label: 'review' },
    FIXTURE_CONTEXT,
  );
  assert.ok(capturedOpts, 'agentFn must be invoked');
  assert.notEqual(capturedOpts.model, undefined, 'model must be present');
  assert.equal(capturedOpts.model, 'provider/strong');
  assert.ok(UUID_RE.test(capturedOpts.routingDecisionId));
  assert.equal(capturedOpts.tier, 'high');
  assert.equal(capturedOpts.selectorReason, dispatch.REASON.STRONGEST_NEVER_DOWNGRADE);
});

test('dispatchAgent: risk=low returns the cheapest healthy selected', async () => {
  let capturedOpts = null;
  const agentFn = async (prompt, opts) => { capturedOpts = opts; return { prompt, opts }; };
  await dispatch.dispatchAgent(
    agentFn,
    'mike',
    'cheap task',
    { role: 'generic', risk: 'low', label: 'cheap' },
    FIXTURE_CONTEXT,
  );
  assert.equal(capturedOpts.model, 'provider/cheap');
  assert.equal(capturedOpts.tier, 'budget');
  assert.equal(capturedOpts.selectorReason, dispatch.REASON.CHEAPEST_RISK_LOW);
});

test('dispatchAgent: dryRun=true returns decision without invoking agentFn', async () => {
  let invoked = false;
  const agentFn = async () => { invoked = true; return { ok: true }; };
  const result = await dispatch.dispatchAgent(
    agentFn,
    'mike',
    'review',
    { role: 'security', risk: 'high', dryRun: true },
    FIXTURE_CONTEXT,
  );
  assert.equal(invoked, false, 'agentFn must NOT be invoked when dryRun=true');
  assert.ok(result.__dispatchDecision, 'result carries the decision');
  assert.ok(UUID_RE.test(result.__dispatchDecision.routingDecisionId));
  assert.equal(result.payload.model, 'provider/strong');
});

test('dispatchAgent: empty selectedProfiles + no session -> model=undefined, but routingDecisionId is set', async () => {
  const emptyContext = { selectedProfiles: [], staticProfiles: [], activeSessionModel: undefined, budget: {}, health: {} };
  let capturedOpts = null;
  const agentFn = async (prompt, opts) => { capturedOpts = opts; return { ok: true }; };
  await dispatch.dispatchAgent(
    agentFn,
    'mike',
    'review',
    { role: 'security', risk: 'high' },
    emptyContext,
  );
  assert.equal(capturedOpts.model, undefined);
  assert.ok(UUID_RE.test(capturedOpts.routingDecisionId));
});

test('dispatchAgent: two sequential calls produce distinct routingDecisionId values', async () => {
  const calls = [];
  const agentFn = async (prompt, opts) => { calls.push(opts.routingDecisionId); return { prompt, opts }; };
  await dispatch.dispatchAgent(agentFn, 'mike', 'first', { role: 'security', risk: 'high' }, FIXTURE_CONTEXT);
  await dispatch.dispatchAgent(agentFn, 'mike', 'second', { role: 'security', risk: 'high' }, FIXTURE_CONTEXT);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0], calls[1]);
  assert.ok(UUID_RE.test(calls[0]));
  assert.ok(UUID_RE.test(calls[1]));
});

test('dispatchAgent: capture hook receives the augmented payload', async () => {
  const captured = [];
  dispatch.setCaptureFn((entry) => captured.push(entry));
  try {
    const agentFn = async () => ({ ok: true });
    await dispatch.dispatchAgent(agentFn, 'mike', 'review', { role: 'security', risk: 'high' }, FIXTURE_CONTEXT);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].agentName, 'mike');
    assert.ok(captured[0].opts.routingDecisionId);
    assert.equal(captured[0].opts.model, 'provider/strong');
  } finally {
    dispatch.resetCaptureFn();
  }
});

/* ────────────────────────────────────────────────────────────────────────── */
/*                  Workflow scripts: every dispatchAgent has role             */
/* ────────────────────────────────────────────────────────────────────────── */

const WORKFLOW_SCRIPTS = [
  'bizar-debug.js',
  'bizar-implement.js',
  'bizar-research.js',
  'ultracode.js',
  'ultracode-research.js',
  'ultracode-review.js',
];

test('dispatch: every fixture workflow imports dispatchAgent from lib/dispatch.js', () => {
  for (const script of WORKFLOW_SCRIPTS) {
    const source = readFileSync(resolve(workflowsDir, script), 'utf8');
    assert.ok(
      /import\s*\{[^}]*dispatchAgent[^}]*\}\s*from\s*['"]\.\/lib\/dispatch\.js['"]/.test(source),
      `${script} must import dispatchAgent from './lib/dispatch.js'`,
    );
  }
});

test('dispatch: every dispatchAgent call site has a non-empty role OR a documented bypass comment', () => {
  const bypassPattern = /\/\/\s*dispatch-bypass:\s*[^\n]+/;
  for (const script of WORKFLOW_SCRIPTS) {
    const source = readFileSync(resolve(workflowsDir, script), 'utf8');
    // Find every dispatchAgent( call site (rough: find every dispatchAgent( and inspect the trailing options object)
    const callRegex = /dispatchAgent\(/g;
    let match;
    let total = 0;
    let withRole = 0;
    while ((match = callRegex.exec(source)) !== null) {
      total += 1;
      // Look at the surrounding 1600 chars for `role: '<something>'` or a bypass comment.
      // Phase B (v10.21.0) barrierRef() calls expand the prompt template
      // significantly; the old 800-char window was too narrow to reach the
      // trailing options object.
      const tail = source.slice(match.index, match.index + 1600);
      const hasRole = /role\s*:\s*['"][^'"]+['"]/.test(tail);
      const hasBypass = bypassPattern.test(tail);
      if (hasRole || hasBypass) withRole += 1;
    }
    assert.ok(total > 0, `${script} must call dispatchAgent at least once (saw ${total})`);
    assert.equal(withRole, total, `${script} must declare role on every dispatchAgent call (${withRole}/${total})`);
  }
});

/* ────────────────────────────────────────────────────────────────────────── */
/*               Captured Agent payloads contain model or routingId           */
/* ────────────────────────────────────────────────────────────────────────── */

test('dispatch: captured payloads from a synthetic dispatch contain model + routingDecisionId', async () => {
  const captured = [];
  dispatch.setCaptureFn((entry) => captured.push(entry));
  try {
    const agentFn = async () => ({ ok: true });
    await dispatch.dispatchAgent(agentFn, 'a', 'one', { role: 'security', risk: 'high' }, FIXTURE_CONTEXT);
    await dispatch.dispatchAgent(agentFn, 'b', 'two', { role: 'generic', risk: 'low' }, FIXTURE_CONTEXT);
    await dispatch.dispatchAgent(agentFn, 'c', 'three', { role: 'generic', risk: 'medium' }, FIXTURE_CONTEXT);
  } finally {
    dispatch.resetCaptureFn();
  }
  assert.equal(captured.length, 3);
  for (const entry of captured) {
    assert.ok(entry.opts.routingDecisionId, `payload ${entry.agentName} missing routingDecisionId`);
    assert.ok(UUID_RE.test(entry.opts.routingDecisionId));
    // For security+high the model must be set; for the others it MAY be set.
    if (entry.opts.role === 'security' || entry.opts.risk === 'high') {
      assert.notEqual(entry.opts.model, undefined, `${entry.agentName}: high-risk / security dispatch must have model`);
    }
  }
});

/* ────────────────────────────────────────────────────────────────────────── */
/*            Selector divergence vs canonical SDK (when build present)        */
/* ────────────────────────────────────────────────────────────────────────── */

const sdkDistPath = resolve(repoRoot, 'packages', 'sdk', 'dist', 'router', 'select-dispatch-model.js');

test('dispatch: selector mirror matches the canonical SDK selector on identical inputs', async () => {
  if (!existsSync(sdkDistPath)) {
    assert.ok(true, `SDK dist not built (${sdkDistPath}); divergence check skipped`);
    return;
  }
  const sdk = await import(pathToFileURL(sdkDistPath).href);
  const fixtures = [
    { task: { task: 'a', role: 'security', risk: 'high', capabilities: ['security'] }, selectedProfiles: [], runId: 'div-1' },
    { task: { task: 'b', role: 'generic', risk: 'low' }, selectedProfiles: [
      makeProfile('a/cheap', 'budget'),
      makeProfile('a/strong', 'high'),
    ], runId: 'div-2' },
    { task: { task: 'c', role: 'generic', risk: 'medium' }, selectedProfiles: [
      makeProfile('a/high', 'high'),
      makeProfile('a/low', 'mid'),
    ], health: { 'a/low': { status: 'unhealthy' } }, runId: 'div-3' },
    { task: { task: 'd', role: 'adversarial', risk: 'high', capabilities: ['reasoning'] }, selectedProfiles: [
      makeProfile('a/x', 'mid'),
    ], runId: 'div-4' },
    { task: { task: 'e', role: 'generic' }, selectedProfiles: [], activeSessionModel: 'session/x', runId: 'div-5' },
  ];
  for (const f of fixtures) {
    const mirror = dispatch.selectDispatchModelMirror({ ...f, budget: f.budget ?? {}, health: f.health ?? {} });
    const sdkResult = sdk.selectDispatchModel({ ...f, budget: f.budget ?? {}, health: f.health ?? {} });
    // Compare the decision shape (excluding the UUID which always differs).
    assert.equal(mirror.modelId, sdkResult.modelId, `modelId mismatch on ${f.runId}: mirror=${mirror.modelId} sdk=${sdkResult.modelId}`);
    assert.equal(mirror.tier, sdkResult.tier, `tier mismatch on ${f.runId}: mirror=${mirror.tier} sdk=${sdkResult.tier}`);
    assert.equal(mirror.reason, sdkResult.reason, `reason mismatch on ${f.runId}: mirror=${mirror.reason} sdk=${sdkResult.reason}`);
    assert.equal(mirror.confidence, sdkResult.confidence, `confidence mismatch on ${f.runId}`);
    // Compare ineligibleReasons as sets (order-insensitive).
    const mirrorReasons = [...new Set(mirror.ineligibleReasons)].sort();
    const sdkReasons = [...new Set(sdkResult.ineligibleReasons)].sort();
    assert.deepEqual(mirrorReasons, sdkReasons, `ineligibleReasons mismatch on ${f.runId}`);
  }
});

/* ────────────────────────────────────────────────────────────────────────── */
/*                        loadDispatchContext integration                     */
/* ────────────────────────────────────────────────────────────────────────── */

test('dispatch: loadDispatchContext honours an explicit context override', () => {
  const ctx = dispatch.loadDispatchContext({
    cwd: workflowsDir,
    env: { BIZAR_ACTIVE_SESSION_MODEL: undefined },
  });
  assert.ok(ctx, 'loadDispatchContext returns a context object');
  assert.ok(Array.isArray(ctx.selectedProfiles));
  assert.ok(typeof ctx.budget === 'object');
  assert.ok(typeof ctx.health === 'object');
});

test('dispatch: env override BIZAR_ACTIVE_SESSION_MODEL surfaces in loadDispatchContext', () => {
  const original = process.env.BIZAR_ACTIVE_SESSION_MODEL;
  process.env.BIZAR_ACTIVE_SESSION_MODEL = 'env/session';
  try {
    const ctx = dispatch.loadDispatchContext({ cwd: workflowsDir });
    assert.equal(ctx.activeSessionModel, 'env/session');
  } finally {
    if (original === undefined) delete process.env.BIZAR_ACTIVE_SESSION_MODEL;
    else process.env.BIZAR_ACTIVE_SESSION_MODEL = original;
  }
});

test('dispatch: loadDispatchContext tolerates a missing model-router.json', () => {
  const ctx = dispatch.loadDispatchContext({ cwd: workflowsDir, env: {} });
  assert.deepEqual(ctx.selectedProfiles, []);
  assert.deepEqual(ctx.staticProfiles, []);
});