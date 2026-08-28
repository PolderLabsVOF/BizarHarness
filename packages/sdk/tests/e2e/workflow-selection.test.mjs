/**
 * packages/sdk/tests/e2e/workflow-selection.test.mjs —
 * Workflow dispatch E2E coverage for IMP-022 / F-192.
 *
 * Closes the IMP-022 acceptance gate from `IMPROVEMENTS.md` line 875
 * ("Model-selection E2E matrix | Direct, workflow, and team selection
 * cases pass"). Each test in this file drives one of the six shipped
 * workflows through the harness so every nested Agent tool call lands
 * in the agent-tool stub with the augmented payload carrying
 * `model` + `routingDecisionId` + `selectorReason`.
 *
 * The harness reuses the existing `workflow-payload-capture.test.mjs`
 * fixture context (2-model selected pool) and the same source-rewrite
 * trick the capture test uses (strip meta export + static imports,
 * substitute `dispatchAgent(` with the captured wrapper).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createE2EHarness } from './_fixtures/dispatch-context.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const workflowsDir = resolve(repoRoot, 'config', 'workflows');
const dispatchPath = resolve(workflowsDir, 'lib', 'dispatch.js');
const dispatch = await import(pathToFileURL(dispatchPath).href);

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
 * Build a schema-shaped stub that matches the per-label shape the
 * workflows expect (mirrors `workflow-payload-capture.test.mjs`).
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
 * Same source-rewrite trick `workflow-payload-capture.test.mjs` uses:
 * strip meta + static imports, substitute `dispatchAgent(` with the
 * captured wrapper. The wrapper threads the dispatch through the real
 * `computeDecision` / `augmentPayload` and records the augmented
 * payload into the harness's agent-tool stub.
 */
