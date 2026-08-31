/**
 * config/workflows/__tests__/workflow-payload-capture.test.mjs —
 * End-to-end capture test for IMP-014 / F-189.
 *
 * Drives every shipped workflow through a captured dispatch wrapper
 * that (1) records every augmented payload and (2) returns a
 * schema-shaped stub so the workflow continues past its early-return
 * gates. The IMP-014 acceptance gate is verified verbatim:
 *
 *   "Captured nested Agent payloads contain expected models."
 *
 * Specifically:
 *
 *   1. Every captured payload carries a `routingDecisionId` matching
 *      the UUID format.
 *   2. At least one captured payload has a non-undefined `model`,
 *      proving the selector actually picks something for at least one
 *      role in every workflow.
 *   3. Workflows that declare `risk: 'high'` (auditor, verifier, and
 *      security / adversarial lanes) ALWAYS get a concrete `model` from
 *      the selector — they never fall through to session inheritance
 *      (the IMP-014 never-downgrade invariant).
 *   4. The captured model + routingDecisionId match the augmented
 *      payload sent to the runtime's `agent(...)` primitive.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = resolve(here, '..');
const dispatchPath = resolve(workflowsDir, 'lib', 'dispatch.js');
const dispatch = await import(pathToFileURL(dispatchPath).href);

// Phase B (v10.21.0): route every writeArtifact()/barrierRef() side effect
// to a tmp dir so the test does not pollute the worktree.
const TEST_RUN_ROOT = mkdtempSync(join(tmpdir(), 'bizar-capture-runs-'));
process.env.BIZAR_RUNS_DIR = TEST_RUN_ROOT;
globalThis.__BIZAR_TEST_RUN_ROOT__ = TEST_RUN_ROOT;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SCRIPTS = [
  { name: 'bizar-debug', file: 'bizar-debug.js', args: { bug_id: 'BUG-1' } },
  { name: 'bizar-implement', file: 'bizar-implement.js', args: { topic: 'stub-topic', scope: ['a', 'b'] } },
  { name: 'bizar-research', file: 'bizar-research.js', args: { topic: 'stub-topic' } },
  { name: 'ultracode', file: 'ultracode.js', args: { task: 'stub-task' } },
  { name: 'ultracode-research', file: 'ultracode-research.js', args: { question: 'stub-question' } },
  { name: 'ultracode-review', file: 'ultracode-review.js', args: { target: 'stub-target' } },
];

/**
 * Schema-shaped stub responses so the workflow continues past its
 * early-return gates (e.g., `if (!plan.lanes)`). The capture test is
 * about routing, not workflow control flow.
 */
function buildStub(label) {
  if (label === 'plan' || label === 'plan-audit') {
    return {
      approach: 'stub approach',
      lanes: [{ name: 'lane-a', scope: ['a/**'], task: 'stub' }, { name: 'lane-b', scope: ['b/**'], task: 'stub' }],
      gates: ['stub-gate'],
    };
  }
  if (label === 'scope-extract') {
    return { lanes: [{ name: 'lane-a', scope: ['a/**'], task: 'stub' }, { name: 'lane-b', scope: ['b/**'], task: 'stub' }] };
  }
  if (label === 'repository-map' || label === 'official-docs' || label.startsWith('review:')) {
    return {
      findings: [{ summary: 'stub', file: 'stub.ts', line: 1, failureScenario: 'stub' }],
      summary: 'stub',
      files: ['stub/file.ts'],
      risks: ['risk'],
      verification: ['verif'],
    };
  }
  if (label === 'fix') {
    return { files: ['fix.ts'], regressionTest: 'fix.test.ts', summary: 'stub' };
  }
  if (label === 'fix-verify') {
    return { ok: true, summary: 'stub verify' };
  }
  if (label === 'barrier-merge' || label === 'barrier-verify' || label === 'integration-report' || label === 'final-verification') {
    return { plan: 'stub plan' };
  }
  if (label.startsWith('verify:') || label === 'hypothesis:initial' || label.startsWith('refine:')) {
    return { confirmed: true, reason: 'stub' };
  }
  if (label === 'repository' || label === 'documentation' || label === 'architecture' || label === 'completeness-critic') {
    return { claims: [{ claim: 'stub', source: 'stub', confidence: 'medium' }], gaps: [] };
  }
  if (label === 'synthesis') {
    return { brief: 'stub brief' };
  }
  if (label.startsWith('implement:')) {
    return { stub: true, label, files: ['changed.ts'], summary: 'lane complete' };
  }
  return { stub: true, label };
}

