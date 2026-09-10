/**
 * config/workflows/__tests__/bizar-sec-audit.test.mjs
 *
 * Drive-through test for `config/workflows/bizar-sec-audit.js` using a
 * capture stub for the native `agent()` primitive. This test asserts:
 *
 *   1. The workflow body compiles inside `new Function` (no static
 *      imports) and runs end-to-end under the documented contract.
 *   2. The return shape is `status: 'ready-for-integration'` with the
 *      five documented fields: `threatModel`, `lenses`,
 *      `verifiedFindings`, `fixLanes`, `report`.
 *   3. >= 6 distinct agent() captures fire (1 threat model + 4 lens +
 *      >= 1 verifier) and every captured payload carries an alias
 *      `model` field.
 *   4. Security lanes (threat model + 4 lenses + all verifiers) use
 *      `opus` — the never-downgrade rule for security.
 *   5. The host-supplied `args.routing.routingDecisionId` is forwarded
 *      through the prompt barrier into the agent calls.
 *
 * Run with `node --test config/workflows/__tests__/bizar-sec-audit.test.mjs`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = resolve(here, '..');
const workflowPath = resolve(workflowsDir, 'bizar-sec-audit.js');

function loadSource(file) {
  return readFileSync(resolve(workflowsDir, file), 'utf8');
}

function extractMeta(source) {
  const start = source.search(/export\s+const\s+meta\s*=\s*\{/);
  if (start < 0) throw new Error('meta export not found');
  const open = source.indexOf('{', start);
  let depth = 0;
  let inString = null;
  let escape = false;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('meta braces unbalanced');
  return new Function(`return (${source.slice(open, end + 1)});`)();
}

function extractBody(source) {
  const start = source.search(/export\s+const\s+meta\s*=\s*\{/);
  const open = source.indexOf('{', start);
  let depth = 0;
  let inString = null;
  let escape = false;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') { escape = true; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('meta braces unbalanced');
  const body = source.slice(end + 1);
  // Reject static imports — the contract forbids them.
  if (/^\s*import\s/m.test(body) || /\bimport\s*\(/.test(body)) {
    throw new Error('workflow body must be self-contained; imports are unavailable');
  }
  return body;
}

function buildCaptureRuntime(args) {
  const calls = [];
  const phase = (name) => calls.push({ primitive: 'phase', name });
  const log = (...rest) => calls.push({ primitive: 'log', args: rest });

  function buildStub(dispatchMeta) {
    const label = dispatchMeta.label || '';
    if (label === 'threat-model') {
      return {
        summary: 'stub threat model summary',
        assets: ['asset-a', 'asset-b'],
        threats: ['threat-a', 'threat-b'],
        mitigations: ['mitigation-a'],
      };
    }
    if (label.startsWith('lens:')) {
      return {
        findings: [
          {
            summary: `stub ${label} finding`,
            file: 'src/stub.ts',
            line: 12,
            failureScenario: 'attacker can do X',
          },
        ],
      };
    }
    if (label.startsWith('verify:')) {
      return { confirmed: true, reason: 'stub confirmation' };
    }
    if (label.startsWith('fix:')) {
      return { files: ['fix.ts'], regressionTest: 'fix.test.ts', summary: 'stub fix' };
    }
    if (label === 'final-report') {
      return { path: 'reports/sec-audit.json', summary: 'stub final report' };
    }
    return { stub: true, label, phase: dispatchMeta.phase };
  }

  const agent = async (prompt, opts) => {
    const header = typeof prompt === 'string'
      ? prompt.match(/^\[Bizar dispatch \d+: [^;]+; role=([^;]+); phase=([^;]+); label=([^\]]+)\]/)
      : null;
    const dispatchMeta = { role: header?.[1], phase: header?.[2], label: header?.[3] };
    calls.push({
      primitive: 'agent',
      ...dispatchMeta,
      subagentType: opts?.subagent_type,
      model: opts?.model,
      isolation: opts?.isolation,
      routingDecisionId: args?.routing?.routingDecisionId || null,
      promptSnippet: typeof prompt === 'string' ? prompt.slice(0, 220) : '',
      hasRoutingRef: typeof prompt === 'string' ? prompt.includes(`routingDecisionId=${args?.routing?.routingDecisionId || 'routing-id-absent'}`) : false,
    });
    return buildStub(dispatchMeta);
  };
  const parallel = async (fns) => {
    calls.push({ primitive: 'parallel', count: Array.isArray(fns) ? fns.length : 0 });
    return Promise.all((Array.isArray(fns) ? fns : []).map((f) => f()));
  };
  return { calls, agent, parallel, phase, log, args };
}

async function runWorkflow(file, args) {
  const source = loadSource(file);
  const body = extractBody(source);
  const runtime = buildCaptureRuntime(args);
  const fn = new Function(
    'args', 'agent', 'parallel', 'phase', 'log',
    `return (async () => { ${body} })();`,
  );
  const result = await fn(runtime.args, runtime.agent, runtime.parallel, runtime.phase, runtime.log);
  return { result, calls: runtime.calls };
}

test('bizar-sec-audit: meta export shape', () => {
  const meta = extractMeta(loadSource('bizar-sec-audit.js'));
  assert.equal(meta.name, 'bizar-sec-audit');
  assert.equal(typeof meta.description, 'string');
  assert.ok(meta.description.length > 0);
  assert.equal(typeof meta.whenToUse, 'string');
  assert.ok(Array.isArray(meta.phases));
  assert.ok(meta.phases.length >= 5, `phases must list >=5 stages (saw ${meta.phases.length})`);
  for (const p of meta.phases) {
    assert.equal(typeof p.title, 'string');
    assert.equal(typeof p.detail, 'string');
  }
  const titles = meta.phases.map((p) => p.title);
  assert.deepEqual(titles, ['Threat-Model', 'Lenses', 'Verify', 'Fix-Lanes', 'Final-Report']);
});

test('bizar-sec-audit: filename matches meta.name', () => {
  const fileBase = workflowPath.split('/').pop().replace(/\.js$/, '');
  const meta = extractMeta(loadSource('bizar-sec-audit.js'));
  assert.equal(meta.name, fileBase);
});

test('bizar-sec-audit: body has no imports', () => {
  const source = loadSource('bizar-sec-audit.js');
  const body = extractBody(source);
  assert.ok(!/^\s*import\s/m.test(body));
  assert.ok(!/\bimport\s*\(/.test(body));
});

test('bizar-sec-audit: drive-through returns ready-for-integration with documented shape', async () => {
  const args = { target: 'src/stub.ts', routing: { routingDecisionId: 'routing-test-123' } };
  const { result, calls } = await runWorkflow('bizar-sec-audit.js', args);

  assert.equal(result.status, 'ready-for-integration');
  assert.equal(result.target, 'src/stub.ts');
  assert.equal(result.routingDecisionId, 'routing-test-123');

  // Documented return-shape fields.
  assert.ok(result.threatModel && typeof result.threatModel.summary === 'string');
  assert.ok(result.threatModel.assets && result.threatModel.threats && result.threatModel.mitigations);
  assert.ok(result.lenses && result.lenses.authz && result.lenses.secret && result.lenses['supply-chain'] && result.lenses.runtime);
  assert.ok(Array.isArray(result.verifiedFindings));
  assert.ok(Array.isArray(result.fixLanes));
  assert.ok(result.report && typeof result.report.summary === 'string');

  // Phase call sequence.
  const phases = calls.filter((c) => c.primitive === 'phase').map((c) => c.name);
  assert.deepEqual(phases, ['Threat-Model', 'Lenses', 'Verify', 'Fix-Lanes', 'Final-Report']);
});

test('bizar-sec-audit: >=6 distinct agent() captures with model alias and security lanes on opus', async () => {
  const args = { target: 'src/stub.ts', routing: { routingDecisionId: 'routing-test-456' } };
  const { calls } = await runWorkflow('bizar-sec-audit.js', args);

  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  assert.ok(agentCalls.length >= 6, `expected >=6 agent() calls, saw ${agentCalls.length}`);

  // Every captured payload carries a model alias.
  for (const call of agentCalls) {
    assert.ok(typeof call.model === 'string' && call.model.length > 0, `agent call ${call.label} missing model`);
    assert.ok(['haiku', 'sonnet', 'opus', 'fable'].includes(call.model), `agent call ${call.label} model=${call.model} not a native alias`);
  }

  // Security lanes are never-downgrade: threat-model + 4 lenses + all
  // verifiers + final-report must all use opus.
  const securityLabels = ['threat-model', 'lens:authz', 'lens:secret', 'lens:supply-chain', 'lens:runtime'];
  for (const label of securityLabels) {
    const callsForLabel = agentCalls.filter((c) => c.label === label);
    assert.ok(callsForLabel.length >= 1, `expected >=1 agent() call with label=${label}`);
    for (const c of callsForLabel) {
      assert.equal(c.model, 'opus', `${label} must use opus (never-downgrade); saw ${c.model}`);
    }
  }

  const verifierCalls = agentCalls.filter((c) => c.label && c.label.startsWith('verify:'));
  assert.ok(verifierCalls.length >= 1, `expected >=1 verifier agent() call, saw ${verifierCalls.length}`);
  for (const c of verifierCalls) {
    assert.equal(c.model, 'opus', `verifier ${c.label} must use opus; saw ${c.model}`);
  }

  const finalReportCalls = agentCalls.filter((c) => c.label === 'final-report');
  assert.ok(finalReportCalls.length >= 1, 'final-report must dispatch at least one agent');
  for (const c of finalReportCalls) {
    assert.equal(c.model, 'opus', `final-report must use opus; saw ${c.model}`);
  }
});

test('bizar-sec-audit: routingDecisionId is forwarded into agent prompts', async () => {
  const args = { target: 'src/stub.ts', routing: { routingDecisionId: 'routing-test-789' } };
  const { result, calls } = await runWorkflow('bizar-sec-audit.js', args);

  assert.equal(result.routingDecisionId, 'routing-test-789');
  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  const forwarded = agentCalls.filter((c) => c.hasRoutingRef && c.routingDecisionId === 'routing-test-789');
  assert.ok(forwarded.length >= 6, `expected >=6 agent calls to forward routingDecisionId, saw ${forwarded.length}`);
});

test('bizar-sec-audit: --fix mode dispatches parallel fix-lanes', async () => {
  const args = {
    target: 'src/stub.ts',
    fix: true,
    routing: { routingDecisionId: 'routing-test-fix' },
  };
  const { result, calls } = await runWorkflow('bizar-sec-audit.js', args);

  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  const fixCalls = agentCalls.filter((c) => c.label && c.label.startsWith('fix:'));
  assert.ok(fixCalls.length >= 1, `expected >=1 fix-lane agent call, saw ${fixCalls.length}`);
  assert.ok(fixCalls.length <= 4, `fix lanes bounded to max 4; saw ${fixCalls.length}`);
  for (const c of fixCalls) {
    assert.equal(c.subagentType, 'todd', 'fix-lane must route to todd');
    assert.equal(c.isolation, 'worktree', 'fix-lane must use worktree isolation');
    assert.ok(['haiku', 'sonnet', 'opus', 'fable'].includes(c.model), `fix-lane model=${c.model} not a native alias`);
  }
  const parallelFix = calls.find((c) => c.primitive === 'parallel' && c.count >= 1 && agentCalls.filter((ac) => ac.label && ac.label.startsWith('fix:')).length === c.count);
  assert.ok(parallelFix, 'fix-lanes must dispatch via parallel()');
  assert.ok(result.fixLanes.length >= 1);
});

test('bizar-sec-audit: no --fix mode skips fix-lanes entirely', async () => {
  const args = { target: 'src/stub.ts', routing: { routingDecisionId: 'routing-test-nofix' } };
  const { result, calls } = await runWorkflow('bizar-sec-audit.js', args);

  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  const fixCalls = agentCalls.filter((c) => c.label && c.label.startsWith('fix:'));
  assert.equal(fixCalls.length, 0, `expected 0 fix-lane calls without --fix; saw ${fixCalls.length}`);
  assert.deepEqual(result.fixLanes, []);
});

test('bizar-sec-audit: every agent subagent_type maps to a stable Bizar agent', async () => {
  const args = { target: 'src/stub.ts', routing: { routingDecisionId: 'routing-test-agent' } };
  const { calls } = await runWorkflow('bizar-sec-audit.js', args);
  const agentCalls = calls.filter((c) => c.primitive === 'agent');
  for (const c of agentCalls) {
    assert.ok(/^(greg|paul|todd|linda)$/.test(c.subagentType), `${c.label} subagentType=${c.subagentType} not a stable Bizar agent`);
  }
});