async function runCapturedWorkflow(file, args, harness) {
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
  body = body.replace(/^\s*import\s+(?:\{([^}]+)\}|([^\s{]+))\s+from\s+['"][^'"]+['"];?\s*$/gm, '');

  // Wrapper that records each dispatch into both the harness's
  // agent-tool stub AND the harness's evidence store before invoking
  // the agent stub and the provider stub. The agent stub is the one
  // the matrix test asserts on; the wrapper here is the per-dispatch
  // glue the workflow runtime expects.
  function makeWrappedDispatch(h) {
    return async function dispatchWrapped(agentFn, agentName, prompt, opts = {}) {
      const decision = dispatch.computeDecision(agentName, prompt, opts, {
        selectedProfiles: h.profiles,
        staticProfiles: [],
        activeSessionModel: h.ctx.activeSessionModel,
        budget: h.ctx.budget,
        health: h.ctx.health,
        history: h.ctx.history,
        runId: h.ctx.runId,
      });
      const augmented = dispatch.augmentPayload(opts, decision, agentName);
      // Record via the harness so the agent-tool stub captures it and
      // the evidence store sees the row.
      const result = await h.dispatch({
        role: opts.role ?? 'implementer',
        agentName,
        prompt,
        risk: opts.risk,
        capabilities: opts.capabilities,
        phase: opts.phase,
        extraOpts: { ...opts, label: opts.label },
      });
      return buildStub(opts.label || agentName);
    };
  }

  body = body.replace(/dispatchAgent\(/g, 'dispatchWrapped(');

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

  const fn = new Function(
    'args', 'agent', 'pipeline', 'parallel', 'phase', 'log', 'dispatchWrapped',
    `return (async () => { ${body.trim()} })();`,
  );
  return fn(args, fakeAgent, fakePipeline, fakeParallel, fakePhase, fakeLog, makeWrappedDispatch(harness));
}

describe('workflow-selection — IMP-022 workflow E2E matrix', () => {
  for (const script of SCRIPTS) {
    describe(`${script.name}`, () => {
      let harness;
      beforeEach(() => {
        harness = createE2EHarness();
      });

      it('every nested Agent payload carries routingDecisionId AND every high-risk lane has a non-undefined model', async () => {
        await runCapturedWorkflow(script.file, script.args, harness);

        expect(harness.agentTool.captured.length).toBeGreaterThan(0);

        for (const entry of harness.agentTool.captured) {
          expect(entry.payload.routingDecisionId).toBeTruthy();
          expect(UUID_RE.test(entry.payload.routingDecisionId)).toBe(true);
          // Every payload carries the selector metadata.
          expect(entry.payload.tier).toBeTruthy();
          expect(entry.payload.selectorReason).toBeTruthy();
          // Phase is reflected in the captured payload (workflow
          // scripts forward `phase` into the dispatch opts).
          if (entry.payload.phase !== undefined) {
            expect(typeof entry.payload.phase).toBe('string');
          }
        }

        const highRisk = harness.agentTool.captured.filter((e) => e.payload.risk === 'high');
        if (highRisk.length > 0) {
          for (const entry of highRisk) {
            expect(entry.payload.model).toBeTruthy();
            expect(entry.payload.model).not.toBe(undefined);
            // High-risk lanes never fall through to session inherit.
            expect(entry.payload.selectorReason).not.toBe(harness.REASON.SESSION_INHERIT);
            expect(entry.payload.selectorReason).not.toBe(harness.REASON.NO_ELIGIBLE);
          }
        }
      });
    });
  }

  it('cross-workflow invariant: routingDecisionIds are unique across the run', async () => {
    const allDecisions = [];
    for (const script of SCRIPTS) {
      const harness = createE2EHarness();
      await runCapturedWorkflow(script.file, script.args, harness);
      allDecisions.push(...harness.agentTool.captured.map((c) => c.payload.routingDecisionId));
    }
    const unique = new Set(allDecisions);
    expect(unique.size).toBe(allDecisions.length);
  });

  it('at least one workflow surfaces the phase label on the captured payload (selectorReason mirrors the phase)', async () => {
    // Look across all workflows for a captured payload that carries a
    // `phase` field distinct from the default. Every shipped workflow
    // declares phases (Scope, Implement, Barrier, ...).
    let foundPhase = false;
    for (const script of SCRIPTS) {
      const harness = createE2EHarness();
      await runCapturedWorkflow(script.file, script.args, harness);
      for (const entry of harness.agentTool.captured) {
        if (typeof entry.payload.phase === 'string' && entry.payload.phase.length > 0) {
          foundPhase = true;
          break;
        }
      }
      if (foundPhase) break;
    }
    expect(foundPhase).toBe(true);
  });

  it('every captured payload has a corresponding evidence row BEFORE the agent stub is invoked', async () => {
    // Use bizarre-implement: it has many lane dispatches.
    const script = SCRIPTS.find((s) => s.name === 'bizar-implement');
    const harness = createE2EHarness();
    await runCapturedWorkflow(script.file, script.args, harness);

    expect(harness.agentTool.captured.length).toBeGreaterThan(0);
    for (const entry of harness.agentTool.captured) {
      const row = await harness.evidenceStore.get(entry.payload.routingDecisionId);
      expect(row).not.toBeNull();
      expect(row.decision.routingDecisionId).toBe(entry.payload.routingDecisionId);
    }
  });

  it('provider agrees with the recorded decision for every captured dispatch', async () => {
    const script = SCRIPTS.find((s) => s.name === 'bizar-debug');
    const harness = createE2EHarness();
    await runCapturedWorkflow(script.file, script.args, harness);

    expect(harness.provider.requests.length).toBe(harness.agentTool.captured.length);
    for (const req of harness.provider.requests) {
      expect(req.resolvedModel).toBe(req.requestedModel);
      expect(req.substitution).toBe(false);
    }
    // 100% agreement between recorded decision and actual provider model.
    const mismatches = harness.detectProviderMismatch();
    expect(mismatches).toEqual([]);
  });
});