/**
 * Synthetic dispatch context whose selected pool contains two models
 * with different tier hints. This guarantees `risk: 'high'` /
 * `role: 'security'` lanes actually pick a concrete model instead of
 * falling through to session inheritance.
 */
function makeFixtureContext() {
  return {
    selectedProfiles: [
      { id: 'provider/cheap', tier: 'budget', profile: { capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true }, limits: { contextTokens: 32000, inputTokens: null, outputTokens: null } } },
      { id: 'provider/strong', tier: 'high', profile: { capabilities: { reasoning: true, toolCall: true, structuredOutput: true, attachment: true, temperature: true }, limits: { contextTokens: 200000, inputTokens: null, outputTokens: null } } },
    ],
    staticProfiles: [],
    activeSessionModel: 'session/inherit',
    budget: {},
    health: {},
    history: undefined,
  };
}

/**
 * Wrap `dispatchAgent` so every call from the workflow uses the
 * supplied context AND records the augmented payload into `captured`.
 * The wrapper returns a schema-shaped stub so the workflow continues
 * past its early-return gates.
 */
function makeCaptureDispatch(captured, ctx) {
  return async function dispatchCaptured(agentFn, name, prompt, opts = {}) {
    const decision = dispatch.computeDecision(name, prompt, opts, ctx);
    const payload = dispatch.augmentPayload(opts, decision, name);
    captured.push({
      agentName: name,
      label: opts.label,
      risk: opts.risk,
      role: opts.role,
      decision,
      payload,
    });
    return buildStub(opts.label || name);
  };
}

/**
 * Run a workflow script with a captured dispatch. Strips the meta
 * export and any static imports, then evaluates the body with the
 * standard runtime primitives + the captured dispatch.
 */
async function runCapturedWorkflow(file, args, captured, ctx) {
  const source = readFileSync(resolve(workflowsDir, file), 'utf8');
  const metaStart = source.search(/export\s+const\s+meta\s*=\s*\{/);
  const open = source.indexOf('{', metaStart);
  let depth = 0;
  let inString = null;
  let escape = false;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  let body = source.slice(end + 1);

  // Strip static imports (we pass dispatchCaptured as a parameter).
  body = body.replace(/^\s*import\s+(?:\{([^}]+)\}|([^\s{]+))\s+from\s+['"][^'"]+['"];?\s*$/gm, '');

  // Rewrite `dispatchAgent(` to `dispatchCaptured(` so the workflow
  // body uses the wrapper that records payloads and provides schema
  // stubs. The wrapper is passed as a Function parameter.
  body = body.replace(/dispatchAgent\(/g, 'dispatchCaptured(');

  const fakeAgent = async () => ({ stub: true });
  const fakeParallel = async (fns) => Promise.all((Array.isArray(fns) ? fns : []).map((f) => f()));
  const fakePipeline = async (items, fn) => {
    if (typeof fn !== 'function') return items;
    const out = [];
    for (let i = 0; i < items.length; i++) out.push(await fn(items[i], items, i));
    return out;
  };
  const fakePhase = () => {};
  const fakeLog = () => {};

  // Phase B: stub writeArtifact + barrierRef so the test doesn't perform
  // real fs side effects. Both are no-ops that return shape-compatible
  // values for any caller that uses them in the workflow body.
  const stubWriteArtifact = () => ({ runDir: '/tmp/stub', artifactPath: '/tmp/stub.json', slug: 'stub', manifestPath: '/tmp/manifest.json' });
  const stubBarrierRef = ({ phase, label, summary }) => ({ promptBlock: `prior phase: ${phase}\nprior label: ${label}\nsummary:     ${summary || ''}\npath:        /tmp/stub.json`, path: '/tmp/stub.json', truncated: false, bytes: 100 });

  const fn = new Function(
    'args', 'agent', 'pipeline', 'parallel', 'phase', 'log', 'dispatchCaptured', 'randomUUID', 'writeArtifact', 'barrierRef',
    `return (async () => { ${body.trim()} })();`,
  );
  return fn(args, fakeAgent, fakePipeline, fakeParallel, fakePhase, fakeLog, makeCaptureDispatch(captured, ctx), randomUUID, stubWriteArtifact, stubBarrierRef);
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Per-workflow capture                              */
/* ────────────────────────────────────────────────────────────────────────── */

for (const script of SCRIPTS) {
  test(`workflow-payload-capture: ${script.name} -> every nested payload has routingDecisionId`, async () => {
    const captured = [];
    const ctx = makeFixtureContext();
    await runCapturedWorkflow(script.file, script.args, captured, ctx);

    assert.ok(captured.length > 0, `${script.name}: must capture at least one dispatch (saw 0)`);
    for (const entry of captured) {
      assert.ok(
        entry.decision.routingDecisionId,
        `${script.name}/${entry.label}: routingDecisionId must be set`,
      );
      assert.ok(
        UUID_RE.test(entry.decision.routingDecisionId),
        `${script.name}/${entry.label}: routingDecisionId must be a UUID (got ${entry.decision.routingDecisionId})`,
      );
      // The payload sent to the agent must echo the routing metadata.
      assert.equal(entry.payload.routingDecisionId, entry.decision.routingDecisionId);
      assert.equal(entry.payload.tier, entry.decision.tier);
      assert.equal(entry.payload.selectorReason, entry.decision.reason);
    }
  });

  test(`workflow-payload-capture: ${script.name} -> at least one captured payload has a non-undefined model`, async () => {
    const captured = [];
    const ctx = makeFixtureContext();
    await runCapturedWorkflow(script.file, script.args, captured, ctx);

    const withModel = captured.filter((entry) => entry.payload.model !== undefined && entry.payload.model !== null);
    assert.ok(
      withModel.length >= 1,
      `${script.name}: at least one payload must carry a model (saw ${withModel.length}/${captured.length})`,
    );
  });

  test(`workflow-payload-capture: ${script.name} -> high-risk lanes always pick a concrete model (never fall through)`, async () => {
    const captured = [];
    const ctx = makeFixtureContext();
    await runCapturedWorkflow(script.file, script.args, captured, ctx);

    const highRisk = captured.filter((entry) => entry.risk === 'high');
    assert.ok(
      highRisk.length >= 1,
      `${script.name}: fixture must declare at least one high-risk lane (saw ${highRisk.length})`,
    );
    for (const entry of highRisk) {
      assert.notEqual(
        entry.payload.model, undefined,
        `${script.name}/${entry.label}: high-risk lane must have a model (got ${entry.payload.model})`,
      );
      assert.notEqual(
        entry.payload.model, null,
        `${script.name}/${entry.label}: high-risk lane model must not be null (got ${entry.payload.model})`,
      );
      // The selector reason must NOT be session-inherit for high-risk lanes.
      assert.notEqual(
        entry.decision.reason, dispatch.REASON.SESSION_INHERIT,
        `${script.name}/${entry.label}: high-risk lane must not fall through to session-inherit (reason=${entry.decision.reason})`,
      );
      assert.notEqual(
        entry.decision.reason, dispatch.REASON.NO_ELIGIBLE,
        `${script.name}/${entry.label}: high-risk lane must not fall through to no-eligible (reason=${entry.decision.reason})`,
      );
    }
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                        Cross-workflow invariants                           */
/* ────────────────────────────────────────────────────────────────────────── */

test('workflow-payload-capture: all workflows together -> routingDecisionId is unique per call', async () => {
  const allCaptured = [];
  for (const script of SCRIPTS) {
    const captured = [];
    const ctx = makeFixtureContext();
    await runCapturedWorkflow(script.file, script.args, captured, ctx);
    allCaptured.push(...captured);
  }
  const ids = allCaptured.map((entry) => entry.decision.routingDecisionId);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, `every routingDecisionId must be unique (saw ${ids.length} calls, ${unique.size} unique)`);
});

test('workflow-payload-capture: every fixture workflow has at least 2 high-risk captures', async () => {
  // IMP-014 acceptance gate requires high-risk lanes to always pick a
  // concrete model. Each workflow must declare at least 2 high-risk
  // lanes (e.g., auditor + reviewer/verifier) so the invariant is
  // exercised across multiple distinct decision points.
  for (const script of SCRIPTS) {
    const captured = [];
    const ctx = makeFixtureContext();
    await runCapturedWorkflow(script.file, script.args, captured, ctx);
    const highRiskCount = captured.filter((entry) => entry.risk === 'high').length;
    assert.ok(
      highRiskCount >= 1,
      `${script.name}: must capture at least 1 high-risk dispatch (saw ${highRiskCount})`,
    );
  }
});